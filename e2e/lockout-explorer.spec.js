import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  installFakeSupabase, signIn, SEED_VAULT, ymd, addDaysYmd,
} from './support/fakeSupabase.js'

/**
 * Lockout explorer — walks the real Prep Table through every path in the
 * flow model (docs: prep-table-flow.mermaid) across SIMULATED DAYS, against a
 * stateful fake database, and records at each step whether the planner can
 * still plan the dates she wants.
 *
 * This is an investigation, not a regression suite: most steps RECORD rather
 * than assert, and each scenario writes its timeline to
 * e2e-results/lockout/<scenario>.json plus a screenshot per step.
 *
 * Simulated calendar: Sunday 2026-11-01 is "week 1".
 */

const OUT = path.join('e2e-results', 'lockout')
const SUN = '2026-11-01'
const day = (n) => addDaysYmd(SUN, n) // day(0) = Sun Nov 1, day(7) = Sun Nov 8

function at(isoYmd, hour = 10) {
  const [y, m, d] = isoYmd.split('-').map(Number)
  return new Date(y, m - 1, d, hour)
}

// --- harness ---------------------------------------------------------------

async function setup(page, { start, seed } = {}) {
  const sim = { now: at(start ?? SUN) }
  const db = await installFakeSupabase(page, {
    now: () => sim.now,
    seed: { vault: SEED_VAULT, ...seed },
  })
  await page.clock.setFixedTime(sim.now)
  await page.goto('/')
  await signIn(page)
  await openPrepTable(page)
  return { sim, db, steps: [] }
}

async function openPrepTable(page) {
  await page.reload()
  await page.getByRole('button', { name: 'Prep Table' }).click()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 })
}

async function goToDay(page, ctx, isoYmd) {
  ctx.sim.now = at(isoYmd)
  await page.clock.setFixedTime(ctx.sim.now)
  await openPrepTable(page)
}

const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible())

async function observe(page) {
  const screen =
    (await visible(page.getByText(/Something went wrong/i))) ? 'ERROR'
    : (await visible(page.getByTestId('start-new-period-btn'))) ? 'gap-day'
    : (await visible(page.getByText(/Your period has ended/i))) ? 'ended-not-locked-in'
    : (await visible(page.getByText(/^Served on/))) ? 'served-locked'
    : (await visible(page.getByRole('button', { name: /Serve This Plan/i }))) ? 'brainstorm'
    : 'unknown'
  const serve = page.getByRole('button', { name: /Serve This Plan/i })
  return {
    screen,
    serveEnabled: (await visible(serve)) ? await serve.isEnabled() : false,
    dateStrip: await visible(page.getByTestId('date-strip-picker')),
    addMealButtons: await page.getByRole('button', { name: /^(Schedule a meal for|Add another meal to)/ }).count(),
    regenerateEnabled: (await visible(page.getByRole('button', { name: /^Regenerate$/ })))
      ? await page.getByRole('button', { name: /^Regenerate$/ }).isEnabled() : false,
    resetVisible: await visible(page.getByRole('button', { name: /Reset this plan/i })),
    lockInVisible: await visible(page.getByRole('button', { name: /Lock in as-is/i })),
  }
}

/** Latest plan the app will load (same rule as fetchMostRecentPlan). */
function latestPlan(db) {
  return [...db.tables.meal_plans].sort((a, b) => (a.served_at < b.served_at ? 1 : -1))[0] ?? null
}

/**
 * NON-DESTRUCTIVE probe: from the current screen, can she start planning
 * `target` (a date she wants to plan, e.g. next Sunday)? Returns { can, how }.
 */
