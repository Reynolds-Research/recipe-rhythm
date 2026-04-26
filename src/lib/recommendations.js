/**
 * Recommendation Engine
 * The "anti-rut" brain of the app.
 * Takes recent meals + vault items and returns a ranked suggestion list.
 */

const RECENCY_DAYS = 7  // exclude meals eaten within this window

/**
 * Returns meals eaten in the last N days as a Set of vault_ids
 * so we can quickly exclude them from suggestions.
 */
function getRecentVaultIds(meals, days = RECENCY_DAYS) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  return new Set(
    meals
      .filter(m => m.vault_id && new Date(m.eaten_on) >= cutoff)
      .map(m => m.vault_id)
  )
}

/**
 * Counts how many times each vault item has been actually cooked
 * over the full meal history window. More appearances = a proven favorite.
 */
function buildFrequencyMap(meals) {
  const freq = new Map()
  for (const meal of meals) {
    if (meal.vault_id) {
      freq.set(meal.vault_id, (freq.get(meal.vault_id) || 0) + 1)
    }
  }
  return freq
}

/**
 * Inspects meals from the past 7 days and aggregates the attribute
 * fingerprint of what was eaten — pulling rich metadata from vault items
 * when a meal is linked to the vault.
 *
 * Used to avoid repetition on dimensions the user can actually taste:
 * protein, cooking method, and carb base.
 */
function buildWeeklyAttributes(meals, vaultById) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RECENCY_DAYS)
  const weekMeals = meals.filter(m => new Date(m.eaten_on) >= cutoff)

  const cuisines       = new Set()
  const flavors        = new Set()
  const cookingMethods = new Set()
  const proteins       = new Set()
  const mainCarbs      = new Set()

  for (const meal of weekMeals) {
    if (meal.cuisine_type)   cuisines.add(meal.cuisine_type)
    if (meal.flavor_profile) flavors.add(meal.flavor_profile)

    // Pull richer attribute data from the linked vault item
    const vault = meal.vault_id ? vaultById.get(meal.vault_id) : null
    if (vault) {
      if (vault.cooking_method) cookingMethods.add(vault.cooking_method)
      if (vault.main_carb)      mainCarbs.add(vault.main_carb)
      for (const p of (vault.proteins || [])) proteins.add(p)
    }
  }

  return { cuisines, flavors, cookingMethods, proteins, mainCarbs }
}

/**
 * Scores a single vault item. Higher = more likely to appear in the plan.
 *
 * Factors:
 *  +25  Cuisine not seen this week (diversity)
 *  +15  Flavor profile not seen this week (diversity)
 *  -15  Same cooking method as something eaten this week (repetition)
 *  -10  Same main carb as something eaten this week
 *  -10  Per overlapping protein with this week's meals
 *  +30  Max frequency bonus — items the user has actually cooked before
 *  +50  Max family-rating boost (+10 per star, NULL = 0). PRD-002 P0.5.
 *  -15  Prep-time penalty when prep_time_minutes > preferences.max_prep_time_minutes / 2.
 *       No-op until Phase 3 ships household_preferences. PRD-002 P0.5.
 *  +15  Random shuffle so results feel fresh each session
 *
 * Hard-excludes (return -1 before scoring):
 *  - item.id in recentVaultIds (eaten in last 7 days)
 *  - item.id in excludeSet (PRD-002 P0.8: prior-batch + current-plan)
 */
