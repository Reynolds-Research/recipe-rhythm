import { test, expect } from '@playwright/test';

test.describe('Brainstorm E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/rest/v1/vault*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: '1', name: 'Mock Recipe' }]) 
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

  test('can navigate to Prep Table and regenerate plan', async ({ page }) => {
    await page.getByRole('button', { name: 'Prep Table' }).click();

    await expect(page.getByText('Building your plan…')).not.toBeVisible();
    await expect(page.getByText('YOUR MEAL PLAN')).toBeVisible();

    // Check that we can see a recipe (mock recipe)
    await expect(page.getByText('Mock Recipe')).toBeVisible();

    // Regenerate
    await page.getByRole('button', { name: /Regenerate/i }).click();

    // Should continue showing the table securely
    await expect(page.getByText('YOUR MEAL PLAN')).toBeVisible();
  });
});
