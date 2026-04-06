/**
 * Recommendation Engine
 * The "anti-rut" brain of the app.
 * Takes recent meals + vault items and returns a ranked suggestion list.
 */

const RECENCY_DAYS     = 7    // exclude meals eaten within this window
const VAULT_RATIO      = 0.8  // 80% of suggestions from Vault
const WILDCARD_RATIO   = 0.2  // 20% from Spoonacular wildcards

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
 * Scores a vault item based on:
 * - Recency penalty: was it eaten recently? (lower is better)
 * - Cuisine diversity bonus: different from what was eaten this week?
 * - Flavor diversity bonus: different flavor profile?
 */
function scoreVaultItem(item, recentMeals, recentVaultIds) {
  let score = 100

  // Recency penalty — skip anything eaten in the last 7 days
  if (recentVaultIds.has(item.id)) return -1

  // Cuisine diversity bonus — reward cuisines not seen this week
  const recentCuisines = new Set(recentMeals.map(m => m.cuisine_type).filter(Boolean))
  if (!recentCuisines.has(item.cuisine_type)) score += 30

  // Flavor diversity bonus — reward flavors not seen this week
  const recentFlavors = new Set(recentMeals.map(m => m.flavor_profile).filter(Boolean))
  if (!recentFlavors.has(item.flavor_profile)) score += 20

  // Slight random shuffle so results feel fresh each session
  score += Math.random() * 15

  return score
}

/**
 * Main function — call this to get the week's suggestions.
 *
 * @param {Array} vaultItems   - All items in the Vault from Supabase
 * @param {Array} recentMeals  - Meals from the past 2 weeks from Supabase
 * @param {Array} wildcards    - Recipe objects fetched from Spoonacular
 * @param {number} count       - How many suggestions to return (default 7, one per day)
 */
export function getRecommendations(vaultItems, recentMeals, wildcards = [], count = 7) {
  const recentVaultIds = getRecentVaultIds(recentMeals)

  // Score and sort vault items
  const scoredVault = vaultItems
    .map(item => ({ ...item, _score: scoreVaultItem(item, recentMeals, recentVaultIds) }))
    .filter(item => item._score > 0)
    .sort((a, b) => b._score - a._score)

  // Split the count between vault and wildcards
  const vaultCount    = Math.round(count * VAULT_RATIO)    // e.g. 6 of 7
  const wildcardCount = count - vaultCount                  // e.g. 1 of 7

  const vaultPicks    = scoredVault.slice(0, vaultCount)
  const wildcardPicks = wildcards.slice(0, wildcardCount).map(w => ({
    ...w,
    is_wildcard: true,
  }))

  // Interleave: mostly vault, sprinkle wildcards in
  return [...vaultPicks, ...wildcardPicks]
}