async function canPlan(page, ctx, target) {
  const o = await observe(page)
  if (o.screen === 'ERROR') return { can: false, how: 'error screen' }

  if (o.screen === 'brainstorm') {
    if (await visible(page.getByTestId('date-strip-expand'))) await page.getByTestId('date-strip-expand').click()
    const cell = page.getByTestId(`date-strip-cell-${target}`)
    if (!(await cell.count())) return { can: false, how: 'date is beyond the 14-day strip' }
    const disabled = (await cell.getAttribute('data-disabled')) === 'true'
    return disabled
      ? { can: false, how: 'date greyed out on the strip (inside an existing week)' }
      : { can: true, how: 'pick it on the date strip' }
  }

  if (o.screen === 'gap-day') {
    await page.getByTestId('start-new-period-btn').click()
    await navigateCalendarTo(page, target)
    for (const d of [target, addDaysYmd(target, 4)]) {
      const cell = page.getByTestId(`calendar-day-${d}`)
      if (await cell.isDisabled()) {
        await page.getByTestId('picker-cancel').click()
        await expect(page.getByTestId('date-range-picker')).toHaveCount(0)
        return { can: false, how: `calendar won't let her tap ${d} (greyed out)` }
      }
      await cell.click()
    }
    await page.waitForTimeout(700) // overlap check is debounced 300 ms
    const ok = await page.getByTestId('picker-confirm').isEnabled()
    const banner = await visible(page.getByTestId('overlap-banner'))
    await page.getByTestId('picker-cancel').click()
    await expect(page.getByTestId('date-range-picker')).toHaveCount(0)
    return ok
      ? { can: true, how: 'Start new planning period → calendar (the new week starts locked)' }
      : { can: false, how: banner ? 'calendar refuses: overlaps an earlier week' : 'calendar Confirm stays disabled' }
  }

  // Locked views (served / ended-not-locked-in): only "+" on days of THIS week.
  const p = latestPlan(ctx.db)
  if (p && target >= p.period_start && target <= p.period_end) {
    return { can: true, how: '"+" on that day of the locked week' }
  }
  return {
    can: false,
    how: o.screen === 'ended-not-locked-in'
      ? 'must lock in last week first (no way to plan from here)'
      : `locked on ${p?.period_start}–${p?.period_end}; no control to plan other dates until it ends`,
  }
}

async function navigateCalendarTo(page, target) {
  // The calendar opens only after the leftovers fetch resolves.
  await expect(page.getByTestId('date-range-picker')).toBeVisible()
  for (let i = 0; i < 24; i++) {
    const cell = page.getByTestId(`calendar-day-${target}`)
    if ((await cell.count()) && (await cell.getAttribute('data-in-month')) === 'true') return
    await page.getByRole('button', { name: /next month/i }).click()
  }
  throw new Error(`calendar never reached ${target}`)
}

async function record(page, ctx, label, { wants } = {}) {
  const obs = await observe(page)
  const entry = { day: ymd(ctx.sim.now), step: label, ...obs }
  if (wants) entry.canPlan = { target: wants, ...(await canPlan(page, ctx, wants)) }
  ctx.steps.push(entry)
  const name = `${ctx.steps.length}`.padStart(2, '0')
  await page.screenshot({ path: path.join(OUT, ctx.id, `${name}.png`), fullPage: true })
  return entry
}

function save(ctx, extra = {}) {
  fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })
  const errors = ctx.db.log.filter((l) => l.error || l.rejected)
  extra.finalPlans = ctx.db.tables.meal_plans.map((p) => ({
    period: `${p.period_start}..${p.period_end}`,
    lockedIn: !!p.finalized_at,
    meals: ctx.db.tables.meal_plan_items
      .filter((i) => i.meal_plan_id === p.id)
      .map((i) => `${i.scheduled_date ?? 'maybe'}: ${i.name}${i.cooked ? ' (cooked)' : ''}`),
  }))
  fs.writeFileSync(
    path.join(OUT, `${ctx.id}.json`),
    JSON.stringify({ scenario: ctx.id, title: ctx.title, steps: ctx.steps, dbProblems: errors, ...extra }, null, 2),
  )
}

