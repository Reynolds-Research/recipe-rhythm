/**
 * PRD-008: the app asks "which household am I in?" once per account
 * (src/lib/household.js) before scoping its queries. Specs that answer
 * Supabase with canned responses call this so that lookup succeeds.
 * (The stateful fakeSupabase.js answers it itself.)
 */
export const TEST_HOUSEHOLD_ID = 'test-household'

export async function mockHousehold(page, householdId = TEST_HOUSEHOLD_ID) {
  await page.route('**/rest/v1/household_members*', (route) => {
    const wantsObject = (route.request().headers().accept || '').includes('vnd.pgrst.object')
    const row = { household_id: householdId }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(wantsObject ? row : [row]),
    })
  })
}
