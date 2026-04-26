/**
 * vaultMatch
 * Resolves a free-text meal name against the user's Vault recipes for the
 * meals → vault auto-link flow (PRD-001 P0.2). Drives LogMode's disambiguation
 * sheet and the back-link write on Save-to-Cookbook.
 */

const DEFAULT_FUZZY_THRESHOLD = 0.6 // PRD-001 OQ.A starting point; tunable

/**
 * Find vault recipes that match the given meal name.
 *
 * Algorithm:
 *   1. Try exact case-insensitive ILIKE match → confidence: 'exact'
 *   2. Otherwise call the vault_fuzzy_match RPC (pg_trgm similarity ≥ threshold)
 *      → confidence: 'fuzzy'
 *   3. Otherwise empty → confidence: 'none'
 *
 * RLS on `vault` (and the SECURITY INVOKER RPC) ensures we only see the
 * calling user's recipes; the explicit `user_id = p_user_id` filter is a
 * second belt for the same constraint.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId - The user's UUID
 * @param {string} mealName - The trimmed meal name to match
 * @param {object} [opts]
 * @param {number} [opts.fuzzyThreshold=0.6] - pg_trgm similarity cutoff
 * @returns {Promise<{ matches: Array<{id, name, image_url}>, confidence: 'exact'|'fuzzy'|'none' }>}
 */
export async function matchVaultByName(supabase, userId, mealName, opts = {}) {
  const fuzzyThreshold = opts.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD
  const trimmed = (mealName ?? '').trim()
  if (!trimmed || !userId) {
    return { matches: [], confidence: 'none' }
  }

  const { data: exact, error: exactErr } = await supabase
    .from('vault')
    .select('id, name, image_url')
    .eq('user_id', userId)
    .ilike('name', trimmed)
    .limit(5)

  if (!exactErr && exact && exact.length > 0) {
    return { matches: exact, confidence: 'exact' }
  }

  const { data: fuzzy, error: fuzzyErr } = await supabase.rpc('vault_fuzzy_match', {
    p_user_id:   userId,
    p_query:     trimmed,
    p_threshold: fuzzyThreshold,
  })

  if (!fuzzyErr && fuzzy && fuzzy.length > 0) {
    // The RPC's RETURNS TABLE uses match_id/match_name to dodge a Postgres
    // OUT-parameter vs. source-column ambiguity. Re-shape to the (id, name,
    // image_url) contract callers expect.
    return {
      matches: fuzzy.map(({ match_id, match_name, image_url }) => ({
        id:        match_id,
        name:      match_name,
        image_url,
      })),
      confidence: 'fuzzy',
    }
  }

  return { matches: [], confidence: 'none' }
}
