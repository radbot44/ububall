#!/usr/bin/env python3
"""
VRAM-Resident RTX 4090 PyTorch Trainer (+ Portable NumPy Fallback) for Ububall Neural CPU.

Reads fixed 216-float binary shards from `personal/nn-shards/` (written by `scripts/nn-generate.cjs`),
applies 2x vertical rink reflection augmentation (yielding 4x effective samples per simulated turn),
trains `UbuballNet` (196 -> 256 -> 256 -> 256 residual LayerNorm + SiLU trunk -> Value[3] + Policy[18]),
and exports a compact ~378 KB little-endian float16 `UBNN` weight file to `web/assets/ububall-net.bin`.

Usage on RTX 4090 desktop:
  python scripts/train-nn.py --shards personal/nn-shards --epochs 25 --batch-size 4096

Automatically falls back to a vectorized NumPy AdamW trainer when PyTorch is not installed so
CI and CPU-only test environments can verify the exact same binary export pipeline end-to-end.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import struct
import time
from pathlib import Path
import numpy as np

NN_MAGIC = b"UBNN"
NN_FORMAT = 1
INPUT_DIM = 196
POLICY_DIM = 18
VALUE_DIM = 3
ROW_FLOATS = 216
DEFAULT_PHYS_VERSION = 30

# Exact signed channels negated under vertical reflection (y -> 600 - y)
Y_FLIP_OBS = [
    1, 3, 4,
    29, 31, 32,
    57, 59, 60,
    85, 87, 88,
    113, 115, 116,
    141, 143, 144,
    169, 171, 172,
]
Y_FLIP_POL = [1, 3, 7, 9, 13, 15]


def load_shards(shard_dir: Path) -> tuple[np.ndarray, int]:
    manifest_path = shard_dir / "manifest.json"
    phys_version = DEFAULT_PHYS_VERSION
    if manifest_path.exists():
        meta = json.loads(manifest_path.read_text(encoding="utf-8"))
        phys_version = int(meta.get("physVersion", DEFAULT_PHYS_VERSION))

    files = sorted(glob.glob(str(shard_dir / "*.bin")))
    if not files:
        raise FileNotFoundError(f"No .bin shards found in {shard_dir}. Run `npm run nn:gen` first.")

    arrays = []
    for fpath in files:
        mm = np.memmap(fpath, dtype=np.float32, mode="r")
        if mm.size % ROW_FLOATS != 0:
            raise ValueError(f"Shard {fpath} float count {mm.size} is not divisible by {ROW_FLOATS}.")
        arrays.append(np.array(mm.reshape(-1, ROW_FLOATS), dtype=np.float32, copy=True))
    data = np.concatenate(arrays, axis=0)
    return data, phys_version


def split_train_val(data: np.ndarray, val_frac: float = 0.10) -> tuple[np.ndarray, np.ndarray]:
    # Pair-aligned contiguous split so both sides of a turn stay in the same split
    n = (len(data) // 2) * 2
    data = data[:n]
    val_n = max(2, int((n // 2) * val_frac) * 2)
    if n <= 8:
        return data, data.copy()
    train_n = max(2, n - val_n)
    return data[:train_n], data[train_n:]


def export_ubnn_tensors(tensors_f32: list[np.ndarray], out_path: Path, hidden_dim: int, phys_version: int) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    header = struct.pack("<4sHHHHI", NN_MAGIC, NN_FORMAT, hidden_dim, INPUT_DIM, 3, phys_version)
    total_params = 0
    with open(out_path, "wb") as f:
        f.write(header)
        for arr in tensors_f32:
            c_arr = np.ascontiguousarray(arr, dtype=np.float16)
            total_params += c_arr.size
            f.write(c_arr.tobytes())
    return total_params


def build_soft_value_targets(next_goal: np.ndarray, turns_to_goal: np.ndarray, gamma: float = 0.985) -> np.ndarray:
    """
    Smooths discounted next-goal outcomes into a 3-class distribution [p_score, p_concede, p_draw]
    so faster goals earn strictly higher value than 45-turn scrambles.
    """
    n = len(next_goal)
    targets = np.zeros((n, 3), dtype=np.float32)
    disc = np.power(gamma, np.clip(turns_to_goal, 0.0, 80.0)).astype(np.float32)
    win = next_goal > 0.5
    loss = next_goal < -0.5
    draw = ~(win | loss)

    targets[win, 0] = 0.5 + 0.5 * disc[win]
    targets[win, 2] = 1.0 - targets[win, 0]

    targets[loss, 1] = 0.5 + 0.5 * disc[loss]
    targets[loss, 2] = 1.0 - targets[loss, 1]

    targets[draw, 2] = 1.0
    return targets


# ---------------------------------------------------------------------------
# Engine 1: Native PyTorch (VRAM-resident CUDA + bf16 Tensor Cores on RTX 4090)
# ---------------------------------------------------------------------------
def train_pytorch(
    train_data: np.ndarray,
    val_data: np.ndarray,
    hidden_dim: int,
    epochs: int,
    batch_size: int,
    lr: float,
    seed: int,
    out_path: Path,
    phys_version: int,
) -> dict:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    torch.manual_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    use_bf16 = device.type == "cuda" and torch.cuda.is_bf16_supported()
    dev_name = torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU (PyTorch)"

    class ResBlock(nn.Module):
        def __init__(self, dim: int) -> None:
            super().__init__()
            self.fc = nn.Linear(dim, dim)
            self.ln = nn.LayerNorm(dim)
            self.act = nn.SiLU()

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return x + self.act(self.ln(self.fc(x)))

    class UbuballNet(nn.Module):
        def __init__(self, in_dim: int = INPUT_DIM, dim: int = 256) -> None:
            super().__init__()
            self.stem_fc = nn.Linear(in_dim, dim)
            self.stem_ln = nn.LayerNorm(dim)
            self.act = nn.SiLU()
            self.b1 = ResBlock(dim)
            self.b2 = ResBlock(dim)
            self.val_head = nn.Linear(dim, VALUE_DIM)
            self.pol_head = nn.Linear(dim, POLICY_DIM)

        def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
            h = self.act(self.stem_ln(self.stem_fc(x)))
            h = self.b2(self.b1(h))
            return self.val_head(h), self.pol_head(h)

    model = UbuballNet(INPUT_DIM, hidden_dim).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, epochs), eta_min=lr * 0.05)

    # Move dataset directly into VRAM when <= 16 GB (2M rows is ~1.73 GB -> fits easily in 24 GB 4090)
    vram_resident = device.type == "cuda" and train_data.nbytes <= 16 * (1024 ** 3)
    target_dev = device if vram_resident else torch.device("cpu")

    tr_obs = torch.from_numpy(train_data[:, :INPUT_DIM]).to(target_dev)
    tr_pol = torch.from_numpy(train_data[:, INPUT_DIM : INPUT_DIM + POLICY_DIM]).to(target_dev)
    tr_val_soft = torch.from_numpy(build_soft_value_targets(train_data[:, 214], train_data[:, 215])).to(target_dev)

    va_obs = torch.from_numpy(val_data[:, :INPUT_DIM]).to(device)
    va_pol = torch.from_numpy(val_data[:, INPUT_DIM : INPUT_DIM + POLICY_DIM]).to(device)
    va_val_soft = torch.from_numpy(build_soft_value_targets(val_data[:, 214], val_data[:, 215])).to(device)
    va_raw_goal = torch.from_numpy(val_data[:, 214]).to(device)

    obs_flip_idx = torch.tensor(Y_FLIP_OBS, dtype=torch.long, device=device)
    pol_flip_idx = torch.tensor(Y_FLIP_POL, dtype=torch.long, device=device)

    def compute_losses(v_logits: torch.Tensor, p_out: torch.Tensor, y_val: torch.Tensor, y_pol: torch.Tensor):
        log_probs = F.log_softmax(v_logits, dim=-1)
        val_loss = -(y_val * log_probs).sum(dim=-1).mean()

        p_pred = p_out.view(-1, 3, 6)
        p_true = y_pol.view(-1, 3, 6)
        moving_mask = ((p_true[:, :, 5] < 0.5) & (p_true[:, :, 2] > 0.02)).float()
        active_denom = moving_mask.sum().clamp_min(1.0)

        dir_loss = (F.smooth_l1_loss(p_pred[:, :, 0:2], p_true[:, :, 0:2], reduction="none").sum(dim=-1) * moving_mask).sum() / active_denom
        pwr_loss = F.binary_cross_entropy_with_logits(p_pred[:, :, 2], p_true[:, :, 2])
        spin_loss = (F.smooth_l1_loss(torch.tanh(p_pred[:, :, 3]), p_true[:, :, 3], reduction="none") * moving_mask).sum() / active_denom
        sup_loss = F.binary_cross_entropy_with_logits(p_pred[:, :, 4], p_true[:, :, 4])
        grd_loss = F.binary_cross_entropy_with_logits(p_pred[:, :, 5], p_true[:, :, 5])

        pol_loss = dir_loss + 0.6 * pwr_loss + 0.5 * spin_loss + 0.4 * sup_loss + 0.6 * grd_loss
        return val_loss + 0.85 * pol_loss, val_loss, pol_loss

    n_train = tr_obs.shape[0]
    eff_bs = min(batch_size, n_train)
    t0 = time.perf_counter()
    history = []

    for ep in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n_train, device=target_dev)
        ep_val_loss = 0.0
        ep_pol_loss = 0.0
        steps = 0

        for start in range(0, n_train, eff_bs):
            idx = perm[start : start + eff_bs]
            bx = tr_obs[idx].to(device, non_blocking=True).clone()
            bp = tr_pol[idx].to(device, non_blocking=True).clone()
            bv = tr_val_soft[idx].to(device, non_blocking=True)

            # 50% on-GPU vertical reflection augmentation (zero memory overhead)
            flip_mask = torch.rand(bx.shape[0], device=device) < 0.5
            if flip_mask.any():
                bx[flip_mask.unsqueeze(1) & torch.isin(torch.arange(INPUT_DIM, device=device), obs_flip_idx)] *= -1.0
                bp[flip_mask.unsqueeze(1) & torch.isin(torch.arange(POLICY_DIM, device=device), pol_flip_idx)] *= -1.0

            opt.zero_grad(set_to_none=True)
            if use_bf16:
                with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                    vl, po = model(bx)
                    loss, v_l, p_l = compute_losses(vl, po, bv, bp)
            else:
                vl, po = model(bx)
                loss, v_l, p_l = compute_losses(vl, po, bv, bp)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            opt.step()
            ep_val_loss += float(v_l.detach())
            ep_pol_loss += float(p_l.detach())
            steps += 1

        sched.step()
        model.eval()
        with torch.no_grad():
            v_va, p_va = model(va_obs)
            _, va_vl, va_pl = compute_losses(v_va, p_va, va_val_soft, va_pol)
            probs = F.softmax(v_va, dim=-1)
            pred_edge = probs[:, 0] - probs[:, 1]
            decided_mask = va_raw_goal.abs() > 0.5
            if decided_mask.any():
                val_sign_acc = float(((pred_edge[decided_mask] * va_raw_goal[decided_mask]) > 0).float().mean())
            else:
                val_sign_acc = 0.0

            p_va_3 = p_va.view(-1, 3, 6)
            p_true_3 = va_pol.view(-1, 3, 6)
            mv_m = (p_true_3[:, :, 5] < 0.5) & (p_true_3[:, :, 2] > 0.05)
            if mv_m.any():
                p_norm = F.normalize(p_va_3[:, :, 0:2], dim=-1)
                t_norm = F.normalize(p_true_3[:, :, 0:2], dim=-1)
                cos_sim = float((p_norm * t_norm).sum(dim=-1)[mv_m].mean())
            else:
                cos_sim = 0.0

        history.append({
            "epoch": ep,
            "trainValLoss": round(ep_val_loss / max(1, steps), 4),
            "trainPolLoss": round(ep_pol_loss / max(1, steps), 4),
            "valValLoss": round(float(va_vl), 4),
            "valPolLoss": round(float(va_pl), 4),
            "valGoalSignAcc": round(val_sign_acc, 4),
            "valAngleCos": round(cos_sim, 4),
        })
        if ep == 1 or ep % max(1, epochs // 5) == 0 or ep == epochs:
            print(
                f"  [Epoch {ep:02d}/{epochs:02d}] val_loss={float(va_vl):.4f} pol_loss={float(va_pl):.4f} "
                f"goal_acc={val_sign_acc*100:.1f}% angle_cos={cos_sim:.3f}"
            )

    elapsed = time.perf_counter() - t0
    tensors = [
        model.stem_fc.weight.detach().cpu().numpy().T,
        model.stem_fc.bias.detach().cpu().numpy(),
        model.stem_ln.weight.detach().cpu().numpy(),
        model.stem_ln.bias.detach().cpu().numpy(),
        model.b1.fc.weight.detach().cpu().numpy().T,
        model.b1.fc.bias.detach().cpu().numpy(),
        model.b1.ln.weight.detach().cpu().numpy(),
        model.b1.ln.bias.detach().cpu().numpy(),
        model.b2.fc.weight.detach().cpu().numpy().T,
        model.b2.fc.bias.detach().cpu().numpy(),
        model.b2.ln.weight.detach().cpu().numpy(),
        model.b2.ln.bias.detach().cpu().numpy(),
        model.val_head.weight.detach().cpu().numpy().T,
        model.val_head.bias.detach().cpu().numpy(),
        model.pol_head.weight.detach().cpu().numpy().T,
        model.pol_head.bias.detach().cpu().numpy(),
    ]
    total_params = export_ubnn_tensors(tensors, out_path, hidden_dim, phys_version)
    return {
        "backend": "pytorch",
        "device": dev_name,
        "bf16": use_bf16,
        "vramResident": vram_resident,
        "parameters": total_params,
        "bytes": out_path.stat().st_size,
        "elapsedSeconds": round(elapsed, 2),
        "finalMetrics": history[-1],
        "history": history,
    }


# ---------------------------------------------------------------------------
# Engine 2: Portable Vectorized NumPy AdamW Fallback (CI & CPU-only systems)
# ---------------------------------------------------------------------------
def _silu_fwd(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    sig = 1.0 / (1.0 + np.exp(-np.clip(z, -40.0, 40.0)))
    return z * sig, sig


def _silu_bwd(dout: np.ndarray, z: np.ndarray, sig: np.ndarray) -> np.ndarray:
    return dout * sig * (1.0 + z * (1.0 - sig))


def _ln_fwd(x: np.ndarray, g: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, tuple]:
    mean = x.mean(axis=-1, keepdims=True)
    xc = x - mean
    var = (xc * xc).mean(axis=-1, keepdims=True)
    inv_std = 1.0 / np.sqrt(var + 1e-5)
    xhat = xc * inv_std
    return xhat * g + b, (xhat, inv_std, g)


def _ln_bwd(dout: np.ndarray, cache: tuple) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xhat, inv_std, g = cache
    dg = (dout * xhat).sum(axis=0)
    db = dout.sum(axis=0)
    dxhat = dout * g
    d = xhat.shape[-1]
    dx = (inv_std / d) * (d * dxhat - dxhat.sum(axis=-1, keepdims=True) - xhat * (dxhat * xhat).sum(axis=-1, keepdims=True))
    return dx, dg, db


def train_numpy_fallback(
    train_data: np.ndarray,
    val_data: np.ndarray,
    hidden_dim: int,
    epochs: int,
    batch_size: int,
    lr: float,
    seed: int,
    out_path: Path,
    phys_version: int,
) -> dict:
    rng = np.random.default_rng(seed)
    H = hidden_dim

    def kaiming(in_d: int, out_d: int) -> np.ndarray:
        return (rng.standard_normal((in_d, out_d)) * math.sqrt(2.0 / in_d)).astype(np.float32)

    params = {
        "sW": kaiming(INPUT_DIM, H), "sb": np.zeros(H, dtype=np.float32),
        "sg": np.ones(H, dtype=np.float32), "sbe": np.zeros(H, dtype=np.float32),
        "b1W": kaiming(H, H) * 0.5, "b1b": np.zeros(H, dtype=np.float32),
        "b1g": np.ones(H, dtype=np.float32), "b1be": np.zeros(H, dtype=np.float32),
        "b2W": kaiming(H, H) * 0.5, "b2b": np.zeros(H, dtype=np.float32),
        "b2g": np.ones(H, dtype=np.float32), "b2be": np.zeros(H, dtype=np.float32),
        "vW": kaiming(H, VALUE_DIM) * 0.2, "vb": np.zeros(VALUE_DIM, dtype=np.float32),
        "pW": kaiming(H, POLICY_DIM) * 0.2, "pb": np.zeros(POLICY_DIM, dtype=np.float32),
    }
    m_state = {k: np.zeros_like(v) for k, v in params.items()}
    v_state = {k: np.zeros_like(v) for k, v in params.items()}
    step_num = 0

    tr_obs = train_data[:, :INPUT_DIM]
    tr_pol = train_data[:, INPUT_DIM : INPUT_DIM + POLICY_DIM]
    tr_val = build_soft_value_targets(train_data[:, 214], train_data[:, 215])

    va_obs = val_data[:, :INPUT_DIM]
    va_pol = val_data[:, INPUT_DIM : INPUT_DIM + POLICY_DIM]
    va_val = build_soft_value_targets(val_data[:, 214], val_data[:, 215])
    va_goal = val_data[:, 214]

    def fwd_bwd(bx: np.ndarray, bv: np.ndarray, bp: np.ndarray, need_grad: bool = True):
        N = bx.shape[0]
        z0 = bx @ params["sW"] + params["sb"]
        ln0, c_ln0 = _ln_fwd(z0, params["sg"], params["sbe"])
        h0, sig0 = _silu_fwd(ln0)

        z1 = h0 @ params["b1W"] + params["b1b"]
        ln1, c_ln1 = _ln_fwd(z1, params["b1g"], params["b1be"])
        a1, sig1 = _silu_fwd(ln1)
        h1 = h0 + a1

        z2 = h1 @ params["b2W"] + params["b2b"]
        ln2, c_ln2 = _ln_fwd(z2, params["b2g"], params["b2be"])
        a2, sig2 = _silu_fwd(ln2)
        h2 = h1 + a2

        v_logits = h2 @ params["vW"] + params["vb"]
        p_out = h2 @ params["pW"] + params["pb"]

        vm = v_logits.max(axis=-1, keepdims=True)
        ve = np.exp(v_logits - vm)
        v_probs = ve / ve.sum(axis=-1, keepdims=True)
        val_loss = float(-np.sum(bv * np.log(np.clip(v_probs, 1e-7, 1.0)), axis=-1).mean())

        p3 = p_out.reshape(N, 3, 6)
        t3 = bp.reshape(N, 3, 6)
        mv = ((t3[:, :, 5] < 0.5) & (t3[:, :, 2] > 0.02)).astype(np.float32)
        mv_sum = max(1.0, float(mv.sum()))

        diff_dir = p3[:, :, 0:2] - t3[:, :, 0:2]
        dir_loss = float(0.5 * ((diff_dir * diff_dir).sum(axis=-1) * mv).sum() / mv_sum)

        sig_pwr = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 2], -30, 30)))
        sig_sup = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 4], -30, 30)))
        sig_grd = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 5], -30, 30)))
        th_spin = np.tanh(np.clip(p3[:, :, 3], -15, 15))
        diff_spin = th_spin - t3[:, :, 3]
        spin_loss = float(0.5 * ((diff_spin * diff_spin) * mv).sum() / mv_sum)

        bce = lambda p, y: float(-np.mean(y * np.log(np.clip(p, 1e-7, 1.0)) + (1 - y) * np.log(np.clip(1 - p, 1e-7, 1.0))))
        pol_loss = dir_loss + 0.6 * bce(sig_pwr, t3[:, :, 2]) + 0.5 * spin_loss + 0.4 * bce(sig_sup, t3[:, :, 4]) + 0.6 * bce(sig_grd, t3[:, :, 5])

        if not need_grad:
            return val_loss, pol_loss, v_probs, p_out

        dv = (v_probs - bv) / N
        dp3 = np.zeros_like(p3)
        dp3[:, :, 0:2] = (diff_dir * mv[:, :, None]) / mv_sum
        dp3[:, :, 2] = 0.6 * (sig_pwr - t3[:, :, 2]) / (N * 3)
        dp3[:, :, 3] = 0.5 * (diff_spin * (1.0 - th_spin * th_spin) * mv) / mv_sum
        dp3[:, :, 4] = 0.4 * (sig_sup - t3[:, :, 4]) / (N * 3)
        dp3[:, :, 5] = 0.6 * (sig_grd - t3[:, :, 5]) / (N * 3)
        dp = (0.85 * dp3).reshape(N, POLICY_DIM)

        grads = {}
        grads["vW"] = h2.T @ dv
        grads["vb"] = dv.sum(axis=0)
        grads["pW"] = h2.T @ dp
        grads["pb"] = dp.sum(axis=0)

        dh2 = dv @ params["vW"].T + dp @ params["pW"].T
        dln2 = _silu_bwd(dh2, ln2, sig2)
        dz2, grads["b2g"], grads["b2be"] = _ln_bwd(dln2, c_ln2)
        grads["b2W"] = h1.T @ dz2
        grads["b2b"] = dz2.sum(axis=0)

        dh1 = dh2 + dz2 @ params["b2W"].T
        dln1 = _silu_bwd(dh1, ln1, sig1)
        dz1, grads["b1g"], grads["b1be"] = _ln_bwd(dln1, c_ln1)
        grads["b1W"] = h0.T @ dz1
        grads["b1b"] = dz1.sum(axis=0)

        dh0 = dh1 + dz1 @ params["b1W"].T
        dln0 = _silu_bwd(dh0, ln0, sig0)
        dz0, grads["sg"], grads["sbe"] = _ln_bwd(dln0, c_ln0)
        grads["sW"] = bx.T @ dz0
        grads["sb"] = dz0.sum(axis=0)
        return val_loss, pol_loss, grads

    n_train = len(tr_obs)
    eff_bs = min(batch_size, n_train)
    t0 = time.perf_counter()
    history = []

    for ep in range(1, epochs + 1):
        perm = rng.permutation(n_train)
        ep_vl, ep_pl, steps = 0.0, 0.0, 0
        cur_lr = lr * (0.5 * (1.0 + math.cos(math.pi * (ep - 1) / max(1, epochs))) * 0.95 + 0.05)

        for start in range(0, n_train, eff_bs):
            idx = perm[start : start + eff_bs]
            bx = tr_obs[idx].copy()
            bp = tr_pol[idx].copy()
            bv = tr_val[idx]

            flip = rng.random(len(idx)) < 0.5
            if flip.any():
                bx[np.ix_(flip, Y_FLIP_OBS)] *= -1.0
                bp[np.ix_(flip, Y_FLIP_POL)] *= -1.0

            vl, pl, grads = fwd_bwd(bx, bv, bp, need_grad=True)
            step_num += 1
            bc1 = 1.0 - 0.9 ** step_num
            bc2 = 1.0 - 0.999 ** step_num
            for k, p in params.items():
                g = np.clip(grads[k], -2.0, 2.0)
                if k.endswith("W"):
                    p *= (1.0 - cur_lr * 1e-4)
                m_state[k] = 0.9 * m_state[k] + 0.1 * g
                v_state[k] = 0.999 * v_state[k] + 0.001 * (g * g)
                p -= cur_lr * (m_state[k] / bc1) / (np.sqrt(v_state[k] / bc2) + 1e-8)

            ep_vl += vl
            ep_pl += pl
            steps += 1

        va_vl, va_pl, va_probs, va_pout = fwd_bwd(va_obs, va_val, va_pol, need_grad=False)
        pred_edge = va_probs[:, 0] - va_probs[:, 1]
        dec_m = np.abs(va_goal) > 0.5
        sign_acc = float(np.mean((pred_edge[dec_m] * va_goal[dec_m]) > 0)) if dec_m.any() else 0.0

        p3 = va_pout.reshape(-1, 3, 6)
        t3 = va_pol.reshape(-1, 3, 6)
        mv_m = (t3[:, :, 5] < 0.5) & (t3[:, :, 2] > 0.05)
        if mv_m.any():
            pn = p3[:, :, 0:2] / np.maximum(1e-6, np.linalg.norm(p3[:, :, 0:2], axis=-1, keepdims=True))
            tn = t3[:, :, 0:2] / np.maximum(1e-6, np.linalg.norm(t3[:, :, 0:2], axis=-1, keepdims=True))
            cos_sim = float(((pn * tn).sum(axis=-1))[mv_m].mean())
        else:
            cos_sim = 0.0

        history.append({
            "epoch": ep,
            "trainValLoss": round(ep_vl / max(1, steps), 4),
            "trainPolLoss": round(ep_pl / max(1, steps), 4),
            "valValLoss": round(va_vl, 4),
            "valPolLoss": round(va_pl, 4),
            "valGoalSignAcc": round(sign_acc, 4),
            "valAngleCos": round(cos_sim, 4),
        })
        if ep == 1 or ep % max(1, epochs // 5) == 0 or ep == epochs:
            print(
                f"  [Epoch {ep:02d}/{epochs:02d}] val_loss={va_vl:.4f} pol_loss={va_pl:.4f} "
                f"goal_acc={sign_acc*100:.1f}% angle_cos={cos_sim:.3f}"
            )

    elapsed = time.perf_counter() - t0
    tensors = [
        params["sW"], params["sb"], params["sg"], params["sbe"],
        params["b1W"], params["b1b"], params["b1g"], params["b1be"],
        params["b2W"], params["b2b"], params["b2g"], params["b2be"],
        params["vW"], params["vb"],
        params["pW"], params["pb"],
    ]
    total_params = export_ubnn_tensors(tensors, out_path, hidden_dim, phys_version)
    return {
        "backend": "numpy-fallback",
        "device": "CPU (NumPy)",
        "bf16": False,
        "vramResident": False,
        "parameters": total_params,
        "bytes": out_path.stat().st_size,
        "elapsedSeconds": round(elapsed, 2),
        "finalMetrics": history[-1],
        "history": history,
    }


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Train Ububall Neural CPU model and export UBNN fp16 weights.")
    parser.add_argument("--shards", type=Path, default=root / "personal" / "nn-shards", help="Directory containing .bin shards")
    parser.add_argument("--out", type=Path, default=root / "web" / "assets" / "ububall-net.bin", help="Output .bin weight path")
    parser.add_argument("--report", type=Path, default=root / "personal" / "nn-train-report.json", help="Training metrics JSON output")
    parser.add_argument("--hidden", type=int, default=256, help="Hidden trunk dimension (default: 256)")
    parser.add_argument("--epochs", type=int, default=20, help="Training epochs (default: 20)")
    parser.add_argument("--batch-size", type=int, default=4096, help="Mini-batch size (default: 4096 for RTX 4090)")
    parser.add_argument("--lr", type=float, default=3e-4, help="Peak AdamW learning rate")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--backend", choices=["auto", "torch", "numpy"], default="auto", help="Training backend")
    args = parser.parse_args()

    data, phys_version = load_shards(args.shards)
    train_data, val_data = split_train_val(data, val_frac=0.10)
    print(f"[train-nn] Loaded {len(data):,} rows ({len(train_data):,} train, {len(val_data):,} val), physVersion={phys_version}")

    use_torch = False
    if args.backend in ("auto", "torch"):
        try:
            import torch  # noqa: F401
            use_torch = True
        except ImportError:
            if args.backend == "torch":
                raise
            print("[train-nn] PyTorch not installed in current Python; using vectorized NumPy AdamW fallback.")

    if use_torch:
        res = train_pytorch(train_data, val_data, args.hidden, args.epochs, args.batch_size, args.lr, args.seed, args.out, phys_version)
    else:
        eff_bs = min(args.batch_size, 512)
        res = train_numpy_fallback(train_data, val_data, args.hidden, args.epochs, eff_bs, args.lr * 3.0, args.seed, args.out, phys_version)

    res["trainRows"] = int(len(train_data))
    res["valRows"] = int(len(val_data))
    res["physVersion"] = phys_version
    res["outPath"] = str(args.out)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
    print(f"[train-nn] Exported {res['parameters']:,} params ({res['bytes'] / 1024:.1f} KB) -> {args.out}")


if __name__ == "__main__":
    main()
