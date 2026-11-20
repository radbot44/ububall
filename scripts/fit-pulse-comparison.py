"""Fine-tune two UBNN policy heads on identical frozen incumbent activations."""
import json
import hashlib
import struct
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F


def load_positions(directory, seeds):
    rows = (row for seed in seeds for row in json.loads((directory / f"seed-{seed}.json").read_text()))
    hidden, skaters = [], []
    roots, policies, scores, teachers = [], [], [], []
    better, worse, weights = [], [], []
    for i, row in enumerate(rows):
        hidden.append(row["hidden"])
        skaters.append(row["obs"][:141])
        start = len(scores)
        candidates = row["candidates"]
        for candidate in candidates:
            if "teacher" in candidate["sources"]:
                teachers.append(len(scores))
            roots.append(i)
            policies.append(candidate["policy"])
            scores.append(sum(o["net"] for o in candidate["outcomes"]) / len(row["replies"]))
        pairs = [(a, b) for a in range(start, len(scores)) for b in range(start, len(scores)) if scores[a] > scores[b]]
        for a, b in pairs:
            better.append(a)
            worse.append(b)
            weights.append(1 / len(pairs))
    return dict(hidden=torch.tensor(hidden), skaters=torch.tensor(skaters).reshape(-1, 3, 47), roots=torch.tensor(roots),
                policies=torch.tensor(policies).reshape(-1, 3, 6), scores=torch.tensor(scores),
                teachers=torch.tensor(teachers), better=torch.tensor(better, dtype=torch.long),
                worse=torch.tensor(worse, dtype=torch.long), weights=torch.tensor(weights))


def plan_cost(data, weight, bias):
    roots = data["roots"]
    pred = (data["hidden"] @ weight + bias)[roots].reshape(-1, 3, 6)
    target = data["policies"]
    active = data["skaters"][roots, :, 5] > 0.5
    launch = active & (target[:, :, 5] < 0.5)
    moving = launch & (target[:, :, 2] > 0.02)
    charged = active & (data["skaters"][roots, :, 9] >= 0.999)

    def masked(values, mask):
        return (values * mask).sum(1) / mask.sum(1).clamp_min(1)

    direction = pred[:, :, :2]
    angle = F.smooth_l1_loss(F.normalize(direction, dim=2), target[:, :, :2], reduction="none").sum(2)
    angle += 0.05 * (direction.norm(dim=2) - 1).square()
    spin = F.smooth_l1_loss(pred[:, :, 3].tanh(), target[:, :, 3], reduction="none")

    def binary(channel):
        return F.binary_cross_entropy_with_logits(pred[:, :, channel], target[:, :, channel], reduction="none")

    return (masked(angle, moving) + 0.6 * masked(binary(2), launch) + 0.5 * masked(spin, moving)
            + 0.4 * masked(binary(4), charged) + 0.6 * masked(binary(5), active))


def metrics(data, cost):
    scores, roots = data["scores"], data["roots"]
    picks = [scores[roots == i][cost[roots == i].argmin()].item() for i in range(len(data["hidden"]))]
    margins = cost[data["worse"]] - cost[data["better"]]
    weights = data["weights"]
    return dict(positions=len(picks), candidates=len(cost), unequalPairs=len(margins),
                informativePositions=round(weights.sum().item()),
                pairAccuracy=((margins.gt(0).float() * weights).sum() / weights.sum()).item() if len(margins) else None,
                selectedNetPerReply=float(np.mean(picks)))


def main(directory):
    torch.set_num_threads(1)
    manifest = json.loads((directory / "manifest.json").read_text())
    blob = (directory / "incumbent.bin").read_bytes()
    if hashlib.sha256(blob).hexdigest() != manifest["incumbentSHA256"]:
        raise ValueError("Stored activations require the original incumbent.")
    train, holdout = [load_positions(directory, manifest["seeds"][k]) for k in ("train", "holdout")]
    if not len(train["better"]):
        raise ValueError("No candidate pairs with different reply outcomes in training data.")
    magic, version, hidden, inputs, layers, physics = struct.unpack_from("<4sHHHHI", blob)
    if (magic, version, inputs, layers, physics) != (b"UBNN", 2, 315, 3, manifest["physics"]):
        raise ValueError("Incompatible incumbent header.")
    head_size = (hidden + 1) * 18 * 2
    head = torch.from_numpy(np.frombuffer(blob[-head_size:], dtype="<f2").astype(np.float32))
    report = {}
    for name in ("incumbent", "control", "comparison"):
        weight = head[:-18].reshape(hidden, 18).clone().requires_grad_()
        bias = head[-18:].clone().requires_grad_()
        if name != "incumbent":
            optimizer = torch.optim.AdamW([weight, bias], lr=0.0003, weight_decay=0)
            for _ in range(24):
                costs = plan_cost(train, weight, bias)
                loss = costs[train["teachers"]].mean()
                if name == "comparison":
                    margins = costs[train["better"]] - costs[train["worse"]]
                    weights = train["weights"]
                    loss = loss + (F.softplus(margins) * weights).sum() / weights.sum()
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            tensors = torch.cat([weight.detach().flatten(), bias.detach()]).numpy().astype("<f2")
            if not np.isfinite(tensors).all():
                raise ValueError("Non-finite policy weights.")
            (directory / f"{name}.bin").write_bytes(blob[:-head_size] + tensors.tobytes())
        with torch.no_grad():
            report[name] = {key: metrics(data, plan_cost(data, weight.half().float(), bias.half().float()))
                            for key, data in (("train", train), ("holdout", holdout))}
    (directory / "training.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
