"""HOS trip simulation engine for a property-carrying driver on the 70-hour/8-day cycle.

Pure Python (no Django). Time is simulated in whole minutes so every log day
adds up to exactly 1,440 minutes (24.00 h). Driving is scheduled in chunks, and
each chunk is cut exactly where the first HOS limit would bind, so no chunk can
cross a limit partway through.

Rules implemented (FMCSA "Interstate Truck Driver's Guide to Hours of Service", 2022):

* §395.3(a)(1): a duty period starts after 10 consecutive hours off duty or in the
  sleeper berth (or any mix of the two). Guide p.6-7.
* §395.3(a)(2): 14-hour window. No driving after the 14th consecutive hour
  after coming on duty. On-duty non-driving work is still allowed. Guide p.6.
* §395.3(a)(3): 11-hour driving limit inside the window. Guide p.6.
* §395.3(a)(3)(ii): 30-minute break. No driving once 8 cumulative driving hours
  have passed without a 30-minute consecutive non-driving interruption (off duty,
  sleeper berth, on duty not driving, or a mix). Guide p.10.
* §395.3(b): 70 hours on duty within 8 days. Only *driving* past 70 is a
  violation. Guide p.10-11.
* §395.3(c): 34-hour restart. 34+ consecutive hours off duty or in the sleeper
  berth resets the cycle to zero. Guide p.11.

Not implemented (see README): split sleeper-berth pairing (§395.1(g)), adverse
driving conditions (§395.1(b)(1)), short-haul exceptions, and the rolling
drop-off of hours from days older than 8 days.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from enum import Enum
from typing import Callable, Optional, Sequence

Locator = Callable[[float], tuple[float, float]]


class Status(str, Enum):
    """The four duty-status lines on the graph grid (guide p.17)."""

    OFF = "OFF"  # Line 1: Off duty
    SB = "SB"  # Line 2: Sleeper berth
    D = "D"  # Line 3: Driving
    ON = "ON"  # Line 4: On duty (not driving)


class Kind(str, Enum):
    """Why an event exists. Used for notes, map icons and summary counts."""

    OFF_DUTY = "off_duty"
    PRE_TRIP = "pre_trip"
    DRIVE = "drive"
    PICKUP = "pickup"
    FUEL = "fuel"
    BREAK = "break"
    RESET = "reset"
    RESTART = "restart"
    DROPOFF = "dropoff"
    POST_TRIP = "post_trip"


NOTES: dict[Kind, str] = {
    Kind.OFF_DUTY: "Off duty",
    Kind.PRE_TRIP: "Pre-trip inspection",
    Kind.DRIVE: "Driving",
    Kind.PICKUP: "Pickup",
    Kind.FUEL: "Fuel",
    Kind.BREAK: "30-min break",
    Kind.RESET: "10-hr reset",
    Kind.RESTART: "34-hr restart",
    Kind.DROPOFF: "Drop-off",
    Kind.POST_TRIP: "Post-trip inspection",
}


@dataclass(frozen=True)
class EngineConfig:
    """Tunable limits. Defaults are the federal property-carrier rules plus the assessment's assumptions."""

    max_driving_min: int = 11 * 60  # §395.3(a)(3)
    window_min: int = 14 * 60  # §395.3(a)(2)
    break_after_driving_min: int = 8 * 60  # §395.3(a)(3)(ii)
    break_min: int = 30  # §395.3(a)(3)(ii)
    reset_min: int = 10 * 60  # §395.3(a)(1)
    cycle_limit_min: int = 70 * 60  # §395.3(b)(2), 70 h / 8 days
    restart_min: int = 34 * 60  # §395.3(c)
    fuel_interval_miles: float = 1000.0  # assessment: fuel at least every 1,000 mi
    fuel_min: int = 30
    pickup_min: int = 60  # assessment: 1 h pickup
    dropoff_min: int = 60  # assessment: 1 h drop-off
    inspections: bool = True  # 15-min pre-trip at start and post-trip at end
    inspection_min: int = 15
    # Opportunistic fueling: once the tank is this far through its interval and the
    # driver is stopping anyway (8-h break, 10-h reset, pickup), fuel there. At the
    # 8-h break the fuel stop replaces the break, since 30 min on duty not driving
    # also satisfies §395.3(a)(3)(ii).
    opportunistic_fuel: bool = True
    opportunistic_fuel_threshold: float = 0.75


