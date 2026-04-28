/**
 * Vault enum lists — single source of truth (PRD-001 P0.6).
 *
 * Every chip-picker option list and the analyze-recipe AI prompt's
 * JSON-shape block read from this module. Adding "Filipino" to
 * CUISINE_OPTIONS here updates Vault.jsx's chip picker AND the AI
 * prompt the next time the proxy starts. Don't reorder existing
 * values — the AI prompt and existing data depend on these exact
 * strings.
 */

export const CUISINE_OPTIONS = [
  'American', 'Chinese', 'French', 'Greek', 'Indian',
  'Italian', 'Japanese', 'Korean', 'Mexican', 'Middle Eastern',
  'Spanish', 'Thai', 'Vietnamese', 'Other',
]

export const FLAVOR_OPTIONS = [
  'Savory', 'Spicy', 'Umami', 'Fresh', 'Rich', 'Sweet', 'Tangy',
]

export const PROTEIN_OPTIONS = [
  'Chicken', 'Beef', 'Pork', 'Fish', 'Shrimp/Seafood',
  'Tofu', 'Eggs', 'Beans/Lentils', 'Lamb', 'Turkey', 'Duck', 'None',
]

export const COOKING_METHOD_OPTIONS = [
  'Grilled', 'Baked', 'Roasted', 'Stir-fried', 'Braised',
  'Soup/Stew', 'Fried', 'Steamed', 'Raw/Salad', 'Pan-seared',
  'Slow-cooked', 'Smoked',
]

export const CARB_OPTIONS = [
  'Rice', 'Pasta', 'Noodles', 'Bread', 'Potato',
  'Quinoa', 'Couscous', 'Polenta', 'Tortilla/Wrap', 'None',
]

export const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free',
  'Low-Carb', 'High-Protein', 'Nut-Free', 'Paleo',
]

export const DAIRY_OPTIONS = [
  'Cheese', 'Cream', 'Butter', 'Milk', 'Yogurt',
  'Parmesan', 'Mozzarella', 'None',
]

export const VEGETABLE_OPTIONS = [
  'Tomato', 'Spinach/Greens', 'Mushrooms', 'Bell Peppers',
  'Onion/Garlic', 'Broccoli', 'Zucchini', 'Eggplant', 'Carrot',
  'Corn', 'Peas', 'Cucumber', 'Asparagus', 'Sweet Potato',
  'Cauliflower', 'Brussels Sprouts', 'Celery', 'Cabbage',
]

export const FRUIT_OPTIONS = [
  'Avocado', 'Lemon/Lime', 'Orange', 'Apple', 'Mango',
  'Pineapple', 'Berries', 'Banana', 'Coconut', 'Peach',
  'Pomegranate', 'Grapes',
]

/**
 * Prep-time buckets for the vault recipe form (PRD-002 P0.4).
 *
 * Stored on `vault.prep_time_minutes` as an integer. The chip-picker UI
 * only shows the four buckets below; `storedValue` is the integer the
 * picker writes when its bucket is selected. `bucketForMinutes` does the
 * reverse mapping when an existing recipe is loaded for edit, so the chip
 * that round-trips a saved integer matches the bucket the user picked.
 *
 * Boundary convention (so write-then-read keeps the same chip selected):
 *   minutes <= 15           → 'lt15'
 *   15  < minutes <= 30     → '15to30'
 *   30  < minutes <= 60     → '30to60'
 *   60  < minutes           → 'gt60'
 *   null                    → null  (no selection)
 */
export const PREP_TIME_BUCKETS = [
  { id: 'lt15',    label: '< 15 min',  storedValue: 15 },
  { id: '15to30',  label: '15–30 min', storedValue: 30 },
  { id: '30to60',  label: '30–60 min', storedValue: 60 },
  { id: 'gt60',    label: '60+ min',   storedValue: 90 },
]

export function bucketForMinutes(minutes) {
  if (minutes == null) return null
  if (minutes <= 15) return 'lt15'
  if (minutes <= 30) return '15to30'
  if (minutes <= 60) return '30to60'
  return 'gt60'
}

