// Curated screenshots for the README. Usage: node scripts/readme-shots.mjs [baseUrl]
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:5173'
const dir = new URL('../../docs/screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const b = await chromium.launch({ channel: 'chrome' })

const desk = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 })
await desk.goto(BASE, { waitUntil: 'networkidle' })
await desk.screenshot({ path: `${dir}empty-state.png` })
await desk.getByRole('button', { name: /Cross-country/ }).click()
await desk.getByText('Trip summary').waitFor({ timeout: 120000 })
await desk.waitForLoadState('networkidle')
await desk.waitForTimeout(1500)
await desk.screenshot({ path: `${dir}app-desktop.png` })
await desk.locator('section[aria-labelledby="route-heading"]').screenshot({ path: `${dir}map-itinerary.png` })
await desk.getByRole('tab').nth(1).click()
await desk.locator('#log-sheet-panel svg').screenshot({ path: `${dir}log-sheet.png` })

const phone = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await phone.goto(BASE, { waitUntil: 'networkidle' })
await phone.screenshot({ path: `${dir}mobile-form.png` })
await phone.getByRole('button', { name: /Cross-country/ }).click()
await phone.getByText('Trip summary').waitFor({ timeout: 120000 })
await phone.waitForTimeout(1500)
await phone.screenshot({ path: `${dir}mobile-results.png` })
await b.close()
console.log('saved to', dir)
