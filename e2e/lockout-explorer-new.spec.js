import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  installFakeSupabase, signIn, SEED_VAULT, addDaysYmd,
} from './support/fakeSupabase.js'

/**
 * Lockout explorer, NEW Prep Table (PRD-008 2c). The 2026-11-01 explorer
 * (lockout-explorer.spec.js, retired with the old screens in phase 4) found four ways the old period-based screens
 * locked her out of planning (docs/research/2026-11-01-prep-table-lockout.md).
 * This walks the same situations through the new week screens, across
 * simulated days, against the same stateful fake database — and ASSERTS that
 * none of the four comes back. A screenshot per step goes to
 * e2e-results/lockout-new/<scenario>/.
 *
 * Run it:
 *   npx playwright test e2e/lockout-explorer-new.spec.js
 *
 * Simulated calendar: Sunday 2026-11-01 is "week 1".
 */


const OUT = path.join('e2e-results', 'lockout-new')
const SUN = '2026-11-01'
const day = (n) => addDaysYmd(SUN, n) // day(0) = Sun Nov 1, day(7) = Sun Nov 8

function at(isoYmd, hour = 10) {
  const [y, m, d] = isoYmd.split('-').map(Number)
  return new Date(y, m - 1, d, hour)
}

/** Planned meals, one per day from `start`, none cooked unless asked. */
function mealsFrom(start, names, { cooked = false } = {}) {
  return names.map((name, i) => {
    const recipe = SEED_VAULT.find((v) => v.name === name)
    return {
      id: `seed-${start}-${i}`, user_id: 'test-user', planned_on: addDaysYmd(start, i), position: 0,
      name, vault_id: recipe?.id ?? null, is_wildcard: false, source_url: null,
      cooked, cooked_at: cooked ? `${addDaysYmd(start, i)}T20:00:00Z` : null,
      assigned_to: null, assigned_at: null,
      created_at: `${start}T08:00:00Z`, updated_at: `${start}T08:00:00Z`,
    }
  })
}

// --- harness ---------------------------------------------------------------

async function setup(page, id, { start = SUN, seed = {} } = {}) {
  const sim = { now: at(start) }
  const db = await installFakeSupabase(page, { now: () => sim.now, seed: { vault: SEED_VAULT, ...seed } })
  await page.clock.setFixedTime(sim.now)
  await page.goto('/')
  await signIn(page)
  const ctx = { id, sim, db, n: 0 }
  fs.mkdirSync(path.join(OUT, id), { recursive: true })
  await openPrepTable(page)
  return ctx
}

async function openPrepTable(page) {
  await page.reload()
  await page.getByRole('button', { name: 'Prep Table' }).click()
  await expect(page.getByTestId('week-title')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('status', { name: 'Loading the week' })).toHaveCount(0, { timeout: 15000 })
}

async function goToDay(page, ctx, isoYmd) {
  ctx.sim.now = at(isoYmd)
  await page.clock.setFixedTime(ctx.sim.now)
  await openPrepTable(page)
}

async function shot(page, ctx, label) {
  ctx.n += 1
  const name = `${String(ctx.n).padStart(2, '0')}-${label}`
  await page.screenshot({ path: path.join(OUT, ctx.id, `${name}.png`), fullPage: true })
}

/** The day card for a date ("Sun Nov 8"). */
function dayCard(page, isoYmd) {
  return page.locator(`section[data-date="${isoYmd}"]`)
}

async function nextWeek(page) {
  const before = await page.getByTestId('week-title').textContent()
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.getByTestId('week-title')).not.toHaveText(before)
  await expect(page.getByRole('status', { name: 'Loading the week' })).toHaveCount(0, { timeout: 15000 })
}

async function previousWeek(page) {
  const before = await page.getByTestId('week-title').textContent()
  await page.getByRole('button', { name: 'Previous week' }).click()
  await expect(page.getByTestId('week-title')).not.toHaveText(before)
  await expect(page.getByRole('status', { name: 'Loading the week' })).toHaveCount(0, { timeout: 15000 })
}

