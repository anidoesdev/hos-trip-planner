# Loom script (≈4:40)

**Setup before recording**

- Open three things: the live app in one tab (API already woken up; the header dot is green),
  VS Code with the repo, and the FMCSA guide PDF at p.18.
- Collapse the carrier details panel.
- Screen at 1440 px wide; browser zoom 100%.

---

### 0:00–0:20 · Intro

Start on the landing dashboard and let the preview animation play once.

> "This is an HOS trip planner for a property-carrying truck driver. You enter where the truck is,
> the pickup, the drop-off and how many hours of the 70-hour cycle are already used. It returns a
> compliant route with every required stop, plus a filled-in Driver's Daily Log for each day. It's
> Django and DRF on the back end, React and TypeScript on the front, and it uses only free map
> APIs."

### 0:20–1:30 · Demo: multi-day trip

1. Click **Plan a trip**: the form comes to the center of the screen. Point at the autocomplete
   (type a city: each suggestion shows its type and distance from the previous stop), the cycle
   slider with its hours-left readout, and the date and time picker.
   > "Everything is in home-terminal time, as the rule requires."
2. Click **Try an example → Cross-country** (Chicago → Dallas → LA, 20 h used). The progress
   steps appear.
3. **Summary card:**
   > "About 2,400 miles and 55 hours of driving. That's too much for one cycle, so the planner
   > adds 2 fuel stops, 30-minute breaks, 10-hour rests, and a 34-hour restart when the 70-hour
   > cycle runs out. The green badge means an independent validator re-checked the whole plan."
4. **Map:** the dashed line is the drive to pickup and the solid line is the loaded leg; each
   stop type has its own icon. Click **Pickup** in the itinerary: the map flies to Dallas and
   opens the popup (arrival time, duration, mile marker).
   > "Notice it fuels at the pickup instead of stopping again 30 miles later: once the tank is
   > about three-quarters used, it fuels at a stop the driver is making anyway."

### 1:30–2:00 · Trip playback (the centerpiece)

1. Press **Play** on the Trip playback card, and pause about 7 hours into Day 1.
   > "This replays the trip with the same clocks the engine uses. The truck moves along the route,
   > and the four gauges fill against the limits. Driving is at 7 of 11 hours, and the 8-hour
   > break clock is almost full."
2. Drag slightly forward: the 30-minute break appears, and the "until break" gauge drops back to
   zero.
3. Drag to the evening:
   > "Driving hits 11.00 and turns red, 'limit reached'. Now a 10-hour rest starts, and this green
   > bar counts it down. When it fills, the 11- and 14-hour clocks reset."
4. Point at the log sheet below:
   > "The cursor on the log follows the playback, so you can check any moment on the paper
   > log against the clocks."

### 2:00–2:50 · One log sheet, checked against the FMCSA rules

1. Scroll to **Driver's daily logs** and open **Day 1**; the duty line draws itself like a pen. Put the guide's p.18 side by side.
   > "This SVG copies the blank paper log: the header, the black hour band, the four rows with
   > 15-minute ticks, and the totals column."
2. Trace the duty line:
   > "Off duty until 6 AM, a 15-minute pre-trip on line 4, then driving. At exactly 8 hours of
   > driving there's a 30-minute break. That's §395.3(a)(3)(ii). Then driving again until
   > exactly 11.00 hours, the §395.3(a)(3) limit. That happens before the 14-hour window closes
   > at 8 PM, so the 10-hour rest starts here, on the sleeper-berth line."
3. Totals column:
   > "6.50 + 6.25 + 11.00 + 0.25 is exactly 24. Every day adds up to 24, because the engine works
   > in whole minutes."
4. Remarks:
   > "Each change of duty status gets a bracket and a diagonal 'City, ST', like the guide's
   > example. When stops are close together, the labels are spread apart so they never overlap."
5. Recap:
   > "On-duty today is lines 3 plus 4. A is the running 70-hour total starting from the 20 hours
   > already used, and B is what's left for tomorrow."
6. Open the **34-hr restart** day:
   > "A full day off, and the recap resets to 70 hours available."
7. Click **Download PDF** (one Letter page per day) and show **Print** briefly.

### 2:50–4:00 · Code tour

1. `backend/hos/engine.py`. This is pure Python with no Django, so it's easy to test.
   - Show `drive_allowance()`:
     > "Each driving chunk is the minimum of the time left on the leg and the time left under
     > the 11-hour, 14-hour, 8-hour, 70-hour and fuel limits. So driving always stops exactly
     > at the first limit it would hit."
   - Show `required_rest()`:
     > "This picks the rest in priority order: 34-hour, then 10-hour, then 30-minute, then fuel.
     > Each branch is commented with its CFR section."
   - Show `append()`:
     > "One place updates every clock. Any 30 minutes not driving clears the break clock; 10
     > hours off resets the day; 34 hours off resets the cycle."
2. `hos/validator.py` and `tests/test_properties.py`:
   > "The validator rebuilds every clock from the output alone. 576 property tests run it over
   > distances from 30 to 3,300 miles, every cycle value and several start times."
   Run `pytest` → **612 passed**.
3. `trips/services/`:
   > "Geocoding tries OpenRouteService, then Nominatim, then Photon. Routing uses ORS's truck
   > profile, with OSRM as a fallback. Stop names are reverse-geocoded to the nearest town, with
   > caching, deduplication and a 1-request-per-second limit for Nominatim. Every external call
   > has a timeout and returns a clear JSON error."
4. `frontend/src/components/logs/DailyLogSheet.tsx`:
   > "The duty line is a single SVG path: horizontal in the active row, vertical at each
   > change."
   Then `remarksLayout.ts`:
   > "This groups stops and spreads out the labels."

### 4:00–4:40 · Design decisions and trade-offs

- **Night Haul theme:** a truck-cab-at-night dashboard in charcoal, slate and teal, with glowing gauges and a dark map.
  The Day theme is ivory with beige, taupe and deep sage.
  Click **Day** in the header to show the light theme; both come from one set of color tokens.

- **Whole-minute simulation** instead of floating-point hours, so every day totals exactly 24
  and each drive stops exactly at its limit.
- **An independent validator** instead of trusting the engine, and it drives the per-day badges.
- **Honest scope:** no split sleeper berth. Prior cycle hours don't roll off, which is
  conservative. Speed comes from the routing API, so traffic isn't modeled.
- **Free-tier deployment:** the frontend pings the API when the page opens and shows a "waking
  up" state, so a cold start doesn't look like a failure.
- **What I'd add next:** split-sleeper optimization, a 60-hour/7-day option, and entering real
  prior-day hours for an exact rolling 8-day recap.

> "Thanks for watching."