// --- actions ---------------------------------------------------------------

async function serve(page) {
  await page.getByRole('button', { name: /Serve This Plan/i }).click()
  await page.getByRole('button', { name: /Looks great/i }).click()
  await expect(page.getByText(/^Served on/)).toBeVisible()
}

async function resetPlan(page) {
  await page.getByRole('button', { name: /Reset this plan/i }).click()
  await page.getByRole('button', { name: /^Reset plan$/ }).click()
  await expect(page.getByRole('button', { name: /^Reset plan$/ })).toHaveCount(0, { timeout: 15000 })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 })
  await page.waitForTimeout(500)
}

/** On the brainstorm strip, make exactly `dates` selected. */
async function selectOnly(page, dates) {
  if (await visible(page.getByTestId('date-strip-expand'))) await page.getByTestId('date-strip-expand').click()
  const cells = page.locator('[data-testid^="date-strip-cell-"]')
  for (let i = 0; i < (await cells.count()); i++) {
    const c = cells.nth(i)
    const d = (await c.getAttribute('data-testid')).replace('date-strip-cell-', '')
    const selected = (await c.getAttribute('data-selected')) === 'true'
    if (selected !== dates.includes(d) && (await c.getAttribute('data-disabled')) !== 'true') await c.click()
  }
}

// Seed helpers: a finished, locked-in week with some uncooked meals.
function lockedInWeek(id, start, end, meals = ['Chicken Tacos', 'Veggie Curry']) {
  return {
    plan: {
      id, user_id: 'test-user', period_start: start, period_end: end,
      served_at: `${start}T09:00:00Z`, finalized_at: `${addDaysYmd(end, 1)}T09:00:00Z`,
      served_feedback: null, days: null, items: null, week_label: null,
    },
    items: meals.map((name, i) => ({
      id: `${id}-item-${i}`, user_id: 'test-user', meal_plan_id: id,
      scheduled_date: addDaysYmd(start, i), position: 0, vault_id: null, name,
      is_wildcard: false, source_url: null, cooked: false, cooked_at: null, is_shortlisted: false,
    })),
  }
}

// --- scenarios -------------------------------------------------------------

