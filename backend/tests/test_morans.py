import random

import pytest

from app.morans import morans_i


def _grid(n, fn):
    return [fn(r, c) for r in range(n) for c in range(n)]


def test_split_pattern_is_clustered():
    # Left half warming, right half cooling: neighbors agree, so I is strongly positive.
    values = _grid(5, lambda r, c: 1.0 if c < 2 else -1.0)
    result = morans_i(values, 5, seed=1)
    assert result.pattern == "clustered"
    assert result.i > result.expected
    assert result.p_value < 0.05


def test_checkerboard_is_not_clustered_and_weaker_than_split():
    # With 8-neighbor adjacency, diagonal neighbors share a color, so a checkerboard
    # is mixed rather than strongly dispersed. It must still score below a split pattern.
    split = morans_i(_grid(5, lambda r, c: 1.0 if c < 2 else -1.0), 5, seed=1)
    checker = morans_i(_grid(5, lambda r, c: 1.0 if (r + c) % 2 == 0 else -1.0), 5, seed=1)
    assert checker.pattern != "clustered"
    assert checker.i < split.i


def test_random_noise_is_not_clustered():
    rng = random.Random(7)
    values = [rng.gauss(0, 1) for _ in range(25)]
    result = morans_i(values, 5, seed=1)
    assert result.pattern in ("random", "dispersed")


def test_missing_cells_are_skipped():
    values = _grid(4, lambda r, c: 1.0 if c < 2 else -1.0)
    values[0] = None
    values[5] = None
    result = morans_i(values, 4, seed=1)
    assert result is not None
    assert result.cells_used == 14


def test_too_few_cells_returns_none():
    values = [None] * 22 + [1.0, 2.0, 3.0]  # 25 cells, only 3 analyzed
    assert morans_i(values, 5) is None


def test_constant_values_return_none():
    assert morans_i([2.0] * 9, 3) is None


def test_wrong_length_raises():
    with pytest.raises(ValueError):
        morans_i([1.0] * 8, 3)
