import pytest

from trips.services.polyline import RouteLine, haversine_miles, nearest_index, simplify


def test_haversine_known_distance():
    # Chicago -> Dallas is roughly 800 statute miles great-circle distance.
    assert haversine_miles((41.8781, -87.6298), (32.7767, -96.7970)) == pytest.approx(803, abs=10)


def test_point_at_scales_each_leg_to_router_miles():
    coords = [(0.0, 0.0), (0.0, 1.0), (0.0, 2.0), (0.0, 3.0)]
    line = RouteLine(coords, leg_breaks=[0, 1, 3], leg_miles=[100.0, 300.0])
    assert line.total_miles == 400
    assert line.point_at(0) == (0.0, 0.0)
    assert line.point_at(50) == pytest.approx((0.0, 0.5))
    assert line.point_at(100) == pytest.approx((0.0, 1.0))  # pickup vertex lands at exactly the leg-0 miles
    assert line.point_at(250) == pytest.approx((0.0, 2.0))
    assert line.point_at(10_000) == (0.0, 3.0)
    assert line.point_at(-5) == (0.0, 0.0)


def test_nearest_index_and_simplify():
    coords = [(0.0, x / 100) for x in range(101)]
    assert nearest_index(coords, (0.001, 0.503)) == 50
    assert simplify(coords) == [coords[0], coords[-1]]
    zig = [(0, 0), (1, 1), (0, 2)]
    assert simplify(zig) == zig
