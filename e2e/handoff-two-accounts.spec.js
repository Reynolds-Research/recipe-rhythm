/* global process */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  installFakeSupabase, signIn, SEED_VAULT, HER, MATT,
} from './support/fakeSupabase.js'

/**
 * Matt's nights, end to end with TWO accounts (PRD-008 phase 3c). Two browser
 * contexts are two phones; they share one fake database, each signed in as
 * its own person, the way the real household shares one kitchen:
 *
 *   her phone   hands Tuesday to Matt
 *   his phone   sees "Your night · Pick something", keeps the ready suggestion
 *   her phone   sees "Matt picked this", confirms the week
 *               → the grocery list is made from the week, his pick included
 *
 * Run it with the switch on:
 *   VITE_NEW_PREP_TABLE=true npx playwright test e2e/handoff-two-accounts.spec.js
 *
 * A screenshot per step goes to e2e-results/handoff/<scenario>/.
 * Simulated day: Monday 2026-11-02 (week Sun Nov 1 – Sat Nov 7).
 */

test.skip(process.env.VITE_NEW_PREP_TABLE !== 'true', 'needs VITE_NEW_PREP_TABLE=true')

const OUT = path.join('e2e-results', 'handoff')
const MON = '2026-11-02'
const TUE = '2026-11-03'
const NOW = new Date(2026, 10, 2, 10) // Mon Nov 2, 10:00 local

// Every seed recipe gets a short ingredient list, so the grocery list has
// something to read (a recipe with no list is left off).
const VAULT = SEED_VAULT.map((r) => ({
  ...r,
  servings: 4,
  ingredients_source: 'screenshot',
  ingredients_structured: [{ name: r.name.split(' ')[0].toLowerCase(), quantity: '1', unit: 'lb' }],
}))
const MEMBERS = [
  { user_id: HER.id, display_name: 'Sara' },
  { user_id: MATT.id, display_name: 'Matt' },
]
// Her Monday is already planned.
const HER_MONDAY = {
  id: 'seed-mon', user_id: HER.id, planned_on: MON, position: 0, name: 'Chicken Tacos',
  vault_id: VAULT.find((v) => v.name === 'Chicken Tacos').id, is_wildcard: false, source_url: null,
  cooked: false, cooked_at: null, assigned_to: null, assigned_at: null,
  created_at: `${MON}T08:00:00Z`, updated_at: `${MON}T08:00:00Z`,
}

/** Two phones on one household. Returns { her, matt, db }. */
async function twoPhones(browser) {
  const herCtx = await browser.newContext()
  const mattCtx = await browser.newContext()
  const her = await herCtx.newPage()
  const matt = await mattCtx.newPage()
  const db = await installFakeSupabase(her, {
    now: () => NOW, user: HER, members: MEMBERS,
    seed: { vault: VAULT, planned_meals: [HER_MONDAY] },
  })
  await installFakeSupabase(matt, { db, user: MATT })
  for (const [page, user] of [[her, HER], [matt, MATT]]) {
    await page.clock.setFixedTime(NOW)
    await page.goto('/')
    await signIn(page, user)
  }
  return { her, matt, db, close: () => Promise.all([herCtx.close(), mattCtx.close()]) }
}

async function openPrepTable(page) {
  await page.reload()
  await page.getByRole('button', { name: 'Prep Table' }).click()
  await expect(page.getByTestId('week-title')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('status', { name: 'Loading the week' })).toHaveCount(0, { timeout: 15000 })
}

const dayCard = (page, isoYmd) => page.locator(`section[data-date="${isoYmd}"]`)
const dbErrors = (db) => db.log.filter((l) => l.error)

function shooter(id) {
  fs.mkdirSync(path.join(OUT, id), { recursive: true })
  let n = 0
  return (page, label) => {
    n += 1
    return page.screenshot({ path: path.join(OUT, id, `${String(n).padStart(2, '0')}-${label}.png`), fullPage: true })
  }
}

/** Her phone: hand Tuesday to Matt. */
async function handTuesdayToMatt(her, db) {
  await openPrepTable(her)
  await dayCard(her, TUE).getByRole('button', { name: 'Give to Matt: Tue', exact: true }).click()
  await expect(dayCard(her, TUE).getByRole('button', { name: "Matt's night on Tue. Tap to take it back" })).toBeVisible()
  await expect(dayCard(her, TUE)).toContainText('Matt’s picking')
  expect(db.tables.cook_nights).toEqual([
    expect.objectContaining({ cooks_on: TUE, cook_id: MATT.id, user_id: HER.id }),
  ])
}