test.describe('Lockout explorer', () => {
  test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }))

  // Updated after the #205 stopgap: an ended week opens straight into the
  // suggested-week view, so there is no lock-in / gap-day / calendar step.
  test('A · a normal week, then planning the next one', async ({ page }) => {
    const ctx = await setup(page)
    Object.assign(ctx, { id: 'A-normal-cycle', title: 'Serve week 1, then try to plan week 2 at each point' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    await record(page, ctx, 'Sun wk1: first open (no plan yet)', { wants: day(0) })
    await serve(page)
    await record(page, ctx, 'Sun wk1: served default Sun–Thu', { wants: day(7) })
    await goToDay(page, ctx, day(3))
    await record(page, ctx, 'Wed wk1: wants to plan next week early', { wants: day(7) })
    await goToDay(page, ctx, day(5))
    const fri = await record(page, ctx, 'Fri wk1: week over', { wants: day(7) })
    expect(fri.screen).toBe('brainstorm') // stopgap: no lock-in step
    await selectOnly(page, [day(7), day(8), day(9), day(10), day(11)])
    await serve(page)
    await record(page, ctx, 'Fri wk1: served week 2 from fresh suggestions', { wants: day(8) })
    // Week 1's meals stay in its history (finding 4 no longer reproduces).
    const wk1 = ctx.db.tables.meal_plans.find((p) => p.period_start === day(0))
    expect(ctx.db.tables.meal_plan_items.filter((i) => i.meal_plan_id === wk1.id)).toHaveLength(5)
    save(ctx)
  })

  test('B · serving next week from the strip (a future week)', async ({ page }) => {
    const ctx = await setup(page, { start: day(3) }) // Wed wk1, no plan yet
    Object.assign(ctx, { id: 'B-serve-future-week', title: 'On Wednesday, plan next week first, then come back for the rest of this week' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    await record(page, ctx, 'Wed wk1: open, no plan', { wants: day(7) })
    await selectOnly(page, [day(7), day(8), day(9), day(10), day(11)])
    await serve(page)
    await record(page, ctx, 'Wed wk1: served NEXT week only', { wants: day(4) })
    await goToDay(page, ctx, day(4))
    await record(page, ctx, 'Thu wk1: wants dinner for Thu/Fri this week', { wants: day(5) })
    save(ctx)
  })

  test('C · reset after a few weeks of use', async ({ page }) => {
    const w0 = lockedInWeek('wk0', addDaysYmd(SUN, -7), addDaysYmd(SUN, -3))
    const ctx = await setup(page, {
      start: day(0),
      seed: { meal_plans: [w0.plan], meal_plan_items: w0.items },
    })
    Object.assign(ctx, { id: 'C-reset', title: 'Previous week locked in; serve this week, then reset it' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    const first = await record(page, ctx, 'Sun wk1: last week locked in', { wants: day(0) })
    expect(first.screen).toBe('brainstorm') // stopgap: no gap-day screen
    await serve(page)
    await goToDay(page, ctx, day(1)) // Reset only appears after a reload
    await record(page, ctx, 'Mon wk1: this week served', { wants: day(1) })
    await resetPlan(page)
    const after = await record(page, ctx, 'Mon wk1: after "Reset this plan"', { wants: day(1) })
    expect(after.screen).toBe('brainstorm')
    save(ctx)
  })

  test('D · came back after weeks away', async ({ page }) => {
    const ctx = await setup(page, { start: day(0) })
    Object.assign(ctx, { id: 'D-came-back-later', title: 'Serve week 1, skip three weeks, come back' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    await serve(page)
    await goToDay(page, ctx, day(24)) // Wed, three weeks later
    const back = await record(page, ctx, 'Wed wk4: back after 3 weeks', { wants: day(25) })
    expect(back.screen).toBe('brainstorm') // stopgap: no "lock in the old week" chore
    await serve(page)
    await record(page, ctx, 'Wed wk4: served from fresh suggestions', { wants: day(25) })
    save(ctx)
  })

  test('E · picking the calendar dates', async ({ page }) => {
    const w0 = lockedInWeek('wk0', addDaysYmd(SUN, -3), day(1)) // Thu → Mon, locked in
    const ctx = await setup(page, {
      start: day(2), // Tue
      seed: { meal_plans: [w0.plan], meal_plan_items: w0.items },
    })
    Object.assign(ctx, { id: 'E-calendar-dates', title: 'Gap day on Tuesday: which date ranges can she pick?' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    await record(page, ctx, 'Tue: gap day', { wants: day(2) })
    const tries = {}
    for (const [label, from] of [
      ['this Sun (inside last week)', day(0)],
      ['yesterday Mon (last day of last week)', day(1)],
      ['today Tue', day(2)],
      ['next Sun', day(7)],
    ]) {
      tries[label] = await canPlan(page, ctx, from)
    }
    save(ctx, { calendarTries: tries })
  })

  test('F · two weeks served back to back from the strip', async ({ page }) => {
    const ctx = await setup(page, { start: day(0) })
    Object.assign(ctx, { id: 'F-two-weeks-strip', title: 'Serve a 2-week plan from the strip, then try next steps' })
    fs.mkdirSync(path.join(OUT, ctx.id), { recursive: true })

    await selectOnly(page, [day(0), day(1), day(2), day(8), day(9)])
    await serve(page)
    await record(page, ctx, 'Sun wk1: served Sun–Tue + next Mon–Tue', { wants: day(4) })
    await goToDay(page, ctx, day(5))
    await record(page, ctx, 'Fri wk1: gap inside the served range', { wants: day(5) })
    save(ctx)
  })
})
