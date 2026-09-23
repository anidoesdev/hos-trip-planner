// End-to-end QA: runs every preset in real Chrome, checks data consistency and layout,
// and saves screenshots to ../docs/screenshots. Usage: node scripts/qa.mjs [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = new URL('../../docs/screenshots/qa/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const shot = (name) => new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const PRESETS = ['Short haul', 'Cross-country', 'Near cycle limit']
const problems = []
const fail = (msg) => {
  problems.push(msg)
  console.log('  ✗', msg)
}

const browser = await chromium.launch({ channel: 'chrome' })

async function newPage(width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return { page, errors, ctx }
}

async function noHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
  if (sw > iw) fail(`${label}: page scrolls horizontally (${sw} > ${iw})`)
}

async function runPreset(page, title) {
  const resP = page.waitForResponse((r) => r.url().includes('/api/trip/plan') && r.request().method() === 'POST', { timeout: 150_000 })
  await page.getByRole('button', { name: new RegExp(title) }).click()
  const res = await resP
  const plan = await res.json()
  if (!res.ok()) {
    fail(`${title}: API ${res.status()} ${JSON.stringify(plan)}`)
    return null
  }
  await page.getByText('Trip summary').waitFor({ timeout: 30_000 })
  await page.locator('.leaflet-marker-icon').first().waitFor({ timeout: 30_000 })
  return plan
}

// ---- landing dashboard -> centered form -> results ---------------------------------------------
for (const width of [1440, 768, 375]) {
  console.log(`\n▶ landing flow @${width}px`)
  const { page, errors, ctx } = await newPage(width, width === 375 ? 812 : 1000)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /Plan a compliant truck trip/ }).waitFor({ timeout: 10_000 }).catch(() => fail(`landing @${width}: hero missing`))
  if (await page.locator('#current').count()) fail(`landing @${width}: form should not show on the dashboard`)
  await noHorizontalScroll(page, `landing @${width}`)
  if (width === 1440) await page.screenshot({ path: shot('landing-1440.png'), fullPage: true })

  // the centre button opens the form on its own
  await page.getByRole('button', { name: /^Plan a trip/ }).click()
  await page.locator('#current').waitFor({ timeout: 5_000 }).catch(() => fail(`landing @${width}: Plan a trip did not open the form`))
  if (!page.url().endsWith('#plan')) fail(`landing @${width}: url is ${page.url()}, expected #plan`)
  const box = await page.locator('aside').boundingBox()
  const centred = box && Math.abs(box.x + box.width / 2 - width / 2) < 24
  if (!centred) fail(`landing @${width}: form is not centred (x=${box?.x}, w=${box?.width})`)
  await noHorizontalScroll(page, `centred form @${width}`)

  // browser Back returns to the dashboard
  await page.goBack()
  await page.getByRole('heading', { name: /Plan a compliant truck trip/ }).waitFor({ timeout: 5_000 }).catch(() => fail(`landing @${width}: Back did not return to the dashboard`))

  if (width === 1440) {
    // typed values survive the move from the centred form to the results sidebar
    await page.getByRole('button', { name: /^Plan a trip/ }).click()
    await page.fill('#current', 'Chicago, IL')
    await page.fill('#pickup', 'Milwaukee, WI')
    await page.fill('#dropoff', 'Madison, WI')
    await page.getByRole('button', { name: 'Plan trip & generate logs' }).click()
    await page.getByText('Trip summary').waitFor({ timeout: 120_000 })
    const kept = await page.locator('#dropoff').inputValue()
    if (kept !== 'Madison, WI') fail(`form lost its values moving to results (dropoff="${kept}")`)
    if (!page.url().endsWith('#results')) fail(`results url is ${page.url()}`)
    // "See an example" from the dashboard runs the cross-country preset
    await page.getByRole('link', { name: /HOS Trip Planner/ }).click()
    await page.getByRole('button', { name: 'See an example' }).click()
    await page.getByText('Chicago, IL → Dallas, TX → Los Angeles, CA').waitFor({ timeout: 120_000 }).catch(() => fail('See an example did not plan the cross-country trip'))
    console.log('  dashboard → form → results → dashboard → example: ok')
  }
  if (errors.length) fail(`console errors on landing @${width}: ${errors.join(' | ')}`)
  await ctx.close()
}

