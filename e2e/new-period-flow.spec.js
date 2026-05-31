import { test, expect } from '@playwright/test';

/**
 * ADR-001 Phase 5 E2E: gap-day view → date picker → leftover picker → commit.
 *
 * We stub Supabase REST + the `current_leftovers` view at the network layer,
 * mirroring the mock pattern used in `brainstorm.spec.js`. The seed state is:
 *   - A finalized past-end meal_plan (2026-04-12 → 2026-04-18, finalized)
 *   - Two uncooked leftover rows surfaced by current_leftovers
 *
 * The test walks the full flow and then asserts that the resulting INSERT +
 * UPDATE calls to `meal_plans` and `meal_plan_items` were issued with the
 * expected payloads (the DB's result shape is out of scope — we test the
 * client-observable effects).
 */

const FINALIZED_PLAN = {
  id: 'plan-old',
  user_id: 'test-user',
  period_start: '2026-04-12',
  period_end: '2026-04-18',
  finalized_at: '2026-04-18T20:00:00Z',
  served_at: '2026-04-12T10:00:00Z',
  days: null,
  items: null,
  week_label: null,
};

const LEFTOVERS = [
  {
    id: 'leftover-1',
    user_id: 'test-user',
    meal_plan_id: 'plan-old',
    scheduled_date: '2026-04-13',
    position: 0,
    vault_id: 'vault-pancakes',
    name: 'Pancakes',
    is_wildcard: false,
    source_url: null,
    cooked: false,
    cooked_at: null,
    created_at: '2026-04-12T00:00:00Z',
    source_period_start: '2026-04-12',
    source_period_end: '2026-04-18',
    source_finalized_at: '2026-04-18T20:00:00Z',
  },
  {
    id: 'leftover-2',
    user_id: 'test-user',
    meal_plan_id: 'plan-old',
    scheduled_date: '2026-04-15',
    position: 0,
    vault_id: 'vault-tacos',
    name: 'Tacos',
    is_wildcard: false,
    source_url: null,
    cooked: false,
    cooked_at: null,
    created_at: '2026-04-12T00:00:00Z',
    source_period_start: '2026-04-12',
    source_period_end: '2026-04-18',
    source_finalized_at: '2026-04-18T20:00:00Z',
  },
];

