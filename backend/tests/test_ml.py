"""The ML toolkit: known answers, recovery of planted structure, and honest failure on pure noise."""

import random

import pytest

from app.ml import (
    adjusted_rand_index,
    cluster_stability,
    cosine_similarity,
    cv_r2,
    fit_ridge,
    kmeans,
    loo_predictions,
    permutation_importance,
    silhouette,
    solve_linear,
)


def _blobs(per_blob=15, spread=0.3, seed=1):
    rng = random.Random(seed)
    centers = [(0.0, 0.0), (8.0, 0.0), (0.0, 8.0)]
    points, truth = [], []
    for label, (cx, cy) in enumerate(centers):
        for _ in range(per_blob):
            points.append([cx + rng.gauss(0, spread), cy + rng.gauss(0, spread)])
            truth.append(label)
    return points, truth


# ---- linear algebra and ridge -------------------------------------------------------------------


def test_solve_linear_known_system():
    # 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
    assert solve_linear([[2, 1], [1, 3]], [5, 10]) == pytest.approx([1.0, 3.0])


def test_solve_linear_needs_pivoting_and_rejects_singular():
    assert solve_linear([[0, 1], [1, 0]], [2, 3]) == pytest.approx([3.0, 2.0])
    with pytest.raises(ValueError):
        solve_linear([[1, 2], [2, 4]], [1, 2])


def test_ridge_recovers_a_noiseless_relationship():
    rng = random.Random(2)
    x = [[rng.gauss(0, 1), rng.gauss(0, 5)] for _ in range(60)]
    y = [3.0 + 2.0 * a - 0.5 * b for a, b in x]
    model = fit_ridge(x, y, lam=1e-6)
    for row, target in list(zip(x, y))[:10]:
        assert model.predict(row) == pytest.approx(target, abs=1e-3)


def test_ridge_shrinks_with_a_larger_penalty_and_ignores_feature_scale():
    rng = random.Random(3)
    x = [[rng.gauss(0, 1)] for _ in range(40)]
    y = [1.5 * r[0] + rng.gauss(0, 0.2) for r in x]
    weak, strong = fit_ridge(x, y, lam=0.1), fit_ridge(x, y, lam=500.0)
    assert abs(strong.weights[0]) < abs(weak.weights[0])
    scaled = fit_ridge([[v[0] * 1000] for v in x], y, lam=0.1)  # same information, different units
    assert scaled.predict([x[0][0] * 1000]) == pytest.approx(weak.predict(x[0]), abs=1e-6)


# ---- cross-validated skill ----------------------------------------------------------------------


def test_cv_r2_reference_values():
    y = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert cv_r2(y, y) == pytest.approx(1.0)
    mean_of_others = [(sum(y) - v) / 4 for v in y]
    assert cv_r2(y, mean_of_others) == pytest.approx(0.0)  # the baseline itself scores zero
    assert cv_r2(y, [5.0, 4.0, 3.0, 2.0, 1.0]) < 0          # worse than guessing the average


def test_loo_finds_real_signal_and_reports_none_in_noise():
    rng = random.Random(4)
    x = [[rng.gauss(0, 1), rng.gauss(0, 1)] for _ in range(45)]
    signal = [2.0 * r[0] + rng.gauss(0, 0.3) for r in x]
    noise = [rng.gauss(0, 1) for _ in range(45)]
    assert cv_r2(signal, loo_predictions(x, signal, 1.0)) > 0.8
    assert cv_r2(noise, loo_predictions(x, noise, 1.0)) < 0.1


def test_permutation_importance_points_at_the_informative_feature():
    rng = random.Random(5)
    x = [[rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)] for _ in range(45)]
    y = [2.0 * r[1] + rng.gauss(0, 0.3) for r in x]
    drops = permutation_importance(x, y, lam=1.0, repeats=20, seed=1)
    assert drops[1] > 0.5
    assert abs(drops[0]) < 0.1 and abs(drops[2]) < 0.1


# ---- clustering ---------------------------------------------------------------------------------


def test_kmeans_recovers_well_separated_blobs():
    points, truth = _blobs()
    labels, centers, inertia = kmeans(points, 3, seed=0)
    assert adjusted_rand_index(labels, truth) == pytest.approx(1.0)
    assert len(centers) == 3 and inertia > 0


def test_kmeans_is_deterministic_numbers_clusters_by_size_and_validates_k():
    rng = random.Random(6)
    big = [[rng.gauss(0, 0.2), 0.0] for _ in range(20)]
    small = [[rng.gauss(10, 0.2), 0.0] for _ in range(5)]
    a = kmeans(big + small, 2, seed=3)
    b = kmeans(big + small, 2, seed=3)
    assert a[0] == b[0]
    assert a[0].count(0) == 20 and a[0].count(1) == 5  # cluster 0 is the largest
    with pytest.raises(ValueError):
        kmeans(big, 0)
    with pytest.raises(ValueError):
        kmeans(big, 99)


def test_silhouette_separates_good_from_bad_clusterings():
    points, truth = _blobs()
    assert silhouette(points, truth) > 0.85
    shuffled = truth[:]
    random.Random(7).shuffle(shuffled)
    assert silhouette(points, shuffled) < 0.1
    assert silhouette(points, [0] * len(points)) == 0.0  # one cluster has no separation to measure


def test_adjusted_rand_index_known_values():
    assert adjusted_rand_index([0, 0, 1, 1], [0, 0, 1, 2]) == pytest.approx(0.5714, abs=1e-3)  # worked by hand
    assert adjusted_rand_index([0, 0, 1, 1, 2, 2], [5, 5, 3, 3, 9, 9]) == pytest.approx(1.0)   # relabeling is irrelevant
    rng = random.Random(8)
    a = [rng.randrange(3) for _ in range(300)]
    b = [rng.randrange(3) for _ in range(300)]
    assert abs(adjusted_rand_index(a, b)) < 0.05                                              # random labelings agree no more than chance
    with pytest.raises(ValueError):
        adjusted_rand_index([0], [0])


def test_cosine_similarity():
    assert cosine_similarity([1, 0], [2, 0]) == pytest.approx(1.0)
    assert cosine_similarity([1, 0], [0, 3]) == pytest.approx(0.0)
    assert cosine_similarity([1, 1], [-1, -1]) == pytest.approx(-1.0)
    assert cosine_similarity([0, 0], [1, 1]) == 0.0


def test_stability_is_high_for_real_clusters_and_lower_for_noise():
    points, _ = _blobs()
    rng = random.Random(9)
    uniform = [[rng.random() * 8, rng.random() * 8] for _ in range(45)]
    assert cluster_stability(points, 3, seed=0, repeats=6) > 0.95
    assert cluster_stability(uniform, 3, seed=0, repeats=6) < cluster_stability(points, 3, seed=0, repeats=6)


def test_kmeans_caps_k_at_the_number_of_distinct_points_and_never_returns_an_empty_cluster():
    points = [[0.0] * 15 for _ in range(9)] + [[1.0] * 15]
    labels, centers, _ = kmeans(points, 3, seed=7)
    assert sorted(set(labels)) == [0, 1]
    assert len(centers) == 2
    assert labels.count(0) == 9 and labels.count(1) == 1
