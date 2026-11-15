"""A small, dependency-free machine-learning toolkit.

Climate series here are short (tens of points), so the models are deliberately simple and every number is
checkable: ridge regression with leave-one-out validation, k-means with k-means++ starts, the silhouette score,
and the adjusted Rand index (used to test whether clusters are stable). Everything is seeded and deterministic.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass


# --------------------------------------------------------------------------- linear algebra


def solve_linear(a: list[list[float]], b: list[float]) -> list[float]:
    """Solve A x = b by Gaussian elimination with partial pivoting."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            raise ValueError("Matrix is singular.")
        m[col], m[pivot] = m[pivot], m[col]
        for r in range(col + 1, n):
            factor = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= factor * m[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (m[i][n] - sum(m[i][j] * x[j] for j in range(i + 1, n))) / m[i][i]
    return x


# --------------------------------------------------------------------------- ridge regression


@dataclass(frozen=True)
class RidgeModel:
    weights: list[float]      # on standardized features
    intercept: float
    means: list[float]
    sds: list[float]

    def predict(self, row: list[float]) -> float:
        return self.intercept + sum(w * (x - m) / s for w, x, m, s in zip(self.weights, row, self.means, self.sds))


def fit_ridge(x: list[list[float]], y: list[float], lam: float = 1.0) -> RidgeModel:
    """Ridge regression on standardized features. The intercept is not penalized."""
    n, p = len(x), len(x[0])
    means = [sum(row[j] for row in x) / n for j in range(p)]
    sds = [math.sqrt(sum((row[j] - means[j]) ** 2 for row in x) / n) or 1.0 for j in range(p)]
    z = [[(row[j] - means[j]) / sds[j] for j in range(p)] for row in x]
    y_mean = sum(y) / n
    yc = [v - y_mean for v in y]
    gram = [[sum(z[i][a] * z[i][b] for i in range(n)) + (lam if a == b else 0.0) for b in range(p)] for a in range(p)]
    rhs = [sum(z[i][a] * yc[i] for i in range(n)) for a in range(p)]
    return RidgeModel(weights=solve_linear(gram, rhs), intercept=y_mean, means=means, sds=sds)


def loo_predictions(x: list[list[float]], y: list[float], lam: float = 1.0) -> list[float]:
    """Leave-one-out predictions: each point is predicted by a model that never saw it."""
    out = []
    for i in range(len(y)):
        model = fit_ridge(x[:i] + x[i + 1 :], y[:i] + y[i + 1 :], lam)
        out.append(model.predict(x[i]))
    return out


def cv_r2(y: list[float], predictions: list[float]) -> float:
    """Out-of-sample R^2 against the fairest baseline: predicting each point with the mean of the others.

    Positive means the model beats guessing the average; zero or negative means it does not.
    """
    n = len(y)
    total = sum(y)
    sse_model = sum((v - p) ** 2 for v, p in zip(y, predictions))
    sse_mean = sum((v - (total - v) / (n - 1)) ** 2 for v in y)
    return 1.0 - sse_model / sse_mean if sse_mean > 0 else 0.0


def permutation_importance(
    x: list[list[float]], y: list[float], lam: float, repeats: int = 100, seed: int = 0
) -> list[float]:
    """Drop in cross-validated R^2 when one feature's column is shuffled (bigger drop = more useful feature)."""
    rng = random.Random(seed)
    base = cv_r2(y, loo_predictions(x, y, lam))
    drops = []
    for j in range(len(x[0])):
        total = 0.0
        for _ in range(repeats):
            column = [row[j] for row in x]
            rng.shuffle(column)
            shuffled = [row[:j] + [column[i]] + row[j + 1 :] for i, row in enumerate(x)]
            total += base - cv_r2(y, loo_predictions(shuffled, y, lam))
        drops.append(total / repeats)
    return drops


# --------------------------------------------------------------------------- clustering


def sq_dist(a: list[float], b: list[float]) -> float:
    return sum((p - q) ** 2 for p, q in zip(a, b))


def _kmeans_pp(points: list[list[float]], k: int, rng: random.Random) -> list[list[float]]:
    centers = [points[rng.randrange(len(points))]]
    while len(centers) < k:
        d2 = [min(sq_dist(p, c) for c in centers) for p in points]
        total = sum(d2)
        if total <= 0:
            centers.append(points[rng.randrange(len(points))])
            continue
        target, acc = rng.random() * total, 0.0
        for p, d in zip(points, d2):
            acc += d
            if acc >= target:
                centers.append(p)
                break
    return [c[:] for c in centers]


def _lloyd(points: list[list[float]], centers: list[list[float]], max_iter: int) -> tuple[list[int], list[list[float]], float]:
    k, dims = len(centers), len(points[0])
    labels = [-1] * len(points)
    for _ in range(max_iter):
        new_labels = [min(range(k), key=lambda c: sq_dist(p, centers[c])) for p in points]
        if new_labels == labels:
            break
        labels = new_labels
        for c in range(k):
            members = [p for p, lab in zip(points, labels) if lab == c]
            if members:
                centers[c] = [sum(m[d] for m in members) / len(members) for d in range(dims)]
            else:  # re-seed an empty cluster at the point farthest from its center
                far = max(range(len(points)), key=lambda i: sq_dist(points[i], centers[labels[i]]))
                centers[c] = points[far][:]
    inertia = sum(sq_dist(p, centers[lab]) for p, lab in zip(points, labels))
    return labels, centers, inertia


def kmeans(points: list[list[float]], k: int, seed: int = 0, n_init: int = 10, max_iter: int = 60) -> tuple[list[int], list[list[float]], float]:
    """k-means with k-means++ starts; the best of n_init runs. Clusters are numbered by size, largest first.

    k is capped at the number of distinct points (identical points cannot be split), and any cluster that still
    ends up empty is dropped, so the labels are always 0..m-1 with m <= k and every cluster has members.
    """
    if not 1 <= k <= len(points):
        raise ValueError("k must be between 1 and the number of points.")
    k = min(k, len({tuple(p) for p in points}))
    rng = random.Random(seed)
    best = None
    for _ in range(n_init):
        labels, centers, inertia = _lloyd(points, _kmeans_pp(points, k, rng), max_iter)
        if best is None or inertia < best[2]:
            best = (labels, centers, inertia)
    labels, centers, inertia = best
    order = sorted((c for c in range(k) if c in labels), key=lambda c: -labels.count(c))
    remap = {old: new for new, old in enumerate(order)}
    return [remap[lab] for lab in labels], [centers[old] for old in order], inertia


def silhouette(points: list[list[float]], labels: list[int]) -> float:
    """Mean silhouette: +1 means tight, well-separated clusters; near 0 means overlapping; negative means misassigned."""
    clusters = sorted(set(labels))
    if len(clusters) < 2:
        return 0.0
    dist = lambda i, j: math.sqrt(sq_dist(points[i], points[j]))  # noqa: E731
    total = 0.0
    for i, lab in enumerate(labels):
        same = [j for j, other in enumerate(labels) if other == lab and j != i]
        if not same:
            continue  # a singleton contributes 0
        a = sum(dist(i, j) for j in same) / len(same)
        b = min(
            sum(dist(i, j) for j, other in enumerate(labels) if other == c) / labels.count(c)
            for c in clusters
            if c != lab
        )
        total += (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return total / len(points)


def adjusted_rand_index(a: list[int], b: list[int]) -> float:
    """Agreement between two labelings, corrected for chance: 1 = identical, about 0 = no better than random."""
    n = len(a)
    if n != len(b) or n < 2:
        raise ValueError("Need two labelings of equal length (at least 2).")
    comb2 = lambda x: x * (x - 1) / 2  # noqa: E731
    table: dict[tuple[int, int], int] = {}
    for x, y in zip(a, b):
        table[(x, y)] = table.get((x, y), 0) + 1
    rows: dict[int, int] = {}
    cols: dict[int, int] = {}
    for (x, y), count in table.items():
        rows[x] = rows.get(x, 0) + count
        cols[y] = cols.get(y, 0) + count
    sum_cells = sum(comb2(c) for c in table.values())
    sum_rows = sum(comb2(c) for c in rows.values())
    sum_cols = sum(comb2(c) for c in cols.values())
    expected = sum_rows * sum_cols / comb2(n)
    maximum = (sum_rows + sum_cols) / 2
    return 1.0 if maximum == expected else (sum_cells - expected) / (maximum - expected)


def cosine_similarity(u: list[float], v: list[float]) -> float:
    nu, nv = math.sqrt(sum(x * x for x in u)), math.sqrt(sum(x * x for x in v))
    return sum(x * y for x, y in zip(u, v)) / (nu * nv) if nu > 0 and nv > 0 else 0.0


def cluster_stability(points: list[list[float]], k: int, seed: int = 0, repeats: int = 10, fraction: float = 0.8) -> float:
    """Mean adjusted Rand index between the full clustering and clusterings of random 80% subsamples."""
    rng = random.Random(seed + 101)
    full_labels, _, _ = kmeans(points, k, seed=seed, n_init=6)
    scores = []
    size = max(k + 1, int(len(points) * fraction))
    for r in range(repeats):
        subset = sorted(rng.sample(range(len(points)), size))
        sub_labels, _, _ = kmeans([points[i] for i in subset], k, seed=seed + r + 1, n_init=4)
        scores.append(adjusted_rand_index([full_labels[i] for i in subset], sub_labels))
    return sum(scores) / len(scores)
