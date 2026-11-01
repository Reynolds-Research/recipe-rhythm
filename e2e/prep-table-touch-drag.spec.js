import { test, expect } from '@playwright/test';

// Guards the phone drag on Prep Table. PointerSensor used to claim touch
// presses, the browser cancelled them as a scroll, and press-and-hold-to-drag
// never started on a real phone. This drives real touch events via CDP.
test.describe('Prep Table touch drag', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test.beforeEach(async ({ page }) => {
    await page.route('**/rest/v1/vault*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['Chicken tacos','Lentil soup','Salmon bowls','Veggie stir fry','Pasta bake'].map((name,i)=>({ id: String(i+1), name }))) 
      });
    });

    await page.route('**/rest/v1/meals*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    // ADR-001 Phase 2+ added reads against meal_plans / meal_plan_items, and
    // Phase 5 added a fetchCurrentLeftovers call. Without these mocks the
    // BrainstormMode page hangs on its initial data load against the dummy
    // Supabase URL and never exits the "Building your plan…" state.
    await page.route('**/rest/v1/meal_plans*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.route('**/rest/v1/meal_plan_items*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.route('**/rest/v1/current_leftovers*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    // household_preferences has no row for the test user. Mirror real
    // PostgREST: .single() on zero rows returns 406 / PGRST116, which
    // getPreferences() maps to defaults. Leaving this unmocked used to fail
    // fast, but supabase-js >= 2.118 retries network errors (1s+2s+4s),
    // which pushes the page past the 5s assertion timeout.
    await page.route('**/rest/v1/household_preferences*', async (route) => {
      await route.fulfill({
        status: 406,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'PGRST116',
          details: 'The result contains 0 rows',
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
      });
    });

    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'test-user', email: 'test@example.com' }
      }));
    });
    
    await page.route('**/auth/v1/user*', async route => {
      await route.fulfill({ json: { id: 'test-user', email: 'test@example.com' } });
    });
    
    await page.reload();
  });

  test('press-and-hold on a meal moves it to another day', async ({ page }) => {
    await page.getByRole('button', { name: 'Prep Table' }).click();
    await expect(page.getByText('YOUR MEAL PLAN')).toBeVisible();

    const handles = page.getByLabel(/to another day$/);
    await expect(handles).toHaveCount(5);
    const order = () => handles.evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    const before = await order();

    await handles.nth(1).evaluate(e => e.scrollIntoView({ block: 'center' }));
    const from = await handles.nth(0).locator('xpath=..').boundingBox();
    const to = await handles.nth(1).locator('xpath=..').boundingBox();

    // Start on the meal name, not the grip: the whole card is the handle.
    const x = from.x + from.width * 0.6;
    const y0 = from.y + from.height / 2;
    const y1 = to.y + to.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    await page.waitForTimeout(400); // hold past TouchSensor's 250ms delay
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 12 }] });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect.poll(order).toEqual([before[1], before[0], ...before.slice(2)]);
  });
});