// ---- desktop: every preset -------------------------------------------------------------
{
  const { page, errors, ctx } = await newPage(1440, 1000)
  await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: shot('empty-1440.png') })

  for (const title of PRESETS) {
    console.log(`\n▶ ${title}`)
    const plan = await runPreset(page, title)
    if (!plan) continue
    const s = plan.summary
    console.log(`  ${s.total_miles} mi · ${s.number_of_days} days · drive ${s.total_driving_hours} h · fuel ${s.fuel_stops} · breaks ${s.breaks_30min} · 10h ${s.resets_10hr} · 34h ${s.restarts_34hr} · compliance ${plan.compliance.ok}`)

    // every day totals 24
    for (const d of plan.daily_logs) {
      const sum = Object.values(d.totals_hours).reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 24) > 1e-9) fail(`${title}: ${d.date} totals ${sum}`)
      if (!d.compliance?.ok) fail(`${title}: ${d.date} not compliant`)
    }
    if (!plan.compliance.ok) fail(`${title}: plan not compliant`)

    // itinerary rows == API stops (+ start row when there is no pre-trip)
    const itinStops = await page.locator('ol button[aria-pressed]').count()
    const expected = plan.stops.length + (plan.events.some((e) => e.kind === 'pre_trip') ? 0 : 1)
    if (itinStops !== expected) fail(`${title}: itinerary shows ${itinStops} stops, API has ${expected}`)

    // every stop is on a map marker (markers group co-located stops)
    const markers = await page.locator('.leaflet-marker-icon').count()
    const places = new Set(plan.stops.map((st) => `${st.lat.toFixed(3)},${st.lng.toFixed(3)}`))
    console.log(`  itinerary stops ${itinStops} · map markers ${markers} · distinct stop places ${places.size}`)
    if (markers < Math.min(places.size, 2)) fail(`${title}: only ${markers} markers for ${places.size} places`)

    // log sheets: one tab per day, sheet shows "=24", duty line drawn
    const tabs = await page.getByRole('tab').count()
    if (tabs !== plan.daily_logs.length) fail(`${title}: ${tabs} tabs vs ${plan.daily_logs.length} logs`)
    for (let i = 0; i < tabs; i++) {
      await page.getByRole('tab').nth(i).click()
      const sheet = page.locator('#log-sheet-panel svg')
      const txt = await sheet.textContent()
      if (!txt.includes('=24')) fail(`${title}: day ${i + 1} sheet lacks "=24"`)
      const d = await sheet.locator('[data-testid="duty-line"]').getAttribute('d')
      if (!d || d.length < 10) fail(`${title}: day ${i + 1} duty line missing`)
      const log = plan.daily_logs[i]
      for (const st of ['OFF', 'SB', 'D', 'ON']) {
        if (!txt.includes(log.totals_hours[st].toFixed(2))) fail(`${title}: day ${i + 1} missing total ${st}`)
      }
    }

    // playback: scrub to mid-trip → truck on the map, gauges running, cursor on the matching sheet
    const slider = page.getByRole('slider', { name: 'Trip time' })
    const mid = await slider.evaluate((el) => {
      const v = String(Math.round((Number(el.min) + Number(el.max)) / 2 / 300000) * 300000)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return Number(v)
    })
    await page.waitForTimeout(300)
    if (!(await page.locator('.leaflet-marker-icon[title="Truck position"]').count())) fail(`${title}: no truck marker after scrubbing`)
    if (!(await page.locator('[data-testid="log-cursor"]').count())) fail(`${title}: no log cursor after scrubbing`)
    const midDate = new Date(mid)
    const midIso = `${midDate.getFullYear()}-${String(midDate.getMonth() + 1).padStart(2, '0')}-${String(midDate.getDate()).padStart(2, '0')}`
    const shownDay = await page.getByRole('tab', { selected: true }).textContent()
    const wantDay = plan.daily_logs.findIndex((d) => d.date === midIso) + 1
    if (!shownDay.includes(`Day ${wantDay}`)) fail(`${title}: scrub to ${midIso} shows "${shownDay}", expected Day ${wantDay}`)
    // the pen animation must finish with the full line drawn
    await page.waitForTimeout(2600)
    const offset = await page.locator('#log-sheet-panel [data-testid="duty-line"]').evaluate((el) => getComputedStyle(el).strokeDashoffset)
    if (!['0', '0px'].includes(offset)) fail(`${title}: duty line not fully drawn (dashoffset ${offset})`)

    // clicking an itinerary stop opens its popup on the map
    const stopRow = page.locator('ol button[aria-pressed]').nth(Math.min(2, itinStops - 1))
    await stopRow.click()
    await page.locator('.leaflet-popup-content').waitFor({ timeout: 5_000 }).catch(() => fail(`${title}: itinerary click did not open popup`))

    const slug = title.toLowerCase().replace(/\s+/g, '-')
    await page.getByRole('tab').first().click()
    await page.screenshot({ path: shot(`results-${slug}-1440.png`), fullPage: true })
    await page.locator('#log-sheet-panel svg').screenshot({ path: shot(`logsheet-${slug}.png`) })
    await noHorizontalScroll(page, `${title} @1440`)
  }

  // PDF download (last preset)
  const dl = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const file = await dl
  const path = shot('daily-logs.pdf')
  await file.saveAs(path)
  console.log(`\n  PDF: ${file.suggestedFilename()} · ${(statSync(path).size / 1024).toFixed(0)} KB`)

  if (errors.length) fail(`console errors @1440: ${errors.join(' | ')}`)
  await ctx.close()
}