@dataclass(frozen=True)
class Leg:
    """One routed leg. The route's own duration sets the average speed for the leg."""

    miles: float
    duration_min: float
    start_label: Optional[str] = None
    end_label: Optional[str] = None


@dataclass
class Event:
    """A single duty-status interval."""

    start: datetime
    end: datetime
    status: Status
    kind: Kind
    miles_start: float
    miles_end: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    location_label: Optional[str] = None

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)

    @property
    def note(self) -> str:
        return NOTES[self.kind]

    def to_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "status": self.status.value,
            "kind": self.kind.value,
            "note": self.note,
            "duration_hours": round(self.minutes / 60, 2),
            "miles_start": round(self.miles_start, 1),
            "miles_end": round(self.miles_end, 1),
            "lat": self.lat,
            "lng": self.lng,
            "location_label": self.location_label,
        }


@dataclass
class _State:
    """Counters for the running HOS clocks. All values are in minutes except miles."""

    now: int = 0
    mile: float = 0.0
    window_start: Optional[int] = None  # None means off-duty since the last 10-h reset
    drive_in_shift: int = 0
    drive_since_break: int = 0
    nondrive_streak: int = 0  # consecutive OFF/SB/ON minutes
    rest_streak: int = 0  # consecutive OFF/SB minutes
    cycle: int = 0  # on-duty minutes counted toward 70 h
    miles_since_fuel: float = 0.0


@dataclass
class TripSimulation:
    """Engine result. ``events`` is contiguous and runs from midnight of day 1 to midnight after arrival."""

    events: list[Event]
    start: datetime
    end_of_duty: datetime
    cycle_used_hours: float
    config: EngineConfig = field(default_factory=EngineConfig)
    pickup_mile: float = 0.0
    total_miles: float = 0.0


def default_start(now: datetime) -> datetime:
    """Return the next 06:00 at or after ``now`` (naive home-terminal time)."""
    candidate = datetime.combine(now.date(), time(6, 0))
    return candidate if candidate >= now else candidate + timedelta(days=1)