test.describe('Matt\'s nights — two accounts, one household', () => {
  test('she hands a night over, he picks, she confirms, the grocery list includes his pick', async ({ browser }) => {
    const shot = shooter('1-full-handoff')
    const { her, matt, db, close } = await twoPhones(browser)

    // 1. Her phone: Tuesday is Matt's.
    await handTuesdayToMatt(her, db)
    await shot(her, 'her-hands-tuesday-over')

    // 2. His phone: "Your night · Pick something", one suggestion ready.
    await openPrepTable(matt)
    await expect(matt.getByRole('region', { name: 'Your nights to pick' })).toContainText('1 night to pick this week: Tue.')
    const tue = dayCard(matt, TUE)
    await expect(tue.getByRole('button', { name: 'Your night on Tue. Tap to take it back' })).toBeVisible()
    await expect(tue).toContainText('Pick something')
    await expect(tue).toContainText('Suggestion · not saved yet')
    await shot(matt, 'his-night-with-a-suggestion')
    const keep = tue.getByRole('button', { name: /^Keep / })
    const picked = (await keep.getAttribute('aria-label')).replace(/^Keep /, '')
    expect(picked).not.toBe('Chicken Tacos') // never repeats a meal already in the week
    await keep.click()
    await expect(tue).toContainText(picked)
    await expect(matt.getByRole('region', { name: 'Your nights to pick' })).toHaveCount(0)
    expect(db.tables.planned_meals.filter((m) => m.planned_on === TUE)).toEqual([
      expect.objectContaining({ name: picked, user_id: MATT.id }),
    ])
    await shot(matt, 'his-pick-saved')

    // 3. Her phone: she sees his pick, then confirms the week.
    await openPrepTable(her)
    await expect(dayCard(her, TUE)).toContainText(picked)
    await expect(dayCard(her, TUE)).toContainText('Matt picked this')

    let groceryRequest = null
    await her.route('**/api/grocery-list', async (route) => {
      groceryRequest = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [
          { name: 'chicken', quantity: '1 lb', recipe_quantity: '1 lb', section: 'Meat & Seafood', assumed: false },
          { name: picked.split(' ')[0].toLowerCase(), quantity: '1 lb', recipe_quantity: '1 lb', section: 'Produce', assumed: false },
        ] }),
      })
    })
    await her.getByRole('button', { name: 'Confirm the week' }).click()
    const ask = her.getByRole('region', { name: 'Confirm the week' })
    await expect(ask).toContainText('have no meal yet') // Wed and Thu are still empty: told, not blocked
    await ask.getByRole('button', { name: 'Confirm anyway' }).click()
    await expect(her.getByRole('region', { name: 'Week confirmed' })).toBeVisible({ timeout: 15000 })
    await shot(her, 'her-week-confirmed')

    // The list was made from the week: her Monday and his Tuesday.
    expect(groceryRequest.recipes.map((r) => r.name).sort()).toEqual(['Chicken Tacos', picked].sort())
    expect(db.tables.week_confirmations).toEqual([expect.objectContaining({ starts_on: '2026-11-01', user_id: HER.id })])
    const listId = db.tables.week_confirmations[0].grocery_list_id
    expect(listId).toBeTruthy()
    expect(db.tables.grocery_list_items.filter((i) => i.list_id === listId)).toHaveLength(2)

    expect(dbErrors(db)).toEqual([])
    await close()
  })

  test('confirming before he picks names his night and offers to wait', async ({ browser }) => {
    const shot = shooter('2-confirm-before-he-picks')
    const { her, db, close } = await twoPhones(browser)
    await handTuesdayToMatt(her, db)
    await her.getByRole('button', { name: 'Confirm the week' }).click()
    const ask = her.getByRole('region', { name: 'Confirm the week' })
    await expect(ask).toContainText('Tue Nov 3 is Matt’s night. Nothing picked yet.')
    await expect(ask.getByRole('button', { name: 'Wait for Matt' })).toBeVisible()
    await shot(her, 'confirm-names-his-night')
    await ask.getByRole('button', { name: 'Wait for Matt' }).click()
    await expect(her.getByRole('button', { name: 'Confirm the week' })).toBeVisible()
    expect(db.tables.week_confirmations).toHaveLength(0) // waiting confirms nothing
    expect(dbErrors(db)).toEqual([])
    await close()
  })

  test('she takes the night back: it\'s an ordinary night on both phones', async ({ browser }) => {
    const shot = shooter('3-take-back')
    const { her, matt, db, close } = await twoPhones(browser)
    await handTuesdayToMatt(her, db)
    await dayCard(her, TUE).getByRole('button', { name: "Matt's night on Tue. Tap to take it back" }).click()
    await expect(dayCard(her, TUE).getByRole('button', { name: 'Give to Matt: Tue', exact: true })).toBeVisible()
    expect(db.tables.cook_nights).toEqual([])
    await openPrepTable(matt)
    await expect(dayCard(matt, TUE)).not.toContainText('Your night')
    await expect(matt.getByRole('region', { name: 'Your nights to pick' })).toHaveCount(0)
    await shot(matt, 'his-phone-no-night')
    expect(dbErrors(db)).toEqual([])
    await close()
  })
})
