"""Moran's I: do nearby grid cells have similar trends?

Neighbors are the 8 surrounding cells (queen contiguity) on an n x n grid.
Significance comes from a permutation test: the trend values are shuffled
across cells many times to see how often a pattern this strong appears by chance.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class MoransResult:
    i: float
    expected: float
    p_value: float
    pattern: str  # "clustered" | "dispersed" | "random"
    cells_used: int


def _neighbors(index: int, n: int) -> list[int]:
    row, col = divmod(index, n)
    out = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            r, c = row + dr, col + dc
            if 0 <= r < n and 0 <= c < n:
                out.append(r * n + c)
    return out


def _statistic(values: dict[int, float], pairs: list[tuple[int, int]]) -> float | None:
    """Moran's I for the given cells (dict of index -> value) and neighbor pairs."""
    m = len(values)
    mean = sum(values.values()) / m
    z = {k: v - mean for k, v in values.items()}
    denom = sum(v * v for v in z.values())
    if denom == 0 or not pairs:
        return None
    cross = sum(z[a] * z[b] for a, b in pairs)
    weight_sum = 2 * len(pairs)  # each neighbor pair counts in both directions
    return (m / weight_sum) * (2 * cross) / denom


def morans_i(values: list[float | None], n: int, permutations: int = 999, seed: int = 0) -> MoransResult | None:
    """Moran's I for an n x n grid. `values` is row-major; None marks cells that could not be analyzed.

    Returns None when there are too few cells or no variation to measure.
    """
    if len(values) != n * n:
        raise ValueError("values must contain exactly n*n entries.")

    known = {i: v for i, v in enumerate(values) if v is not None}
    if len(known) < 4:
        return None

    pairs = [
        (i, j)
        for i in known
        for j in _neighbors(i, n)
        if j in known and i < j
    ]
    observed = _statistic(known, pairs)
    if observed is None:
        return None

    expected = -1.0 / (len(known) - 1)
    rng = random.Random(seed)
    indices = list(known)
    shuffled_values = list(known.values())
    extreme = 0
    for _ in range(permutations):
        rng.shuffle(shuffled_values)
        perm = dict(zip(indices, shuffled_values))
        stat = _statistic(perm, pairs)
        if stat is not None and abs(stat - expected) >= abs(observed - expected):
            extreme += 1
    p_value = (extreme + 1) / (permutations + 1)

    if p_value >= 0.05:
        pattern = "random"
    elif observed > expected:
        pattern = "clustered"
    else:
        pattern = "dispersed"

    return MoransResult(
        i=observed,
        expected=expected,
        p_value=p_value,
        pattern=pattern,
        cells_used=len(known),
    )