class _Simulator:
    """Minute-accurate state machine that appends events and updates HOS clocks."""

    def __init__(self, cfg: EngineConfig, start: datetime, cycle_used_hours: float,
                 locate: Optional[Locator]) -> None:
        self.cfg = cfg
        self.t0 = start.replace(second=0, microsecond=0)
        self.locate = locate
        self.s = _State(cycle=round(cycle_used_hours * 60))
        self.events: list[Event] = []

    # ---- time helpers -------------------------------------------------
    def _at(self, minute: int) -> datetime:
        return self.t0 + timedelta(minutes=minute)

    def _window_left(self) -> int:
        """Minutes of the 14-hour window left (§395.3(a)(2)). A new window opens on the next on-duty event."""
        if self.s.window_start is None:
            return self.cfg.window_min
        return self.s.window_start + self.cfg.window_min - self.s.now

    def _fuel_allowance(self, miles_per_min: float) -> int:
        """Whole driving minutes left before passing ``fuel_interval_miles`` since the last fuel stop."""
        if miles_per_min <= 0:
            return math.inf  # type: ignore[return-value]
        left = self.cfg.fuel_interval_miles - self.s.miles_since_fuel
        return max(0, math.floor(left / miles_per_min + 1e-9))

    # ---- event emission -------------------------------------------------
    def append(self, status: Status, kind: Kind, minutes: int, miles_end: Optional[float] = None,
               label: Optional[str] = None) -> None:
        """Record an event and advance every HOS clock by ``minutes``."""
        if minutes <= 0:
            return
        s, cfg = self.s, self.cfg
        mile_start = s.mile
        mile_end = mile_start if miles_end is None else miles_end
        lat = lng = None
        if self.locate is not None:
            lat, lng = self.locate(mile_start)
        self.events.append(Event(self._at(s.now), self._at(s.now + minutes), status, kind,
                                 mile_start, mile_end, lat, lng, label))

        if status in (Status.D, Status.ON):
            if s.window_start is None:
                s.window_start = s.now  # §395.3(a)(2): the window opens at the first on-duty activity
            s.cycle += minutes  # §395.3(b): all on-duty time counts
            s.rest_streak = 0
        if status is Status.D:
            s.drive_in_shift += minutes
            s.drive_since_break += minutes
            s.nondrive_streak = 0
            s.miles_since_fuel += mile_end - mile_start
            s.mile = mile_end
        else:
            s.nondrive_streak += minutes
            if s.nondrive_streak >= cfg.break_min:
                s.drive_since_break = 0  # §395.3(a)(3)(ii): any 30 consecutive non-driving minutes
        if status in (Status.OFF, Status.SB):
            s.rest_streak += minutes
            if s.rest_streak >= cfg.reset_min:  # §395.3(a)(1): 10 consecutive h off
                s.window_start = None
                s.drive_in_shift = 0
            if s.rest_streak >= cfg.restart_min:  # §395.3(c): 34-h restart
                s.cycle = 0
        if kind is Kind.FUEL:
            s.miles_since_fuel = 0.0
        s.now += minutes

    # ---- rest selection -------------------------------------------------
    def required_rest(self, miles_per_min: float) -> Optional[Kind]:
        """Return the rest needed before driving can continue, checking limits in priority order.

        Priority: 70-h cycle (§395.3(b)) -> 34-h restart; 11-h (§395.3(a)(3)) or
        14-h (§395.3(a)(2)) -> 10-h reset; 8-h driving (§395.3(a)(3)(ii)) -> 30-min
        break; fuel interval -> fuel stop.
        """
        s, cfg = self.s, self.cfg
        if s.cycle >= cfg.cycle_limit_min:
            return Kind.RESTART
        if s.drive_in_shift >= cfg.max_driving_min or self._window_left() <= 0:
            return Kind.RESET
        if s.drive_since_break >= cfg.break_after_driving_min:
            # A 30-min break that ends at or after the 14th hour gains no driving time.
            if self._window_left() <= cfg.break_min:
                return Kind.RESET
            return Kind.FUEL if self.fuel_worth_topping_off() else Kind.BREAK
        if self._fuel_allowance(miles_per_min) <= 0:
            return Kind.FUEL
        return None

    def fuel_worth_topping_off(self) -> bool:
        """True when opportunistic fueling is on and the tank is past the threshold share of its interval."""
        cfg = self.cfg
        used = self.s.miles_since_fuel / cfg.fuel_interval_miles
        return cfg.opportunistic_fuel and used >= cfg.opportunistic_fuel_threshold

    def top_off_fuel(self) -> None:
        """Fuel during a stop the driver is already making, if it is worthwhile."""
        if self.fuel_worth_topping_off():
            self.append(Status.ON, Kind.FUEL, self.cfg.fuel_min)

    def take_rest(self, kind: Kind) -> None:
        """Log the chosen rest with its status and length."""
        cfg = self.cfg
        if kind is Kind.RESTART:
            self.append(Status.OFF, kind, cfg.restart_min)
        elif kind is Kind.RESET:
            # On-duty fueling after hour 14 is allowed; only driving is barred (guide p.6).
            self.top_off_fuel()
            self.append(Status.SB, kind, cfg.reset_min)  # logged as sleeper berth, no split pairing
        elif kind is Kind.BREAK:
            self.append(Status.OFF, kind, cfg.break_min)
        elif kind is Kind.FUEL:
            self.append(Status.ON, kind, cfg.fuel_min)  # fueling is on-duty (guide p.5)
        else:  # pragma: no cover - defensive
            raise ValueError(f"not a rest kind: {kind}")

    def drive_allowance(self, miles_per_min: float) -> int:
        """Longest driving chunk (min) that breaks no limit: min of 11-h, 14-h, 8-h, cycle and fuel."""
        s, cfg = self.s, self.cfg
        return min(
            cfg.max_driving_min - s.drive_in_shift,
            self._window_left(),
            cfg.break_after_driving_min - s.drive_since_break,
            cfg.cycle_limit_min - s.cycle,
            self._fuel_allowance(miles_per_min),
        )

    def drive_leg(self, leg: Leg) -> None:
        """Drive one leg, splitting it into chunks at every binding limit."""
        total = max(0, round(leg.duration_min))
        if leg.miles > 0 and total == 0:
            total = 1
        if total == 0:
            return
        miles_per_min = leg.miles / total
        leg_start_mile = self.s.mile
        done = 0
        while done < total:
            rest = self.required_rest(miles_per_min)
            if rest is not None:
                self.take_rest(rest)
                continue
            chunk = min(total - done, self.drive_allowance(miles_per_min))
            done += chunk
            end_mile = leg_start_mile + leg.miles * done / total
            self.append(Status.D, Kind.DRIVE, chunk, miles_end=end_mile)


