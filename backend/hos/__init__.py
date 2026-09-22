"""Pure-Python Hours-of-Service (49 CFR Part 395) trip planning package.

Nothing in this package imports Django, so it can be unit-tested and reused
anywhere. See ``engine`` (simulation), ``daily_logs`` (log-sheet builder) and
``validator`` (independent compliance checker).
"""

from .engine import EngineConfig, Event, Leg, Status, simulate_trip
from .daily_logs import build_daily_logs
from .validator import validate_plan

__all__ = [
    "EngineConfig",
    "Event",
    "Leg",
    "Status",
    "simulate_trip",
    "build_daily_logs",
    "validate_plan",
]
