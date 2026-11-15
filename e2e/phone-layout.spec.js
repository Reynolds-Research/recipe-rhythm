import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { installFakeSupabase, signIn, ymd, addDaysYmd, HOUSEHOLD, HER } from './support/fakeSupabase.js'

// Nothing on the Prep Table or its grocery sheet may be wider than the phone.
// Found 2026-11-15 from her screenshots (iPhone): the sheet ran off the right
// edge — amounts cut to "1 h" / "1 bu", the close button half off, and the
// page behind (the "+" by "Your night") clipped too. One element wider than
// the screen makes iOS widen the whole page, sheet included.
//
// The week is shaped like hers that day: four dinners, Wednesday her night,
// Penne alla Vodka + "Italian sausage", and her real list's long
// "Recipes use …" lines. Screenshots go to e2e-results/phone-layout/.
//
// This passed even before the fix: the cause on her phone was iPhone zooming
// into the 14px add-on box (Chromium doesn't do that). That is guarded by the
// unit test "the add-on box uses 16px text on phones"; this one guards real
// width overflow at phone size.

const OUT = path.join('e2e-results', 'phone-layout')
const today = ymd(new Date())
const sunday = addDaysYmd(today, -new Date().getDay())
const day = (n) => addDaysYmd(sunday, n)
const LIST = 'list-1'

const VAULT = [
  ['v-meat', 'Scallion Meatballs'],
  ['v-salmon', 'Old Bay Salmon Burgers with Sweet Potatoes and Veggies'],
  ['v-tacos', 'Shrimp Tacos'],
  ['v-penne', 'Penne alla Vodka'],
].map(([id, name]) => ({
  id, user_id: HER.id, household_id: HOUSEHOLD, name, servings: 4, ingredients_source: 'screenshot',
  ingredients_structured: [{ name: name.split(' ')[0].toLowerCase(), quantity: '1', unit: 'lb' }],
  cuisine_type: 'American', flavor_profile: [], proteins: [], cooking_method: [], main_carb: null,
  vegetables: [], dairy_components: [], fruits: [], family_rating: 4, prep_time_minutes: 30,
  ingredients_classified: null, ingredients: [], deleted_at: null, created_at: '2026-01-01T00:00:00Z',
}))

const meal = (id, n, vaultId, name, addOn = null) => ({
  id, household_id: HOUSEHOLD, planned_on: day(n), position: 0, name, vault_id: vaultId, add_on: addOn,
  is_wildcard: false, source_url: null, cooked: false, cooked_at: null, assigned_to: null, assigned_at: null,
  user_id: HER.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
})

// Her real list from that day (prod, read-only), long lines included.
const items = [
  ['ginger', '1 piece (4 oz)', '¼ cup peeled chopped', 'Produce'], ['scallions', '1 bunch', '4 large or 6 small', 'Produce'],
  ['cilantro', '1 bunch', '½ cup plus chopped for garnish', 'Produce'], ['sweet potatoes', '2 lb', 'cubed or sliced', 'Produce'],
  ['mixed vegetables', '2 lb', 'assorted chopped', 'Produce'], ['avocado', '2', '2 sliced or mashed', 'Produce'],
  ['lime', '2', '2 juiced plus wedges for serving', 'Produce'], ['red cabbage', '1 head', '1 cup shredded', 'Produce'],
  ['fresh basil', '1 bunch', 'sliced thin, optional to taste', 'Produce'], ['ground turkey', '1 lb', '1 lb', 'Meat & Seafood'],
  ['salmon fillet', '1¼ lb', '1 lb', 'Meat & Seafood'], ['shrimp', '1 lb', '1 lb peeled and deveined', 'Meat & Seafood'],
  ['parmesan cheese', '1 block (4 oz)', 'optional to taste', 'Dairy'], ['heavy cream', '1 pint', '¾ cup', 'Dairy'],
  ['corn tortillas', '1 pack', '8 small', 'Bakery'], ['tomato paste', '1 can (6 oz)', '¼ cup', 'Pantry'],
  ['vegetable oil', '1 bottle', 'enough to generously cover bottom of pan', 'Pantry', true],
  ['black pepper', '1 container', 'several grindings plus to taste', 'Pantry', true],
].map(([name, quantity, recipe_quantity, section, assumed = false], i) => ({
  id: `item-${i}`, list_id: LIST, name, quantity, recipe_quantity, section, assumed,
  is_bought: false, is_adhoc: false, created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
}))

const seed = {
  vault: VAULT,
  planned_meals: [
    meal('pm-1', 0, 'v-meat', 'Scallion Meatballs'),
    meal('pm-2', 1, 'v-salmon', 'Old Bay Salmon with Sweet Potatoes and Veggies'),
    meal('pm-3', 2, 'v-tacos', 'Shrimp Tacos'),
    meal('pm-4', 3, 'v-penne', 'Penne alla Vodka', 'Italian sausage'),
  ],
  cook_nights: [{ id: 'cn-1', household_id: HOUSEHOLD, cooks_on: day(3), cook_id: HER.id, user_id: HER.id,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
  week_days: [],
  week_confirmations: [{
    id: 'wc-1', household_id: HOUSEHOLD, starts_on: sunday, ends_on: day(6),
    user_id: HER.id, confirmed_at: new Date().toISOString(), changed_at: null, grocery_list_id: LIST,
  }],
  grocery_lists: [{ id: LIST, household_id: HOUSEHOLD, user_id: HER.id }],
  grocery_list_items: items,
}

/** Elements whose right edge is past the screen (ignoring ones clipped by an overflow-hidden parent). */
function overflowing() {
  const w = document.documentElement.clientWidth
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= w + 1) continue
    out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → right ${Math.round(r.right)} (width ${Math.round(r.width)})`)
  }
  return { viewport: w, pageWidth: document.documentElement.scrollWidth, offenders: out.slice(0, 15) }
}

test.describe('Phone layout: nothing wider than the screen', () => {
  // iPhone 13/14 width (her phone's class): 390 css px.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Prep Table week and its grocery sheet fit a 390 px phone', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true })
    await installFakeSupabase(page, { now: () => new Date(), seed })
    await page.goto('/')
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Prep Table/ }).first().click()
    await expect(page.getByText('Penne alla Vodka').first()).toBeVisible()
    await page.screenshot({ path: path.join(OUT, '1-week.png'), fullPage: true })
    const week = await page.evaluate(overflowing)
    console.log('WEEK', JSON.stringify(week, null, 1))

    await page.getByRole('button', { name: /Grocery list/ }).click()
    const sheet = page.getByTestId('grocery-sheet')
    await expect(sheet.getByText('Ginger')).toBeVisible()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(OUT, '2-sheet.png') })
    const withSheet = await page.evaluate(overflowing)
    console.log('SHEET', JSON.stringify(withSheet, null, 1))

    expect(week.pageWidth, 'the week page is wider than the phone').toBeLessThanOrEqual(week.viewport)
    expect(withSheet.pageWidth, 'the page with the sheet open is wider than the phone').toBeLessThanOrEqual(withSheet.viewport)
    // Every amount on the list is fully on screen.
    for (const q of ['1 piece (4 oz)', '1 bunch', '2 lb', '1 can (6 oz)']) {
      const box = await sheet.getByText(q, { exact: true }).first().boundingBox()
      expect(box.x + box.width, `"${q}" runs off the right edge`).toBeLessThanOrEqual(390)
    }
  })
})
