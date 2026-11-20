#!/usr/bin/env python3
"""
VRAM-Resident RTX 4090 PyTorch Trainer (+ Portable NumPy Fallback) for Ububall Neural CPU.

Reads UBNN v2 binary shards from `personal/nn-shards/` (written by `scripts/nn-generate.cjs`),
applies 2x vertical rink reflection augmentation (yielding 4x effective samples per simulated turn),
trains `UbuballNet` (315 -> 256 -> 256 -> 256 residual LayerNorm + SiLU trunk -> Value[3] + Policy[18]),
and exports little-endian float16 `UBNN` weights to `web/assets/ububall-net.bin`.

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
NN_FORMAT = 2
SKATER_FLOATS = 47
BALL_START = 6 * SKATER_FLOATS
MATCH_START = BALL_START + 17
INPUT_DIM = MATCH_START + 16
POLICY_DIM = 18
VALUE_DIM = 3
NEXT_GOAL = INPUT_DIM + POLICY_DIM
TURNS_TO_GOAL = NEXT_GOAL + 1
ROW_FLOATS = TURNS_TO_GOAL + 1

# Exact signed channels negated under vertical reflection (y -> 600 - y)
Y_FLIP_OBS = [
    *(i * SKATER_FLOATS + k for i in range(6) for k in (1, 3, 4)),
    *(BALL_START + k for k in (1, 3, 4, 16)),
]
Y_FLIP_POL = [1, 3, 7, 9, 13, 15]


def load_shards(shard_dir: Path) -> tuple[list[np.ndarray], int, str]:
    manifest_path = shard_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing {manifest_path}. Generate UBNN v{NN_FORMAT} shards with npm run nn:gen.")
    meta = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {"format": NN_FORMAT, "rowFloats": ROW_FLOATS, "inputDim": INPUT_DIM, "policyDim": POLICY_DIM}
    if any(meta.get(key) != value for key, value in expected.items()):
        raise ValueError(f"Incompatible UBNN shard manifest. Generate UBNN v{NN_FORMAT} shards with npm run nn:gen.")
    phys_version = meta.get("physVersion")
    if type(phys_version) is not int or not 0 < phys_version <= 0xFFFFFFFF:
        raise ValueError(f"Invalid physics version in {manifest_path}.")

    files = sorted(glob.glob(str(shard_dir / "*.bin")))
    if not files:
        raise FileNotFoundError(f"No .bin shards found in {shard_dir}. Run `npm run nn:gen` first.")

    arrays = []
    for fpath in files:
        mm = np.memmap(fpath, dtype="<f4", mode="r")
        if mm.size % ROW_FLOATS != 0:
            raise ValueError(f"Shard {fpath} float count {mm.size} is not divisible by {ROW_FLOATS}.")
        arrays.append(np.array(mm.reshape(-1, ROW_FLOATS), dtype=np.float32, copy=True))
    return arrays, phys_version, str(meta.get("mode", "mixed"))


def split_train_val(shards: list[np.ndarray], val_frac: float = 0.10) -> tuple[np.ndarray, np.ndarray]:
    # Hold out whole shards when >= 4 shards exist so no round is split across train/val.
    if len(shards) >= 4:
        val_shards = max(1, min(len(shards) - 1, int(round(len(shards) * val_frac))))
        train_data = np.concatenate(shards[:-val_shards], axis=0)
        val_data = np.concatenate(shards[-val_shards:], axis=0)
        return train_data, val_data

    data = np.concatenate(shards, axis=0)
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


def build_soft_value_targets(next_goal: np.ndarray, turns_to_goal: np.ndarray, gamma: float = 0.985) -> tuple[np.ndarray, np.ndarray]:
    """
    Smooths discounted next-goal outcomes into a 3-class distribution [p_score, p_concede, p_draw]
    so faster goals earn strictly higher value than long scrambles, plus a validity mask excluding
    censored/perturbed rows marked with next_goal <= -1.5.
    """
    n = len(next_goal)
    targets = np.zeros((n, 3), dtype=np.float32)
    valid = (next_goal > -1.5) & np.isfinite(next_goal)
    disc = np.power(gamma, np.clip(turns_to_goal, 0.0, 240.0)).astype(np.float32)
    win = valid & (next_goal > 0.5)
    loss = valid & (next_goal < -0.5)
    draw = valid & ~(win | loss)

    targets[win, 0] = 0.5 + 0.5 * disc[win]
    targets[win, 2] = 1.0 - targets[win, 0]

    targets[loss, 1] = 0.5 + 0.5 * disc[loss]
    targets[loss, 2] = 1.0 - targets[loss, 1]

    targets[draw, 2] = 1.0
    return targets, valid.astype(np.float32)


def pulse_policy_weights(data: np.ndarray, focus: str = "pulse") -> np.ndarray:
    """Upweight tactical Pulse rows using only UBNN v2 observations and labels."""
    skaters = data[:, :BALL_START].reshape(-1, 6, SKATER_FLOATS)
    own = skaters[:, :3]
    plans = data[:, INPUT_DIM:NEXT_GOAL].reshape(-1, 3, 6)
    pulse = data[:, MATCH_START + 1] > 0.5
    immediate_goal = (np.abs(data[:, NEXT_GOAL]) == 1) & (data[:, TURNS_TO_GOAL] == 0)
    ball_speed = np.hypot(data[:, BALL_START + 2], data[:, BALL_START + 3]) * 1200
    own_access = data[:, MATCH_START + 12] * 600
    opp_access = data[:, MATCH_START + 13] * 600
    held = (skaters[:, :, 10] > 0.5).any(axis=1)
    race = (~held) & (ball_speed > 55) & (np.maximum(own_access, opp_access) < 300) & (np.abs(own_access - opp_access) < 120)
    guarding = ((own[:, :, 5] > 0.5) & (plans[:, :, 5] > 0.5)).any(axis=1)
    defensive_guard = guarding & (data[:, BALL_START] < 0) & (opp_access < 180)
    charged_super = ((own[:, :, 5] > 0.5) & (own[:, :, 9] >= 0.999) & (plans[:, :, 4] > 0.5)).any(axis=1)
    if focus == "immediate":
        added = 0.75 * immediate_goal
    elif focus == "defense":
        added = 0.75 * defensive_guard
    else:
        added = 0.75 * immediate_goal + 0.35 * race + 0.35 * (defensive_guard | charged_super)
    return np.minimum(2.0, 1.0 + pulse * added).astype(np.float32)


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
    gamma: float,
    policy_weights: np.ndarray | None = None,
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

    # Move the dataset directly into VRAM when <= 16 GB.
    vram_resident = device.type == "cuda" and train_data.nbytes <= 16 * (1024 ** 3)
    target_dev = device if vram_resident else torch.device("cpu")

    tr_val_np, tr_vmask_np = build_soft_value_targets(train_data[:, NEXT_GOAL], train_data[:, TURNS_TO_GOAL], gamma)
    va_val_np, va_vmask_np = build_soft_value_targets(val_data[:, NEXT_GOAL], val_data[:, TURNS_TO_GOAL], gamma)

    tr_obs = torch.from_numpy(train_data[:, :INPUT_DIM]).to(target_dev)
    tr_pol = torch.from_numpy(train_data[:, INPUT_DIM:NEXT_GOAL]).to(target_dev)
    tr_val_soft = torch.from_numpy(tr_val_np).to(target_dev)
    tr_val_mask = torch.from_numpy(tr_vmask_np).to(target_dev)
    tr_pol_weights = None if policy_weights is None else torch.from_numpy(policy_weights).to(target_dev)

    va_obs = torch.from_numpy(val_data[:, :INPUT_DIM]).to(target_dev)
    va_pol = torch.from_numpy(val_data[:, INPUT_DIM:NEXT_GOAL]).to(target_dev)
    va_val_soft = torch.from_numpy(va_val_np).to(target_dev)
    va_val_mask = torch.from_numpy(va_vmask_np).to(target_dev)
    va_raw_goal = torch.from_numpy(val_data[:, NEXT_GOAL]).to(target_dev)

    obs_flip_idx = torch.tensor(Y_FLIP_OBS, dtype=torch.long, device=device)
    pol_flip_idx = torch.tensor(Y_FLIP_POL, dtype=torch.long, device=device)
    obs_flip_bool = torch.zeros(INPUT_DIM, dtype=torch.bool, device=device)
    obs_flip_bool[obs_flip_idx] = True
    pol_flip_bool = torch.zeros(POLICY_DIM, dtype=torch.bool, device=device)
    pol_flip_bool[pol_flip_idx] = True

    def compute_losses(
        bx_in: torch.Tensor,
        v_logits: torch.Tensor,
        p_out: torch.Tensor,
        y_val: torch.Tensor,
        y_vmask: torch.Tensor,
        y_pol: torch.Tensor,
        row_weights: torch.Tensor | None = None,
    ):
        log_probs = F.log_softmax(v_logits, dim=-1)
        val_per_row = -(y_val * log_probs).sum(dim=-1)
        val_loss = (val_per_row * y_vmask).sum() / y_vmask.sum().clamp_min(1.0)

        p_pred = p_out.view(-1, 3, 6)
        p_true = y_pol.view(-1, 3, 6)
        own_sk = bx_in[:, : 3 * SKATER_FLOATS].view(-1, 3, SKATER_FLOATS)
        active_bool = own_sk[:, :, 5] > 0.5
        classic_bool = bx_in[:, BALL_START + 17 : BALL_START + 18] > 0.5
        charged_bool = own_sk[:, :, 9] >= 0.999

        grd_mask = active_bool.float()
        not_guard = p_true[:, :, 5] < 0.5
        pwr_mask = (active_bool & not_guard).float()
        sup_mask = (active_bool & (~classic_bool) & charged_bool).float()
        moving_mask = (active_bool & not_guard & (p_true[:, :, 2] > 0.02)).float()

        if row_weights is not None:
            weight = row_weights[:, None]
            grd_mask = grd_mask * weight
            pwr_mask = pwr_mask * weight
            sup_mask = sup_mask * weight
            moving_mask = moving_mask * weight

        active_denom = moving_mask.sum().clamp_min(1.0)
        grd_denom = grd_mask.sum().clamp_min(1.0)
        pwr_denom = pwr_mask.sum().clamp_min(1.0)
        sup_denom = sup_mask.sum().clamp_min(1.0)

        raw_dir = p_pred[:, :, 0:2]
        dir_norm = raw_dir.norm(dim=-1, keepdim=True).clamp_min(1e-6)
        unit_dir = raw_dir / dir_norm
        dir_l = (F.smooth_l1_loss(unit_dir, p_true[:, :, 0:2], reduction="none").sum(dim=-1) * moving_mask).sum() / active_denom
        norm_pen = (((dir_norm.squeeze(-1) - 1.0) ** 2) * moving_mask).sum() / active_denom
        dir_loss = dir_l + 0.05 * norm_pen

        pwr_loss = (F.binary_cross_entropy_with_logits(p_pred[:, :, 2], p_true[:, :, 2], reduction="none") * pwr_mask).sum() / pwr_denom
        spin_loss = (F.smooth_l1_loss(torch.tanh(p_pred[:, :, 3]), p_true[:, :, 3], reduction="none") * moving_mask).sum() / active_denom
        sup_loss = (F.binary_cross_entropy_with_logits(p_pred[:, :, 4], p_true[:, :, 4], reduction="none") * sup_mask).sum() / sup_denom
        grd_loss = (F.binary_cross_entropy_with_logits(p_pred[:, :, 5], p_true[:, :, 5], reduction="none") * grd_mask).sum() / grd_denom

        pol_loss = dir_loss + 0.6 * pwr_loss + 0.5 * spin_loss + 0.4 * sup_loss + 0.6 * grd_loss
        return val_loss + 0.85 * pol_loss, val_loss, pol_loss

    n_train = tr_obs.shape[0]
    n_val = va_obs.shape[0]
    eff_bs = min(batch_size, n_train)
    val_bs = min(max(batch_size, 4096), n_val)
    t0 = time.perf_counter()
    history = []
    best_val_total = float("inf")
    best_epoch = 1
    best_state = None

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
            bm = tr_val_mask[idx].to(device, non_blocking=True)
            pw = None if tr_pol_weights is None else tr_pol_weights[idx].to(device, non_blocking=True)

            # 50% on-GPU vertical reflection augmentation (zero memory overhead)
            flip_mask = torch.rand(bx.shape[0], device=device) < 0.5
            if flip_mask.any():
                bx[flip_mask.unsqueeze(1) & obs_flip_bool] *= -1.0
                bp[flip_mask.unsqueeze(1) & pol_flip_bool] *= -1.0

            opt.zero_grad(set_to_none=True)
            if use_bf16:
                with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                    vl, po = model(bx)
                    loss, v_l, p_l = compute_losses(bx, vl, po, bv, bm, bp, pw)
            else:
                vl, po = model(bx)
                loss, v_l, p_l = compute_losses(bx, vl, po, bv, bm, bp, pw)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            opt.step()
            ep_val_loss += float(v_l.detach())
            ep_pol_loss += float(p_l.detach())
            steps += 1

        sched.step()
        model.eval()
        va_vl_sum = 0.0
        va_pl_sum = 0.0
        va_rows_seen = 0
        dec_correct = 0.0
        dec_total = 0.0
        cos_sum = 0.0
        cos_total = 0.0
        with torch.no_grad():
            for v_start in range(0, n_val, val_bs):
                v_end = min(n_val, v_start + val_bs)
                vbx = va_obs[v_start:v_end].to(device, non_blocking=True)
                vbp = va_pol[v_start:v_end].to(device, non_blocking=True)
                vbv = va_val_soft[v_start:v_end].to(device, non_blocking=True)
                vbm = va_val_mask[v_start:v_end].to(device, non_blocking=True)
                vrg = va_raw_goal[v_start:v_end].to(device, non_blocking=True)

                if use_bf16:
                    with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                        v_va, p_va = model(vbx)
                        _, b_vl, b_pl = compute_losses(vbx, v_va, p_va, vbv, vbm, vbp)
                else:
                    v_va, p_va = model(vbx)
                    _, b_vl, b_pl = compute_losses(vbx, v_va, p_va, vbv, vbm, vbp)

                bn = vbx.shape[0]
                va_vl_sum += float(b_vl) * bn
                va_pl_sum += float(b_pl) * bn
                va_rows_seen += bn

                probs = F.softmax(v_va.float(), dim=-1)
                pred_edge = probs[:, 0] - probs[:, 1]
                decided_mask = (vrg.abs() > 0.5) & (vrg > -1.5)
                if decided_mask.any():
                    dec_correct += float(((pred_edge[decided_mask] * vrg[decided_mask]) > 0).float().sum())
                    dec_total += float(decided_mask.sum())

                p_va_3 = p_va.float().view(-1, 3, 6)
                p_true_3 = vbp.view(-1, 3, 6)
                mv_m = (p_true_3[:, :, 5] < 0.5) & (p_true_3[:, :, 2] > 0.05)
                if mv_m.any():
                    p_norm = F.normalize(p_va_3[:, :, 0:2], dim=-1)
                    t_norm = F.normalize(p_true_3[:, :, 0:2], dim=-1)
                    cos_sum += float((p_norm * t_norm).sum(dim=-1)[mv_m].sum())
                    cos_total += float(mv_m.sum())

        va_vl = va_vl_sum / max(1, va_rows_seen)
        va_pl = va_pl_sum / max(1, va_rows_seen)
        va_total = va_vl + 0.85 * va_pl
        if va_total < best_val_total:
            best_val_total = va_total
            best_epoch = ep
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

        val_sign_acc = dec_correct / dec_total if dec_total > 0 else 0.0
        cos_sim = cos_sum / cos_total if cos_total > 0 else 0.0

        history.append({
            "epoch": ep,
            "trainValLoss": round(ep_val_loss / max(1, steps), 4),
            "trainPolLoss": round(ep_pol_loss / max(1, steps), 4),
            "valValLoss": round(va_vl, 4),
            "valPolLoss": round(va_pl, 4),
            "valGoalSignAcc": round(val_sign_acc, 4),
            "valAngleCos": round(cos_sim, 4),
        })
        if ep == 1 or ep % max(1, epochs // 5) == 0 or ep == epochs:
            print(
                f"  [Epoch {ep:02d}/{epochs:02d}] val_loss={va_vl:.4f} pol_loss={va_pl:.4f} "
                f"goal_acc={val_sign_acc*100:.1f}% angle_cos={cos_sim:.3f}"
            )

    if best_state is not None:
        model.load_state_dict(best_state)
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
        "gamma": gamma,
        "bestEpoch": best_epoch,
        "parameters": total_params,
        "bytes": out_path.stat().st_size,
        "elapsedSeconds": round(elapsed, 2),
        "finalMetrics": history[best_epoch - 1],
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
    gamma: float,
    policy_weights: np.ndarray | None = None,
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
    tr_pol = train_data[:, INPUT_DIM:NEXT_GOAL]
    tr_val, tr_vmask = build_soft_value_targets(train_data[:, NEXT_GOAL], train_data[:, TURNS_TO_GOAL], gamma)

    va_obs = val_data[:, :INPUT_DIM]
    va_pol = val_data[:, INPUT_DIM:NEXT_GOAL]
    va_val, va_vmask = build_soft_value_targets(val_data[:, NEXT_GOAL], val_data[:, TURNS_TO_GOAL], gamma)
    va_goal = val_data[:, NEXT_GOAL]

    def fwd_bwd(bx: np.ndarray, bv: np.ndarray, bm: np.ndarray, bp: np.ndarray, need_grad: bool = True, row_weights: np.ndarray | None = None):
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
        vm_sum = max(1.0, float(bm.sum()))
        val_per_row = -np.sum(bv * np.log(np.clip(v_probs, 1e-7, 1.0)), axis=-1)
        val_loss = float((val_per_row * bm).sum() / vm_sum)

        p3 = p_out.reshape(N, 3, 6)
        t3 = bp.reshape(N, 3, 6)
        own_sk = bx[:, : 3 * SKATER_FLOATS].reshape(N, 3, SKATER_FLOATS)
        active = own_sk[:, :, 5] > 0.5
        classic_m = bx[:, BALL_START + 17 : BALL_START + 18] > 0.5
        charged = own_sk[:, :, 9] >= 0.999

        grd_m = active.astype(np.float32)
        not_grd = t3[:, :, 5] < 0.5
        pwr_m = (active & not_grd).astype(np.float32)
        sup_m = (active & (~classic_m) & charged).astype(np.float32)
        mv = (active & not_grd & (t3[:, :, 2] > 0.02)).astype(np.float32)

        if row_weights is not None:
            weight = row_weights[:, None]
            grd_m *= weight
            pwr_m *= weight
            sup_m *= weight
            mv *= weight

        mv_sum = max(1.0, float(mv.sum()))
        grd_sum = max(1.0, float(grd_m.sum()))
        pwr_sum = max(1.0, float(pwr_m.sum()))
        sup_sum = max(1.0, float(sup_m.sum()))

        raw_dir = p3[:, :, 0:2]
        dir_norm = np.maximum(1e-6, np.linalg.norm(raw_dir, axis=-1, keepdims=True))
        unit_dir = raw_dir / dir_norm
        diff_dir = unit_dir - t3[:, :, 0:2]
        norm_err = dir_norm.squeeze(-1) - 1.0
        dir_loss = float((((0.5 * (diff_dir * diff_dir).sum(axis=-1) + 0.05 * (norm_err * norm_err)) * mv).sum()) / mv_sum)

        sig_pwr = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 2], -30, 30)))
        sig_sup = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 4], -30, 30)))
        sig_grd = 1.0 / (1.0 + np.exp(-np.clip(p3[:, :, 5], -30, 30)))
        th_spin = np.tanh(np.clip(p3[:, :, 3], -15, 15))
        diff_spin = th_spin - t3[:, :, 3]
        spin_loss = float(0.5 * ((diff_spin * diff_spin) * mv).sum() / mv_sum)

        bce_masked = lambda p, y, m, denom: float((-(y * np.log(np.clip(p, 1e-7, 1.0)) + (1 - y) * np.log(np.clip(1 - p, 1e-7, 1.0))) * m).sum() / denom)
        pol_loss = (
            dir_loss
            + 0.6 * bce_masked(sig_pwr, t3[:, :, 2], pwr_m, pwr_sum)
            + 0.5 * spin_loss
            + 0.4 * bce_masked(sig_sup, t3[:, :, 4], sup_m, sup_sum)
            + 0.6 * bce_masked(sig_grd, t3[:, :, 5], grd_m, grd_sum)
        )

        if not need_grad:
            return val_loss, pol_loss, v_probs, p_out

        dv = ((v_probs - bv) * bm[:, None]) / vm_sum
        dp3 = np.zeros_like(p3)
        proj = (diff_dir * unit_dir).sum(axis=-1, keepdims=True)
        d_raw_dir = (diff_dir - proj * unit_dir) / dir_norm + 0.10 * norm_err[:, :, None] * unit_dir
        dp3[:, :, 0:2] = (d_raw_dir * mv[:, :, None]) / mv_sum
        dp3[:, :, 2] = 0.6 * ((sig_pwr - t3[:, :, 2]) * pwr_m) / pwr_sum
        dp3[:, :, 3] = 0.5 * (diff_spin * (1.0 - th_spin * th_spin) * mv) / mv_sum
        dp3[:, :, 4] = 0.4 * ((sig_sup - t3[:, :, 4]) * sup_m) / sup_sum
        dp3[:, :, 5] = 0.6 * ((sig_grd - t3[:, :, 5]) * grd_m) / grd_sum
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
    best_val_total = float("inf")
    best_epoch = 1
    best_params = None

    for ep in range(1, epochs + 1):
        perm = rng.permutation(n_train)
        ep_vl, ep_pl, steps = 0.0, 0.0, 0
        cur_lr = lr * (0.5 * (1.0 + math.cos(math.pi * (ep - 1) / max(1, epochs))) * 0.95 + 0.05)

        for start in range(0, n_train, eff_bs):
            idx = perm[start : start + eff_bs]
            bx = tr_obs[idx].copy()
            bp = tr_pol[idx].copy()
            bv = tr_val[idx]
            bm = tr_vmask[idx]

            flip = rng.random(len(idx)) < 0.5
            if flip.any():
                bx[np.ix_(flip, Y_FLIP_OBS)] *= -1.0
                bp[np.ix_(flip, Y_FLIP_POL)] *= -1.0

            pw = None if policy_weights is None else policy_weights[idx]
            vl, pl, grads = fwd_bwd(bx, bv, bm, bp, row_weights=pw)
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

        va_vl, va_pl, va_probs, va_pout = fwd_bwd(va_obs, va_val, va_vmask, va_pol, need_grad=False)
        va_total = va_vl + 0.85 * va_pl
        if va_total < best_val_total:
            best_val_total = va_total
            best_epoch = ep
            best_params = {k: v.copy() for k, v in params.items()}

        pred_edge = va_probs[:, 0] - va_probs[:, 1]
        dec_m = (np.abs(va_goal) > 0.5) & (va_goal > -1.5)
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

    if best_params is not None:
        params = best_params
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
        "gamma": gamma,
        "bestEpoch": best_epoch,
        "parameters": total_params,
        "bytes": out_path.stat().st_size,
        "elapsedSeconds": round(elapsed, 2),
        "finalMetrics": history[best_epoch - 1],
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
    parser.add_argument("--gamma", type=float, default=None, help="Per-turn value discount (default: 0.993 for Pulse, 0.985 otherwise)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--policy-focus", choices=["uniform", "pulse", "immediate", "defense"], default="uniform", help="Upweight selected Pulse positions in the training policy loss")
    parser.add_argument("--backend", choices=["auto", "torch", "numpy"], default="auto", help="Training backend")
    args = parser.parse_args()

    shards, phys_version, shard_mode = load_shards(args.shards)
    gamma = args.gamma if args.gamma is not None else (0.993 if "pulse" in shard_mode.lower() else 0.985)
    train_data, val_data = split_train_val(shards, val_frac=0.10)
    policy_weights = None if args.policy_focus == "uniform" else pulse_policy_weights(train_data, args.policy_focus)
    total_rows = len(train_data) + len(val_data)
    print(f"[train-nn] Loaded {total_rows:,} rows across {len(shards)} shards ({len(train_data):,} train, {len(val_data):,} val), mode={shard_mode}, gamma={gamma}, physVersion={phys_version}")

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
        res = train_pytorch(train_data, val_data, args.hidden, args.epochs, args.batch_size, args.lr, args.seed, args.out, phys_version, gamma, policy_weights)
    else:
        eff_bs = min(args.batch_size, 512)
        res = train_numpy_fallback(train_data, val_data, args.hidden, args.epochs, eff_bs, args.lr * 3.0, args.seed, args.out, phys_version, gamma, policy_weights)

    res["trainRows"] = int(len(train_data))
    res["valRows"] = int(len(val_data))
    res["physVersion"] = phys_version
    res["policyFocus"] = args.policy_focus
    if policy_weights is not None:
        res["policyWeights"] = {"upweightedRows": int((policy_weights > 1).sum()), "mean": float(policy_weights.mean())}
    res["outPath"] = str(args.out)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
    print(f"[train-nn] Exported {res['parameters']:,} params ({res['bytes'] / 1024:.1f} KB) -> {args.out}")


if __name__ == "__main__":
    main()
