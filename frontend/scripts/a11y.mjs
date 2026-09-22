// Accessibility check of the results screen with axe-core (WCAG 2 A/AA). Usage: node scripts/a11y.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const b = await chromium.launch({ channel: 'chrome' })
// usage: node scripts/a11y.mjs [url] [dark|light]
const theme = process.argv[3] ?? 'dark'
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addInitScript((t) => localStorage.setItem('hos.theme', t), theme)
const p = await ctx.newPage()
// the landing dashboard first
await p.goto(process.argv[2] ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await p.addScriptTag({ content: axe })
const landing = await p.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }))
for (const v of landing.violations) console.log('  [landing]', v.impact, v.id, '-', v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | '))
console.log(`[${theme}] landing:`, landing.violations.length ? `${landing.violations.length} violation(s)` : 'clean')
await p.goto(`${process.argv[2] ?? 'http://localhost:5173'}/#plan`)
await p.getByRole('button', { name: /Near cycle limit/ }).click()
await p.getByText('Trip summary').waitFor({ timeout: 120000 })
await p.waitForTimeout(1500)
await p.addScriptTag({ content: axe })
const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }))
for (const v of r.violations) console.log(v.impact, v.id, '-', v.help, '\n   ', v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))
console.log(`[${theme}]`, r.violations.length ? `${r.violations.length} rule(s) violated` : 'axe: no WCAG A/AA violations')
await b.close()
