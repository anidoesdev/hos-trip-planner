# ELD Trip Planner: Backend

Django 5 + Django REST Framework API. It takes a current location, a pickup, a drop-off and the
driver's current 70-hour cycle usage. It returns a truck route, every required stop and rest under
FMCSA Hours of Service (49 CFR Part 395, property carrier, 70 h / 8 days), and a filled-in
Driver's Daily Log for each calendar day of the trip.

The API is stateless: there are no database models. Only free geo APIs are used.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # optionally set ORS_API_KEY
python manage.py runserver                             # http://127.0.0.1:8000/api/health
pytest                                                 # 600+ tests, no network needed
```

Production: `gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 2 --timeout 90`

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_DEBUG` | `false` | Debug mode |
| `DJANGO_SECRET_KEY` | dev key | Set a real value in production |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,…` | Frontend origin(s), comma-separated |
| `CORS_ALLOWED_ORIGIN_REGEXES` | empty | e.g. `^https://.*\.vercel\.app$` for preview deploys |
| `HOME_TERMINAL_TZ` | `America/Chicago` | Log time base (§395.8) and the default 06:00 start |
| `ORS_API_KEY` | empty | OpenRouteService key (free). Without it: Photon/Nominatim + OSRM |
| `NOMINATIM_USER_AGENT` | `eld-trip-planner/1.0 …` | Required by the Nominatim usage policy |
| `GEOCODE_COUNTRY_CODES` | `us,ca` | Restricts forward geocoding |
| `HTTP_TIMEOUT_SECONDS` | `12` | Timeout for each external call |
| `REVERSE_GEOCODE_BUDGET_SECONDS` | `25` | Total time allowed for labeling stops |
| `API_THROTTLE_RATE` | `30/min` | Per-IP throttle that protects the free upstream APIs |

## API

### `GET /api/health` → `{"status": "ok"}`

### `POST /api/trip/plan`

```json
{
  "current_location": "Chicago, IL",
  "pickup_location": "Dallas, TX",
  "dropoff_location": "Los Angeles, CA",
  "current_cycle_used": 20,
  "start_datetime": "2026-09-22T06:00:00"
}
```

* Locations are free text, or `"lat, lng"`. Each must be non-empty.
* `current_cycle_used` must be between 0 and 70.
* `start_datetime` is optional. A naive value is home-terminal wall-clock time. An aware value
  (`…Z`, `…-05:00`) is converted to home-terminal time. The default is the next 06:00 at the home
  terminal.

Response (full example: [`docs/sample_response.json`](docs/sample_response.json)):

