"""Fake routes for engine tests (no network)."""

from datetime import datetime

from hos.engine import Leg

START = datetime(2026, 9, 22, 6, 0)


def fake_legs(total_miles: float, pickup_miles: float = 50.0, mph: float = 55.0) -> list[Leg]:
    """Two legs at a constant average speed: current->pickup and pickup->dropoff."""
    pickup_miles = min(pickup_miles, total_miles)
    rest = total_miles - pickup_miles
    return [
        Leg(pickup_miles, pickup_miles / mph * 60, "Origin, IL", "Pickup, IL"),
        Leg(rest, rest / mph * 60, "Pickup, IL", "Destination, CA"),
    ]
