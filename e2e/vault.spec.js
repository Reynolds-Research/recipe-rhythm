import { test, expect } from '@playwright/test';

test.describe('Vault E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept Supabase API calls
    await page.route('**/rest/v1/vault*', async (route) => {
      const isGet = route.request().method() === 'GET';
      const isUniqueCheck = route.request().url().includes('ilike');
      
      if (isGet && isUniqueCheck) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      } else if (isGet) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: '1', name: 'Mock Vault Recipe', cuisine_type: 'American', created_at: new Date().toISOString() }
          ])
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({ 
          status: 201, 
          contentType: 'application/json',
          body: JSON.stringify([{ id: '2', name: 'Playwright Test Recipe' }]) 
        });
      } else {
        await route.continue();
      }
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

  test('can navigate to Vault and add a recipe', async ({ page }) => {
    // Navigate using the bottom nav
    await page.getByRole('button', { name: 'Cookbook' }).click();

    // Verify mock load
    await expect(page.getByText('Loading vault…')).not.toBeVisible();
    await expect(page.getByText('Mock Vault Recipe')).toBeVisible();

    // Click Add — use aria-label, not CSS class (design-system @apply classes
    // don't appear as individual utility classes in the rendered HTML)
    await page.getByRole('button', { name: 'Add a new recipe' }).click();

    await expect(page.getByText('Add a new recipe')).toBeVisible();
    
    // Fill in name
    await page.getByPlaceholder('Recipe name').fill('Playwright Test Recipe');
    
    // Save
    await page.getByRole('button', { name: 'Save to vault' }).click();

    // Form should hide
    await expect(page.getByText('Add a new recipe')).not.toBeVisible();
  });
});
