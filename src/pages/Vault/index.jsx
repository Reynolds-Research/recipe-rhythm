/**
 * Vault page — the recipe library. Composes the data layer (useVault) with
 * the form (RecipeForm) and the list (RecipeCard). Owns top-level UI state
 * like which recipe is expanded / being edited and the show/hide of the add
 * form.
 *
 * Decomposed from a single 999-line Vault.jsx in PRD-001 P0.9 (Phase 3
 * Step 2). The page-level component (default export) preserves the existing
 * `import Vault from '../pages/Vault'` import path used by App.jsx and the
 * test suite.
 */

// implementation moves in a later commit — for now, re-export the legacy
// monolith so the public surface keeps working through the scaffold step.
export { default } from '../Vault.jsx'