def simulate_trip(
    legs: Sequence[Leg],
    cycle_used_hours: float,
    start: datetime,
    config: EngineConfig = EngineConfig(),
    locate: Optional[Locator] = None,
) -> TripSimulation:
    """Simulate current -> pickup -> drop-off and return a contiguous event timeline.

    ``legs`` must be ``[current->pickup, pickup->dropoff]``. ``start`` is a naive
    home-terminal datetime (§395.8 time base). The driver is assumed to have had
    10+ hours off before ``start``. Time from midnight to ``start`` and from the
    end of duty to the following midnight is logged as Off Duty.
    """
    if len(legs) != 2:
        raise ValueError("expected exactly two legs: current->pickup and pickup->dropoff")
    if not 0 <= cycle_used_hours <= 70:
        raise ValueError("cycle_used_hours must be between 0 and 70")

    cfg = config
    sim = _Simulator(cfg, start, cycle_used_hours, locate)
    to_pickup, to_dropoff = legs

    if cfg.inspections:
        sim.append(Status.ON, Kind.PRE_TRIP, cfg.inspection_min, label=to_pickup.start_label)
    sim.drive_leg(to_pickup)
    pickup_mile = sim.s.mile
    if to_dropoff.miles > 0:
        sim.top_off_fuel()
    sim.append(Status.ON, Kind.PICKUP, cfg.pickup_min, label=to_pickup.end_label or to_dropoff.start_label)
    sim.drive_leg(to_dropoff)
    sim.append(Status.ON, Kind.DROPOFF, cfg.dropoff_min, label=to_dropoff.end_label)
    if cfg.inspections:
        sim.append(Status.ON, Kind.POST_TRIP, cfg.inspection_min, label=to_dropoff.end_label)

    events = _pad_to_midnights(sim.events, sim, to_pickup.start_label, to_dropoff.end_label)
    _label_waypoints(events, pickup_mile, sim.s.mile, to_pickup.start_label,
                     to_pickup.end_label or to_dropoff.start_label, to_dropoff.end_label)
    return TripSimulation(events=events, start=sim.t0, end_of_duty=sim._at(sim.s.now),
                          cycle_used_hours=cycle_used_hours, config=cfg,
                          pickup_mile=pickup_mile, total_miles=sim.s.mile)


def _pad_to_midnights(events: list[Event], sim: _Simulator, start_label: Optional[str],
                      end_label: Optional[str]) -> list[Event]:
    """Add Off Duty from midnight to the start and from the end of duty to the next midnight."""
    out: list[Event] = []
    t0 = sim.t0
    day_start = datetime.combine(t0.date(), time(0, 0))
    first = events[0] if events else None
    lat = first.lat if first else None
    lng = first.lng if first else None
    if t0 > day_start:
        out.append(Event(day_start, t0, Status.OFF, Kind.OFF_DUTY, 0.0, 0.0, lat, lng, start_label))
    out.extend(events)
    end = sim._at(sim.s.now)
    next_midnight = datetime.combine(end.date(), time(0, 0))
    if next_midnight < end:
        next_midnight += timedelta(days=1)
    if end < next_midnight:
        last = events[-1] if events else None
        lat = last.lat if last else lat
        lng = last.lng if last else lng
        out.append(Event(end, next_midnight, Status.OFF, Kind.OFF_DUTY, sim.s.mile, sim.s.mile,
                         lat, lng, end_label))
    return out


def _label_waypoints(events: list[Event], pickup_mile: float, end_mile: float,
                     start_label: Optional[str], pickup_label: Optional[str],
                     end_label: Optional[str]) -> None:
    """Give known waypoint labels to unlabeled events that start exactly at a waypoint."""
    for ev in events:
        if ev.location_label:
            continue
        if ev.miles_start == 0.0:
            ev.location_label = start_label
        elif abs(ev.miles_start - pickup_mile) < 1e-6:
            ev.location_label = pickup_label
        elif abs(ev.miles_start - end_mile) < 1e-6:
            ev.location_label = end_label
