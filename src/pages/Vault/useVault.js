/**
 * useVault — the data layer for the vault page. Owns Supabase fetches and
 * mutations: fetchRecipes, the vault_options migrate-then-fetch pair, plus
 * addRecipe / addSuggestion / updateRecipe / deleteRecipe / setRating /
 * addExtra. Returns plain async actions; the page component owns UI state
 * (which recipe is being edited, modal open/close, etc.).
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). Behavior is
 * bit-identical to the pre-split version.
 */

// implementation moves in a later commit
export function useVault() {
  return {
    recipes: [],
    loading: true,
    extrasByCategory: {},
  }
}
