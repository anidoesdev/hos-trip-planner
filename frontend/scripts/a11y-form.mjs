// Accessibility scan of the location dropdown and date/time picker, in both themes. Usage: node scripts/a11y-form.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const b = await chromium.launch({ channel: 'chrome' })
for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript((t) => localStorage.setItem('hos.theme', t), theme)
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173/#plan', { waitUntil: 'networkidle' })
  await p.addScriptTag({ content: axe })
  const scan = async (label) => {
    const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }))
    for (const v of r.violations) console.log(`  [${theme}/${label}]`, v.impact, v.id, '-', v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | '))
    console.log(`[${theme}] ${label}:`, r.violations.length ? `${r.violations.length} violation(s)` : 'clean')
  }
  await p.locator('#pickup').pressSequentially('Pilot travel center', { delay: 25 })
  await p.locator('[role="listbox"] [role="option"]').first().waitFor({ timeout: 15000 })
  await p.waitForTimeout(500)
  await scan('location dropdown')
  await p.keyboard.press('Escape')
  await p.locator('#start').click()
  await p.waitForTimeout(300)
  await scan('date/time picker')
  await ctx.close()
}
await b.close()
