// Accessibility check of the results screen with axe-core (WCAG 2 A/AA). Usage: node scripts/a11y.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } })
await p.goto(process.argv[2] ?? 'http://localhost:5173')
await p.getByRole('button', { name: /Near cycle limit/ }).click()
await p.getByText('Trip summary').waitFor({ timeout: 120000 })
await p.waitForTimeout(1500)
await p.addScriptTag({ content: axe })
const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }))
for (const v of r.violations) console.log(v.impact, v.id, '-', v.help, '\n   ', v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))
console.log(r.violations.length ? `${r.violations.length} rule(s) violated` : 'axe: no WCAG A/AA violations')
await b.close()