/** "+ add" on an empty day, pick a cookbook recipe. Proves the day can be planned. */
async function addOn(page, isoYmd, recipe) {
  await dayCard(page, isoYmd).getByRole('button', { name: '+ add' }).click()
  const sheet = page.getByTestId('add-meal-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByPlaceholder('Search your cookbook').fill(recipe.split(' ')[0])
  await sheet.getByRole('button', { name: new RegExp(`^${recipe}`) }).click()
  await expect(dayCard(page, isoYmd)).toContainText(recipe)
}

async function confirmWeek(page) {
  await page.getByRole('button', { name: 'Confirm the week' }).click()
  const anyway = page.getByRole('button', { name: 'Confirm anyway' })
  if (await anyway.isVisible().catch(() => false)) await anyway.click()
  await expect(page.getByRole('region', { name: 'Week confirmed' })).toBeVisible({ timeout: 15000 })
}

const mealsOn = (ctx, isoYmd) => ctx.db.tables.planned_meals.filter((m) => m.planned_on === isoYmd)
const dbErrors = (ctx) => ctx.db.log.filter((l) => l.error)

// --- scenarios -------------------------------------------------------------

test.describe('Lockout explorer — new Prep Table', () => {
  test('1 · next week can be planned while this week is still open (finding 1)', async ({ page }) => {
    const ctx = await setup(page, '1-plan-next-week', {
      start: day(3),
      seed: { planned_meals: mealsFrom(SUN, ['Chicken Tacos', 'Veggie Curry', 'Turkey Chili']) },
    })
    await shot(page, ctx, 'wed-this-week')
    // Old screens: Sun–Thu served, no control to plan other dates until it ended.
    await nextWeek(page)
    await addOn(page, day(7), 'Pesto Pasta')
    await shot(page, ctx, 'next-sunday-planned')
    expect(mealsOn(ctx, day(7)).map((m) => m.name)).toEqual(['Pesto Pasta'])
    expect(ctx.db.tables.week_confirmations).toHaveLength(0) // nothing had to be confirmed first
    expect(dbErrors(ctx)).toEqual([])
  })

  test('2 · confirming next week on Wednesday leaves Thu–Sat of this week plannable (finding 2)', async ({ page }) => {
    const ctx = await setup(page, '2-plan-ahead', {
      start: day(3),
      seed: {
        planned_meals: [
          ...mealsFrom(SUN, ['Chicken Tacos', 'Veggie Curry', 'Turkey Chili']),
          ...mealsFrom(day(7), ['Pesto Pasta', 'Beef Stir Fry']),
        ],
      },
    })
    await nextWeek(page)
    await confirmWeek(page)
    await shot(page, ctx, 'next-week-confirmed')
    await previousWeek(page)
    await addOn(page, day(4), 'Lemon Chicken') // Thursday of THIS week
    await shot(page, ctx, 'thursday-still-plannable')
    expect(mealsOn(ctx, day(4)).map((m) => m.name)).toEqual(['Lemon Chicken'])
    // Next week's plan is untouched (old screens: the escape was "Reset", which deleted it).
    expect(mealsOn(ctx, day(7)).map((m) => m.name)).toEqual(['Pesto Pasta'])
    expect(ctx.db.tables.week_confirmations.map((w) => w.starts_on)).toEqual([day(7)])
    expect(dbErrors(ctx)).toEqual([])
  })

  test('3 · ✨ suggest works in week 3, and after weeks away (finding 3)', async ({ page }) => {
    const ctx = await setup(page, '3-suggest-later', {
      start: day(15),
      seed: {
        planned_meals: [
          ...mealsFrom(SUN, ['Chicken Tacos', 'Veggie Curry'], { cooked: true }),
          ...mealsFrom(day(7), ['Pesto Pasta', 'Beef Stir Fry'], { cooked: true }),
        ],
      },
    })
    // Week 3, Monday: old screens opened locked (no strip, Regenerate disabled).
    await expect(page.getByRole('button', { name: 'Suggest the empty days' })).toBeEnabled()
    await dayCard(page, day(16)).getByRole('button', { name: '✨ suggest' }).click()
    await dayCard(page, day(16)).getByRole('button', { name: /^Keep / }).click()
    await expect(dayCard(page, day(16)).getByRole('button', { name: /^Remove / })).toBeVisible()
    await shot(page, ctx, 'week3-suggestion-kept')
    expect(mealsOn(ctx, day(16))).toHaveLength(1)

    // Five weeks later (she was away): no "lock in the old week" step first.
    await goToDay(page, ctx, day(50))
    await shot(page, ctx, 'back-after-weeks-away')
    await page.getByRole('button', { name: 'Suggest the empty days' }).click()
    await expect(page.getByRole('button', { name: /^Keep / }).first()).toBeVisible()
    await shot(page, ctx, 'suggestions-after-away')
    expect(dbErrors(ctx)).toEqual([])
  })

  test('4 · a week with nothing cooked stays as it was; nothing moves or vanishes (finding 4)', async ({ page }) => {
    const week1 = ['Chicken Tacos', 'Veggie Curry', 'Turkey Chili', 'Pesto Pasta', 'Beef Stir Fry']
    const ctx = await setup(page, '4-nothing-cooked', { seed: { planned_meals: mealsFrom(SUN, week1) } })
    await confirmWeek(page)
    await shot(page, ctx, 'week1-confirmed')

    // Next Monday, nothing was ticked cooked all week.
    await goToDay(page, ctx, day(8))
    await shot(page, ctx, 'week2-monday')
    // Old screens: "Lock in as-is" moved all five forward — week 2 was a copy of week 1.
    for (let d = 7; d <= 13; d++) expect(mealsOn(ctx, day(d))).toHaveLength(0)
    // …and week 1's history had 0 meals. Here every one is still on its own day.
    for (let i = 0; i < 5; i++) expect(mealsOn(ctx, day(i)).map((m) => m.name)).toEqual([week1[i]])

    // She is told what she didn't get to, and can put one back on a day.
    const tray = page.getByRole('region', { name: "Didn't get to these" })
    await expect(tray).toContainText('5')
    await tray.getByRole('button', { name: /Didn.t get to these/ }).click()
    await shot(page, ctx, 'didnt-get-to-these')

    await previousWeek(page)
    for (let i = 0; i < 5; i++) await expect(dayCard(page, day(i))).toContainText(week1[i])
    await shot(page, ctx, 'week1-history-intact')
    expect(dbErrors(ctx)).toEqual([])
  })
})

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    fs.mkdirSync(OUT, { recursive: true })
    await page.screenshot({ path: path.join(OUT, `${info.title.slice(0, 1)}-FAILED.png`), fullPage: true }).catch(() => {})
  }
})