test.describe('New period flow (ADR-001 Phase 5)', () => {
  test.beforeEach(async ({ page }) => {
    // Capture observed requests for post-flow assertions.
    const captured = {
      plansInsert: null,
      itemUpdates: [],
    };
    page.captured = captured;

    await page.route('**/rest/v1/vault*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'vault-pancakes', name: 'Pancakes' }]),
      });
    });

    await page.route('**/rest/v1/meals*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/rest/v1/meal_plans*', async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === 'GET') {
        // Could be the initial fetchMostRecentPlan OR the checkPeriodOverlap.
        // Both return the same finalized plan row; for overlap the range is
        // 2026-04-12..2026-04-18 — the E2E picks 2026-05-03..2026-05-07 so
        // the overlap check returns false (non-overlapping).
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([FINALIZED_PLAN]),
        });
        return;
      }
      if (method === 'POST') {
        // startNewPeriod insert. Capture and respond with a new id.
        // `.select().single()` asks PostgREST for the inserted row as a
        // bare object (via the `Accept: application/vnd.pgrst.object+json`
        // header). Return a single object, not an array.
        captured.plansInsert = JSON.parse(req.postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/vnd.pgrst.object+json',
          body: JSON.stringify({
            id: 'plan-new',
            period_start: captured.plansInsert.period_start,
            period_end: captured.plansInsert.period_end,
          }),
        });
        return;
      }
      if (method === 'DELETE') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fulfill({ status: 200, body: '[]' });
    });

    await page.route('**/rest/v1/meal_plan_items*', async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }
      if (method === 'PATCH') {
        captured.itemUpdates.push({
          body: JSON.parse(req.postData() || '{}'),
          url: req.url(),
        });
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fulfill({ status: 200, body: '[]' });
    });

    await page.route('**/rest/v1/current_leftovers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LEFTOVERS),
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
        user: { id: 'test-user', email: 'test@example.com' },
      }));
    });

    await page.route('**/auth/v1/user*', async (route) => {
      await route.fulfill({ json: { id: 'test-user', email: 'test@example.com' } });
    });

    await page.reload();
  });

  test('gap-day → date picker → leftover picker → commits with roll-forward', async ({ page }) => {
    await page.getByRole('button', { name: 'Prep Table' }).click();

    // Gap-day view shows the two leftovers
    await expect(page.getByText(/Your last period ended/i)).toBeVisible();
    await expect(page.getByText('Pancakes')).toBeVisible();
    await expect(page.getByText('Tacos')).toBeVisible();

    // Click the CTA → date range picker opens
    await page.getByTestId('start-new-period-btn').click();
    await expect(page.getByTestId('date-range-picker')).toBeVisible();

    // Navigate to May 2026. We don't know today's date in CI, so walk month
    // arrows until we see the May cells (a bounded loop; 24 iterations is
    // always enough).
    for (let i = 0; i < 24; i++) {
      if (await page.getByTestId('calendar-day-2026-05-03').count()) {
        const cell = page.getByTestId('calendar-day-2026-05-03');
        if ((await cell.getAttribute('data-in-month')) === 'true') break;
      }
      await page.getByRole('button', { name: /next month/i }).click();
    }

    await page.getByTestId('calendar-day-2026-05-03').click();
    await page.getByTestId('calendar-day-2026-05-07').click();

    // Overlap check is debounced 300ms. Wait for the confirm button to enable.
    await expect(page.getByTestId('picker-confirm')).toBeEnabled();
    await page.getByTestId('picker-confirm').click();

    // Leftover picker shows both leftovers, both pre-checked
    await expect(page.getByTestId('leftover-picker')).toBeVisible();
    const rows = page.getByTestId('leftover-row');
    await expect(rows).toHaveCount(2);

    // Uncheck "Tacos" by clicking its label, scoped to the modal so the
    // background gap-day view's copy of "Tacos" doesn't cause a strict-mode
    // match collision.
    await page.getByTestId('leftover-picker').getByText('Tacos').click();

    // Counter reflects 1 selected
    await expect(page.getByTestId('leftover-counter')).toContainText('1 selected');

    await page.getByTestId('leftover-confirm').click();

    // Verify the observed writes: one meal_plans insert and one meal_plan_items update.
    await expect.poll(() => page.captured.plansInsert).not.toBeNull();
    expect(page.captured.plansInsert).toMatchObject({
      user_id: 'test-user',
      period_start: '2026-05-03',
      period_end: '2026-05-07',
    });

    await expect.poll(() => page.captured.itemUpdates.length).toBe(1);
    const update = page.captured.itemUpdates[0];
    expect(update.body).toMatchObject({
      meal_plan_id: 'plan-new',
      scheduled_date: '2026-05-03',
    });
    expect(update.url).toContain('id=eq.leftover-1');
  });

  // Regression test for PR #135 (commit c9c96d4): the `current_leftovers`
  // view predates PRD-002 P0.6 and historically leaked shortlisted rows
  // (which have `scheduled_date = NULL`) into the leftovers payload. The
  // LeftoverPicker tried to format a null date and crashed; the global
  // ErrorBoundary then surfaced "Something went wrong" right after the
  // user confirmed dates. Migration 20260530000002 fixed the view, and
  // fetchCurrentLeftovers added a defense-in-depth filter. This test
  // simulates a stale view (re-)leaking a null-date row and asserts that:
  //   (1) the LeftoverPicker still renders without crashing,
  //   (2) only the rows WITH a real scheduled_date are visible, and
  //   (3) the ErrorBoundary's fallback copy never appears.
  // If this fails, the app-layer guard in `fetchCurrentLeftovers` regressed
  // — even if the DB view is healthy, that filter is the seatbelt and must
  // hold on its own.
  test('shortlist leak (null scheduled_date) does NOT crash the picker', async ({ page }) => {
    // Override the leftovers route to return a payload that contains the
    // legacy good row PLUS a leaked shortlist row with scheduled_date = null.
    // Playwright's last-registered handler wins, so this supersedes the
    // beforeEach LEFTOVERS fixture for this test only.
    const LEAKY_LEFTOVERS = [
      {
        ...LEFTOVERS[0], // Pancakes, scheduled 2026-04-13 — valid
      },
      {
        id: 'leftover-shortlist',
        user_id: 'test-user',
        meal_plan_id: 'plan-old',
        scheduled_date: null, // the crash trigger
        position: 0,
        vault_id: 'vault-mystery',
        name: 'Cheese Tuna Orzo',
        is_wildcard: false,
        source_url: null,
        cooked: false,
        cooked_at: null,
        created_at: '2026-04-12T00:00:00Z',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
        source_finalized_at: '2026-04-18T20:00:00Z',
      },
    ];
    await page.route('**/rest/v1/current_leftovers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LEAKY_LEFTOVERS),
      });
    });

    // Walk to gap-day → start new period → confirm a non-overlapping range.
    await page.getByRole('button', { name: 'Prep Table' }).click();
    await expect(page.getByText(/Your last period ended/i)).toBeVisible();
    await page.getByTestId('start-new-period-btn').click();
    await expect(page.getByTestId('date-range-picker')).toBeVisible();

    for (let i = 0; i < 24; i++) {
      if (await page.getByTestId('calendar-day-2026-05-03').count()) {
        const cell = page.getByTestId('calendar-day-2026-05-03');
        if ((await cell.getAttribute('data-in-month')) === 'true') break;
      }
      await page.getByRole('button', { name: /next month/i }).click();
    }
    await page.getByTestId('calendar-day-2026-05-03').click();
    await page.getByTestId('calendar-day-2026-05-07').click();
    await expect(page.getByTestId('picker-confirm')).toBeEnabled();
    await page.getByTestId('picker-confirm').click();

    // (1) LeftoverPicker renders — does not throw.
    await expect(page.getByTestId('leftover-picker')).toBeVisible();

    // (2) Only the row with a real scheduled_date is surfaced. The shortlist
    //     leak with scheduled_date=null was filtered out by fetchCurrentLeftovers.
    const rows = page.getByTestId('leftover-row');
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByTestId('leftover-picker').getByText('Pancakes'),
    ).toBeVisible();
    await expect(
      page.getByTestId('leftover-picker').getByText('Cheese Tuna Orzo'),
    ).not.toBeVisible();

    // (3) The global ErrorBoundary fallback never appears. If this assertion
    //     fails, the filter in fetchCurrentLeftovers regressed and the next
    //     LeftoverPicker render crashed.
    await expect(page.getByText(/Something went wrong/i)).not.toBeVisible();
  });
});