function scoreVaultItem(item, recentVaultIds, weeklyAttributes, frequencyMap, excludeSet, preferences) {
  let score = 100

  // Hard exclude anything eaten in the last 7 days
  if (recentVaultIds.has(item.id)) return -1

  // PRD-002 P0.8: hard-exclude prior-batch / current-plan ids
  if (excludeSet.has(item.id)) return -1

  // Cuisine & flavor diversity bonuses
  if (item.cuisine_type   && !weeklyAttributes.cuisines.has(item.cuisine_type))     score += 25
  if (item.flavor_profile && !weeklyAttributes.flavors.has(item.flavor_profile))    score += 15

  // Cooking method repetition penalty
  if (item.cooking_method && weeklyAttributes.cookingMethods.has(item.cooking_method)) score -= 15

  // Main carb repetition penalty
  if (item.main_carb && weeklyAttributes.mainCarbs.has(item.main_carb)) score -= 10

  // Protein overlap penalty (per overlapping protein)
  const itemProteins  = item.proteins || []
  const proteinOverlap = itemProteins.filter(p => weeklyAttributes.proteins.has(p)).length
  score -= proteinOverlap * 10

  // Frequency bonus — reward meals the user has actually cooked, capped at +30
  const timesCooked = frequencyMap.get(item.id) || 0
  score += Math.min(timesCooked * 8, 30)

  // PRD-002 P0.5: Family-rating boost. +10 per star, max +50. NULL = 0
  // (unrated recipes don't get penalized, they just don't get the boost).
  if (item.family_rating != null) {
    score += 10 * item.family_rating
  }

  // PRD-002 P0.5: Prep-time penalty. Only applied when the user has a
  // max_prep_time_minutes cap set (forthcoming via household_preferences
  // in Phase 3). Until then this branch is unreachable.
  const maxPrep = preferences?.max_prep_time_minutes
  if (
    maxPrep != null &&
    item.prep_time_minutes != null &&
    item.prep_time_minutes > maxPrep / 2
  ) {
    score -= 15
  }

  // Small random jitter so results feel fresh each session
  score += Math.random() * 15

  return score
}

/**
 * Main function — call this to get the week's suggestions.
 *
 * @param {Array}  vaultItems      - All Vault items from Supabase (with full metadata)
 * @param {Array}  recentMeals     - Meals from the past 90 days (for frequency + recency)
 * @param {Array}  wildcards       - Recipe candidates returned by /api/swap-suggestions (Haiku 4.5).
 *                                   Each must have at least { id, name }; is_wildcard:true is set
 *                                   by this function before returning.
 * @param {number} count           - How many suggestions to return (default 5, Sun–Thu)
 * @param {Array}  servedPlanItems - Items from the prior week's served plan (pseudo-meals
 *                                   with vault_id + scheduled_date) to factor into recency
 *                                   and frequency scoring.
 * @param {Object} options         - PRD-002 P0.5 / P0.8 options bag.
 *   @param {Array}  options.excludeIds   - Vault ids to hard-exclude (treated like recently-eaten).
 *                                          Used by BrainstormMode to suppress current-plan + prior-batch
 *                                          items so "regenerate" / single-slot picks return new candidates.
 *   @param {Object} options.preferences  - Household preferences (forthcoming in Phase 3).
 *                                          Today only `max_prep_time_minutes` is read; if set, items
 *                                          whose prep_time_minutes > max/2 take a -15 penalty.
 */
export function getRecommendations(
  vaultItems,
  recentMeals,
  wildcards = [],
  count = 7,
  servedPlanItems = [],
  options = {},
) {
  const { excludeIds = [], preferences = {} } = options
  const excludeSet = new Set(excludeIds)

  // Merge served plan items into the meal history so the engine treats
  // recently-planned meals the same as recently-eaten ones for recency/frequency.
  const syntheticMeals = servedPlanItems
    .filter(m => m.vault_id && m.scheduled_date)
    .map(m => ({ vault_id: m.vault_id, name: m.name, eaten_on: m.scheduled_date }))
  const allMeals = [...recentMeals, ...syntheticMeals]

  // Build lookup and derived signals
  const vaultById       = new Map(vaultItems.map(v => [v.id, v]))
  const frequencyMap    = buildFrequencyMap(allMeals)
  const weeklyAttrs     = buildWeeklyAttributes(allMeals, vaultById)
  const recentVaultIds  = getRecentVaultIds(allMeals)

  // Score and sort vault items
  const scoredVault = vaultItems
    .map(item => ({
      ...item,
      _score: scoreVaultItem(item, recentVaultIds, weeklyAttrs, frequencyMap, excludeSet, preferences),
    }))
    .filter(item => item._score > 0)
    .sort((a, b) => b._score - a._score)

  // Split the count between vault and wildcards. Target ~20% wildcards when
  // available; fall back to 100% vault when none are passed.
  const wildcardCount = Math.min(wildcards.length, Math.floor(count * 0.2))
  const vaultCount    = count - wildcardCount

  const vaultPicks    = scoredVault.slice(0, vaultCount)
  const wildcardPicks = wildcards.slice(0, wildcardCount).map(w => ({
    ...w,
    is_wildcard: true,
  }))

  return [...vaultPicks, ...wildcardPicks]
}