| Key | Contents |
|---|---|
| `input` | Geocoded points with "City, ST" labels, the resolved start, and the time zone |
| `route` | `provider`, simplified `geometry` `[[lat,lng],…]`, `legs[]` (`from`, `to`, `miles`, `duration_hours`, `avg_mph`, `geometry`), `total_miles`, `total_duration_hours` |
| `events` | Contiguous timeline from midnight of day 1 to midnight after arrival: `{start, end, status: OFF\|SB\|D\|ON, kind, note, duration_hours, miles_start, miles_end, lat, lng, location_label}` |
| `stops` | Non-driving events (pre-trip, pickup, fuel, breaks, resets, restarts, drop-off, post-trip) with coordinates, for the map |
| `daily_logs` | One per calendar day: `date`, `from_location`, `to_location`, `total_miles_driving_today`, `segments[]` (`start_minute`/`end_minute` 0–1440 for drawing the grid), `totals_hours` (always sums to exactly 24.00), `remarks[]` (time, status, "City, ST" at each change), and `recap` (`on_duty_today` = lines 3+4, `cycle_total_hours` = A, `hours_available_tomorrow` = B = 70 − A, `restart_taken`), and `compliance` (that day's validator result, for a per-sheet badge) |
| `summary` | Total miles, driving hours, trip duration, number of days, pickup/drop-off arrival times, counts of 30-min breaks, 10-h resets, 34-h restarts and fuel stops |
| `compliance` | The independent validator's result `{ok, violations[]}`. The frontend can show it as a badge |

Errors always come back as JSON `{"error": code, "message": …, "field"?: …}`:

| Status | `error` | When |
|---|---|---|
| 400 | `validation_error` (with `fields`) | Blank location, cycle outside 0–70, bad datetime |
| 422 | `location_not_found` (with `field`) | No geocoder matched the text |
| 422 | `route_not_found` | No drivable route (e.g. across an ocean) |
| 502 | `upstream_unavailable` | Every provider failed or returned bad data |
| 504 | `upstream_timeout` | Providers timed out |
| 429 | `throttled` | Rate limit exceeded |

## Module layout

```
backend/
  config/                   settings driven by env vars, urls, wsgi
  hos/                      PURE PYTHON: no Django imports, fully unit-testable
    engine.py               trip simulator -> contiguous duty-status events
    daily_logs.py           events -> per-calendar-day log sheets (+ recap)
    validator.py            independent re-check of every HOS rule (tests + API)
    report.py               map stops + trip summary
  trips/                    Django app (HTTP layer)
    serializers.py, views.py, urls.py
    services/
      http.py               shared session, timeouts, typed errors, rate limiters
      geocoding.py          ORS -> Nominatim -> Photon, "City, ST", in-memory cache
      routing.py            ORS driving-hgv -> OSRM; per-leg miles/minutes + polyline
      polyline.py           PURE: haversine, point_at(mile), RDP simplification
      reverse_geocode.py    labels for status-change points: dedupe, LRU cache, pool, 1 req/s
      planner.py            orchestration -> response dict
  tests/                    engine scenarios, property tests, polyline, API (mocked network)
```

## HOS engine algorithm

Time is simulated in whole minutes, so each day's four statuses add up to exactly 1,440 min.
Driving is scheduled in chunks, and each chunk ends exactly where the first limit would bind.

```
phases = [PRE_TRIP 15m?, DRIVE(current->pickup), [fuel top-off?], PICKUP 60m,
          DRIVE(pickup->dropoff), DROPOFF 60m, POST_TRIP 15m?]

state: now, mile, window_start, drive_in_shift, drive_since_break,
       nondrive_streak, rest_streak, cycle, miles_since_fuel

DRIVE(leg):  speed = leg.miles / leg.duration   # from the router, not a fixed mph
  while leg minutes remain:
    rest = required_rest()          # priority order:
        cycle >= 70h                          -> 34-h restart (OFF)        §395.3(b), (c)
        drive_in_shift >= 11h or now >= w+14h -> 10-h reset (SB)           §395.3(a)(3), (a)(2)
        drive_since_break >= 8h               -> 30-min break (OFF)        §395.3(a)(3)(ii)
              (a 10-h reset instead if <= 30 min of the window is left;
               a fuel stop instead if the tank is >= 75% used)
        miles_since_fuel reaches 1,000        -> 30-min fuel stop (ON)
    if rest: append(rest); continue
    chunk = min(leg left, 11h - drive_in_shift, window end - now,
                8h - drive_since_break, 70h - cycle, minutes until 1,000 mi since fuel)
    append(DRIVING, chunk)

append(status, minutes) updates every clock:
  ON or D   -> opens the 14-h window if closed; adds to cycle; resets rest_streak
  D         -> adds to drive_in_shift and drive_since_break; resets nondrive_streak
  not D     -> nondrive_streak += m; if >= 30 min, drive_since_break = 0   (any mix of OFF/SB/ON)
  OFF or SB -> rest_streak += m; >= 10 h resets 11/14; >= 34 h resets cycle to 0
pad with OFF from midnight to the start, and from the end of duty to the next midnight
```

Then `daily_logs` splits events at midnight, interpolating driving miles by time. It rounds the
status totals with largest-remainder rounding so they print as exactly 24.00. It also runs the
70/8 recap. `validator` recomputes all clocks from the events alone, and both the property tests
and the API use it.

## Assumptions

1. **Driver and cycle.** Property-carrying, 70 h / 8 days, no adverse driving conditions
   (§395.1(b)(1) is not used), no short-haul exceptions.
2. **Fresh start.** The driver has had at least 10 consecutive hours off before `start_datetime`.
   Everything from midnight to the start on day 1 is logged Off Duty.
3. **Cycle history.** `current_cycle_used` is the on-duty total of the prior 7 days. Those hours
   are *not* rolled off day by day during the trip, because their distribution is unknown. This
   is conservative: the engine may schedule a 34-h restart slightly earlier than strictly needed,
   but never later. Once the cycle is used up, the driver takes a **34-h restart** (logged
   Off Duty), which resets the cycle to 0 (§395.3(c)).
4. **10-hour resets** are logged as **Sleeper Berth**. **Split sleeper-berth pairing (7/3, 8/2,
   §395.1(g)) is not implemented.** Every daily reset is 10 consecutive hours.
5. **30-minute break.** Taken as Off Duty when needed. Any 30+ consecutive minutes of non-driving
   time also count, including the 1-h pickup, a fuel stop, or a combination of statuses (guide
   p.10). A break is never taken if it would end at or after the 14th hour; the 10-h reset is
   taken instead.
6. **On-duty work past the limits.** Pickup, drop-off, fuel and inspections may happen after
   hour 14 or with the 70-h cycle used up. Only *driving* is restricted (guide pp.6, 9, 10).
7. **Fuel.** The trip starts with a full tank. A 30-min On Duty fuel stop comes at or before every
   1,000 driven miles. With `opportunistic_fuel` (on by default), once the tank is at least 75%
   through its interval the driver fuels during a stop they are already making (the 8-h break,
   before a 10-h reset, or at pickup). This avoids a fuel stop a few miles after a long stop.
8. **Pickup / drop-off.** 1 h On Duty (not driving) each, at the geocoded locations.
9. **Inspections** (config `inspections=True`, on by default): a 15-min On Duty pre-trip at the
   start and a 15-min post-trip at the end. Daily pre-trips after each reset are not added.
10. **Speed.** Each leg's average speed is the router's distance ÷ duration. That is ORS
    `driving-hgv` (truck profile) with a key, or OSRM car profile otherwise (slightly optimistic
    for a truck). Traffic, weigh stations and meals are not modeled.
11. **Time base.** All times are naive home-terminal wall-clock times (`HOME_TERMINAL_TZ`), as
    §395.8 requires. Crossing time zones does not change the log. DST transitions inside a trip
    are ignored.
12. **Granularity.** 1 minute. Paper logs are usually drawn in 15-min steps. The frontend can
    snap segments to that when drawing.
13. **Remarks locations.** Reverse-geocoded to the nearest city, town, village or hamlet as
    "City, ST". The label is prefixed "near" when the point is more than 3 mi from that place.
    Highway and milepost are not available. If every provider fails or the time budget runs out,
    the label is "near lat, lng".
14. **Routing limits.** ORS free-tier routes are capped at about 6,000 km. Longer trips fall back
    to OSRM.