// ---- tablet + phone ----------------------------------------------------------------------
for (const width of [768, 375]) {
  console.log(`\n▶ layout @${width}px`)
  const { page, errors, ctx } = await newPage(width, width === 375 ? 812 : 1024)
  await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
  await noHorizontalScroll(page, `empty @${width}`)
  await page.screenshot({ path: shot(`empty-${width}.png`), fullPage: true })
  await runPreset(page, 'Cross-country')
  await page.waitForTimeout(800)
  await noHorizontalScroll(page, `results @${width}`)
  await page.screenshot({ path: shot(`results-${width}.png`), fullPage: true })
  if (errors.length) fail(`console errors @${width}: ${errors.join(' | ')}`)
  await ctx.close()
}

// ---- validation + error states ------------------------------------------------------------
{
  console.log('\n▶ validation & errors')
  const { page, ctx } = await newPage(1440)
  await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Plan trip & generate logs' }).click()
  const inline = await page.getByText('Enter where the truck is now.').isVisible()
  if (!inline) fail('empty submit shows no inline error')
  await page.fill('#current', 'Chicago, IL')
  await page.fill('#pickup', 'Qzxqzx Nowhereville')
  await page.fill('#dropoff', 'Denver, CO')
  await page.getByRole('button', { name: 'Plan trip & generate logs' }).click()
  await page.getByText("We couldn't find one of those places").waitFor({ timeout: 60_000 }).catch(() => fail('location_not_found state not shown'))
  const fieldErr = await page.locator('#pickup-error').isVisible().catch(() => false)
  if (!fieldErr) fail('location_not_found not attached to pickup field')
  await page.screenshot({ path: shot('error-state.png') })

  await ctx.close()
}

await browser.close()
console.log(problems.length ? `\n${problems.length} problem(s)` : '\n✓ all QA checks passed')
process.exit(problems.length ? 1 : 0)
