// Curated screenshots for the README. Usage: node scripts/readme-shots.mjs [baseUrl]
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:5173'
const dir = new URL('../../docs/screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const b = await chromium.launch({ channel: 'chrome' })

const desk = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 })
await desk.goto(BASE, { waitUntil: 'networkidle' })
await desk.waitForTimeout(4200) // let the preview animation reach its full frame
await desk.screenshot({ path: `${dir}landing.png` })
await desk.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
await desk.screenshot({ path: `${dir}empty-state.png` })
const planRes = desk.waitForResponse((r) => r.url().includes('/api/trip/plan') && r.request().method() === 'POST')
await desk.getByRole('button', { name: /Cross-country/ }).click()
const plan = await (await planRes).json()
await desk.getByText('Trip summary').waitFor({ timeout: 120000 })
await desk.waitForLoadState('networkidle')
await desk.waitForTimeout(1500)
await desk.screenshot({ path: `${dir}app-desktop.png` })
await desk.locator('section[aria-labelledby="route-heading"]').screenshot({ path: `${dir}map-itinerary.png` })
// playback scrubbed 3 h into the first 10-hr rest: clocks at their limits, rest refilling them
const reset = plan.events.find((e) => e.kind === 'reset')
await desk.getByRole('slider', { name: 'Trip time' }).evaluate((el, t) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(t))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, new Date(reset.start).getTime() + 3 * 3600e3)
await desk.waitForTimeout(1200)
await desk.getByRole('slider', { name: 'Trip time' }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').screenshot({ path: `${dir}playback.png` })
await desk.getByRole('tab').nth(1).click()
await desk.locator('#log-sheet-panel svg').screenshot({ path: `${dir}log-sheet.png` })

// the Day theme, for the side-by-side in the README
const dayCtx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 })
await dayCtx.addInitScript(() => localStorage.setItem('hos.theme', 'light'))
const day = await dayCtx.newPage()
await day.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
await day.getByRole('button', { name: /Cross-country/ }).click()
await day.getByText('Trip summary').waitFor({ timeout: 120000 })
await day.waitForLoadState('networkidle')
await day.waitForTimeout(1500)
await day.screenshot({ path: `${dir}app-desktop-day.png` })
await dayCtx.close()

const phone = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await phone.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' })
await phone.screenshot({ path: `${dir}mobile-form.png` })
await phone.getByRole('button', { name: /Cross-country/ }).click()
await phone.getByText('Trip summary').waitFor({ timeout: 120000 })
await phone.waitForTimeout(1500)
await phone.screenshot({ path: `${dir}mobile-results.png` })
await b.close()
console.log('saved to', dir)
