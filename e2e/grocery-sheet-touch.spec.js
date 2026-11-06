/* global process */
import { test, expect } from '@playwright/test'
import { installFakeSupabase, signIn, ymd, addDaysYmd, HOUSEHOLD } from './support/fakeSupabase.js'

// Guards real phone taps inside the Prep Table's grocery sheet (needs the dev
// server started with VITE_NEW_PREP_TABLE=true). A real thumb moves a few
// pixels during a tap; the sheet's content is also a drag target, so a tap
// with a little movement could be taken as the start of a drag and lost.
// Drives raw touch events through CDP, like prep-table-touch-drag.spec.js.

const today = ymd(new Date())
const d = new Date()
const sunday = addDaysYmd(today, -d.getDay())

const LIST = 'list-1'
const items = [
  ['avocado', '2', '1½', 'Produce', false], ['bell pepper', '1', '1', 'Produce', false],
  ['Brussels sprouts', '1 lb', '1 lb', 'Produce', false], ['cabbage', '1 head', '1 cup shredded', 'Produce', false],
  ['cilantro', '1 bunch', null, 'Produce', false], ['lemon', '1', '1', 'Produce', false],
  ['lime', '2', '2', 'Produce', false], ['tomato', '1', '1', 'Produce', false],
  ['ground turkey', '1 lb', '1 lb', 'Meat & Seafood', false], ['shrimp', '1 lb', '1 lb', 'Meat & Seafood', false],
  ['salmon fillets', '1½ lb', '4 fillets', 'Meat & Seafood', false],
  ['soy sauce', '1 bottle', '¼ cup', 'Pantry', true], ['cumin', '1 container', '1½ tsp', 'Pantry', true],
  ['mirin', '1 bottle', '2 tbsp', 'Pantry', true], ['salt', null, 'to taste', 'Pantry', true],
].map(([name, quantity, recipe_quantity, section, assumed], i) => ({
  id: `item-${i}`, list_id: LIST, name, quantity, recipe_quantity, section, assumed,
  is_bought: false, is_adhoc: false, created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
}))

const seed = {
  planned_meals: [{
    id: 'pm-1', household_id: HOUSEHOLD, planned_on: today, position: 0, name: 'Shrimp Tacos',
    vault_id: null, is_wildcard: false, source_url: null, cooked: false, cooked_at: null,
    assigned_to: null, assigned_at: null, user_id: 'test-user', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }],
  week_days: [],
  week_confirmations: [{
    id: 'wc-1', household_id: HOUSEHOLD, starts_on: sunday, ends_on: addDaysYmd(sunday, 6),
    user_id: 'test-user', confirmed_at: new Date().toISOString(), changed_at: null, grocery_list_id: LIST,
  }],
  grocery_lists: [{ id: LIST, household_id: HOUSEHOLD, user_id: 'test-user' }],
  grocery_list_items: items,
}

/** A finger tap at the element's centre that drifts `drift` px down before lifting. */
async function fingerTap(page, locator, drift) {
  const box = await locator.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= drift; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
}

test.describe('Grocery sheet: real phone taps', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  // The new Prep Table only exists with the switch on:
  //   VITE_NEW_PREP_TABLE=true npx playwright test e2e/grocery-sheet-touch.spec.js
  test.skip(process.env.VITE_NEW_PREP_TABLE !== 'true', 'needs VITE_NEW_PREP_TABLE=true')

  async function openSheet(page) {
    await installFakeSupabase(page, { now: () => new Date(), seed })
    await page.goto('/')
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Prep Table/ }).first().click()
    await page.getByRole('button', { name: /Grocery list/ }).click()
    const sheet = page.getByTestId('grocery-sheet')
    await expect(sheet.getByRole('region', { name: 'Assumed you have' })).toBeVisible()
    await page.waitForTimeout(1500) // the sheet slides up; a tap mid-slide lands elsewhere
    return sheet
  }

  for (const drift of [0, 3, 6, 10]) {
    test(`a tap with ${drift}px of finger movement opens "Assumed you have"`, async ({ page }) => {
      const sheet = await openSheet(page)
      const toggle = sheet.getByRole('button', { name: /Assumed you have/ })
      await fingerTap(page, toggle, drift)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })
  }
})
