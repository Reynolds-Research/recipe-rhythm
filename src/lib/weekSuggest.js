/**
 * weekSuggest.js — "✨ suggest" for the new Prep Table (PRD-008 §4.1, D3).
 *
 * Mental model: suggestions are proposals, not plans. This picks one cookbook
 * recipe per empty day and returns them; nothing is saved until she taps ✓
 * (the screen then calls addMeal). That keeps the history honest: it only
 * holds what she chose.
 *
 * Reuses the existing recommender (getRecommendations): her preferences are a
 * hard filter, recently eaten meals are skipped, and the week's own meals are
 * counted as "recent" so suggestions avoid repeating or echoing them. Vault
 * only — no AI call — so suggesting is instant and free. (The old Prep Table's
 * AI ideas stay in its day picker; adding them here is a later choice.)
 */

import { getRecommendations } from './recommendations'

/**
 * @param {object} args
 * @param {string[]} args.dates          empty days to fill, in order
 * @param {object[]} args.vault          the household cookbook
 * @param {object[]} [args.recentMeals]  meal log rows (vault_id, name, eaten_on)
 * @param {object[]} [args.weekMeals]    planned_meals rows already in the week
 * @param {object|null} [args.preferences]
 * @param {string[]} [args.skipIds]      recipe ids not to propose (already proposed, or dismissed)
 * @returns {Record<string, object>}     date → recipe; days with no candidate are left out
 */
export function suggestForDays({
  dates,
  vault,
  recentMeals = [],
  weekMeals = [],
  preferences = null,
  skipIds = [],
}) {
  if (!dates?.length || !vault?.length) return {}

  const inWeek = weekMeals.filter((m) => m.vault_id).map((m) => m.vault_id)
  const excludeIds = [...new Set([...inWeek, ...skipIds])]
  // The recommender reads served plan items as recent history (vault_id + date).
  const asHistory = weekMeals
    .filter((m) => m.vault_id && m.planned_on)
    .map((m) => ({ vault_id: m.vault_id, name: m.name, scheduled_date: m.planned_on }))

  const ranked = getRecommendations(vault, recentMeals, [], dates.length, asHistory, {
    excludeIds,
    preferences,
  }).filter((r) => r.source === 'vault' && !excludeIds.includes(r.id))

  const out = {}
  dates.forEach((date, i) => {
    if (ranked[i]) out[date] = ranked[i]
  })
  return out
}
