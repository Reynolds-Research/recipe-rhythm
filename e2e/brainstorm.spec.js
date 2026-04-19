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
