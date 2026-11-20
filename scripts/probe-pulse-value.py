"""Check whether a one-turn value head can order scoreless sibling branches."""
import json
import hashlib
import struct
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F


def frozen_layers(blob):
    magic, version, width, inputs, layers, _ = struct.unpack_from("<4sHHHHI", blob)
    if (magic, version, inputs, layers) != (b"UBNN", 2, 315, 3):
        raise ValueError("Expected a UBNN v2 incumbent")
    values = torch.from_numpy(np.frombuffer(blob[16:], dtype="<f2").astype(np.float32))
    blocks, offset = [], 0
    for dim in (inputs, width, width):
        end = offset + dim * width
        w = values[offset:end].reshape(dim, width)
        bias, gain, shift = values[end:end + 3 * width].reshape(3, width)
        blocks.append((w, bias, gain, shift))
        offset = end + 3 * width
    end = offset + width * 3
    return blocks, values[offset:end].reshape(width, 3), values[end:end + 3], 16 + 2 * offset


def encode(x, blocks):
    for index, (weight, bias, gain, shift) in enumerate(blocks):
        projected = x @ weight + bias
        activated = F.silu(F.layer_norm(projected, (len(bias),), gain, shift))
        x = activated if index == 0 else x + activated
    return x


def dataset(directory, seeds, blocks):
    hidden, labels, groups = [], [], []
    for seed in seeds:
        states = []
        for row in json.loads((directory / f"seed-{seed}.json").read_text()):
            for reply in range(len(row["replies"])):
                start = len(labels)
                for candidate in row["candidates"]:
                    outcome = candidate["outcomes"][reply]
                    if outcome["endpoint"] is None:
                        continue
                    states.append(outcome["endpoint"])
                    goal = outcome["goals"][1]
                    labels.append(2 if goal is None else int(goal != row["team"]))
                if len(labels) > start:
                    groups.append((start, len(labels)))
        if states:
            hidden.append(encode(torch.tensor(states), blocks))
    return torch.cat(hidden), torch.tensor(labels), groups


def report(data, weight, bias):
    hidden, labels, groups = data
    probs = (hidden @ weight + bias).softmax(1)
    edges = (probs[:, 0] - probs[:, 1]).numpy()
    goals = np.choose(labels.numpy(), [1, -1, 0])
    accuracies, selected = [], []
    for start, end in groups:
        goal, edge = goals[start:end], edges[start:end]
        preferences = goal[:, None] > goal[None, :]
        if preferences.any():
            predicted = (edge[:, None] - edge[None, :])[preferences]
            accuracies.append(np.mean((predicted > 0) + 0.5 * (predicted == 0)))
        selected.append(goal[edge.argmax()])
    return {"endpoints": len(labels), "replyGroups": len(groups), "informativeGroups": len(accuracies),
            "siblingAccuracy": float(np.mean(accuracies)) if accuracies else None,
            "selectedNetPerGroup": float(np.mean(selected))}


def main(directory):
    torch.set_num_threads(2)
    manifest = json.loads((directory / "manifest.json").read_text())
    blob = (directory / "incumbent.bin").read_bytes()
    if hashlib.sha256(blob).hexdigest() != manifest["incumbentSHA256"]:
        raise ValueError("Expected the incumbent recorded in the collection manifest.")
    blocks, original_weight, original_bias, offset = frozen_layers(blob)
    train, holdout = [dataset(directory, manifest["seeds"][k], blocks) for k in ("train", "holdout")]
    weight = original_weight.clone().requires_grad_()
    bias = original_bias.clone().requires_grad_()
    optimizer = torch.optim.AdamW([weight, bias], lr=0.001, weight_decay=0)
    x, y, _ = train
    for _ in range(80):
        optimizer.zero_grad()
        F.cross_entropy(x @ weight + bias, y).backward()
        optimizer.step()
    with torch.no_grad():
        weight, bias = weight.half().float(), bias.half().float()
        head = torch.cat((weight.flatten(), bias)).numpy().astype("<f2")
        if not np.isfinite(head).all():
            raise ValueError("Non-finite value checkpoint")
        (directory / "one-turn.bin").write_bytes(blob[:offset] + head.tobytes() + blob[offset + head.nbytes:])
        result = {key: {"incumbent": report(data, original_weight, original_bias),
                        "oneTurn": report(data, weight, bias)} for key, data in (("train", train), ("holdout", holdout))}
    (directory / "value-probe.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["holdout"], indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