/**
 * PRD-002 P0.1: Dietary restriction options for household_preferences.
 *
 * Stored as text[] in `household_preferences.dietary_restrictions` (the
 * `id` values, not the labels). The recommender (P0.3) hard-filters
 * vault recipes against these ids; the settings UI (P0.2) renders the
 * `label`s as chip choices.
 *
 * Adding a new restriction is a code change here — no migration
 * required. The DB has no CHECK enum on this column; app-level
 * validation in `src/lib/preferences.js` is the source of truth.
 *
 * Note: distinct from `DIETARY_OPTIONS` above, which is the per-recipe
 * tag vocabulary on `vault.dietary_tags`. The two lists overlap but
 * serve different purposes (recipe attributes vs. household exclusions)
 * and are intentionally not unified.
 */
export const DIETARY_RESTRICTIONS = [
  { id: 'vegetarian',     label: 'Vegetarian' },
  { id: 'vegan',          label: 'Vegan' },
  { id: 'pescatarian',    label: 'Pescatarian' },
  { id: 'gluten-free',    label: 'Gluten-free' },
  { id: 'dairy-free',     label: 'Dairy-free' },
  { id: 'nut-free',       label: 'Nut-free' },
  { id: 'shellfish-free', label: 'Shellfish-free' },
  { id: 'kosher',         label: 'Kosher' },
  { id: 'halal',          label: 'Halal' },
  { id: 'keto',           label: 'Keto' },
  { id: 'paleo',          label: 'Paleo' },
  { id: 'low-carb',       label: 'Low-carb' },
]

/**
 * PRD-002 P0.2: Max prep-time buckets for the Preferences settings page.
 *
 * Stored as integer in `household_preferences.max_prep_time_minutes`.
 * The 'No limit' chip writes NULL — the recommender (P0.3) falls back to
 * DEFAULT_MAX_PREP_TIME_MINUTES when the column is null.
 *
 * Distinct from PREP_TIME_BUCKETS above (per-recipe vault input). These
 * are upper-bound caps on the household level, not per-recipe estimates.
 * Sorted ascending by storedValue with the null sentinel last so the UI
 * lays out left-to-right "tighter cap → looser cap → no cap."
 */
export const MAX_PREP_TIME_BUCKETS = [
  { id: '30',   label: '30 min',   storedValue: 30 },
  { id: '60',   label: '60 min',   storedValue: 60 },
  { id: '90',   label: '90 min',   storedValue: 90 },
  { id: '120',  label: '120 min',  storedValue: 120 },
  { id: 'none', label: 'No limit', storedValue: null },
]

// PRD-002 P0.9: how many AI suggestions to mix into each full-grid regenerate.
// Tunable per PRD-002 P0.9; raise if vault feels exhausted, lower if AI feels noisy.
export const AI_CANDIDATE_COUNT = 3

// PRD-002 P0.7: how many top-scored vault candidates to show in the day picker.
// Tunable per PRD-002 P0.7. AI_CANDIDATE_COUNT (P0.9) controls AI count.
export const PICKER_VAULT_COUNT = 5

/**
 * Build the JSON-shape block appended to the analyze-recipe AI prompt.
 * Both api-server.mjs (local Express proxy) and api/analyze-recipe.js
 * (Vercel serverless mirror) call this so the prompt always reflects
 * the latest enum values.
 *
 * Response schema for /api/analyze-recipe:
 *   - cuisine_type, flavor_profile, cooking_method, main_carb: string or null
 *   - proteins, dietary_tags, dairy_components, vegetables, fruits: arrays
 *   - prep_time_minutes: integer minutes or null when not estimable from
 *     the source. The client treats this as null-safe — if the AI returns
 *     null, the form leaves the prep-time chip unselected.
 */
export function buildAnalyzeRecipePromptBlock() {
  return `{
  "cuisine_type": one of [${CUISINE_OPTIONS.join(', ')}] or null,
  "flavor_profile": one of [${FLAVOR_OPTIONS.join(', ')}] or null,
  "proteins": array from [${PROTEIN_OPTIONS.join(', ')}],
  "cooking_method": one of [${COOKING_METHOD_OPTIONS.join(', ')}] or null,
  "main_carb": one of [${CARB_OPTIONS.join(', ')}] or null,
  "dietary_tags": array from [${DIETARY_OPTIONS.join(', ')}],
  "dairy_components": array from [${DAIRY_OPTIONS.join(', ')}],
  "vegetables": array from [${VEGETABLE_OPTIONS.join(', ')}],
  "fruits": array from [${FRUIT_OPTIONS.join(', ')}],
  "prep_time_minutes": positive integer estimate of total prep + cook time in minutes, or null if you cannot reasonably estimate
}`
}
