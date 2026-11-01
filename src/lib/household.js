/**
 * household.js — which household does this account belong to? (PRD-008 P0.1)
 *
 * Mental model: the household owns the kitchen (recipes, plans, meal log,
 * grocery lists, preferences); `user_id` on a row only says who added it.
 * Every account belongs to exactly one household (the database enforces it),
 * so the answer is a single id. Data helpers filter by it:
 *
 *   const householdId = await getHouseholdId(supabase, userId)
 *   supabase.from('vault').select('*').eq('household_id', householdId)
 *
 * The lookup runs once per account and is remembered (like writing your
 * locker number on your hand), so the dozens of queries that follow don't
 * each ask again. Call clearHouseholdCache() on sign-in / sign-out.
 *
 * The security rules already hide other households' rows; the explicit
 * filter is the second lock, and keeps queries on their indexes.
 *
 * In unit tests this module is mocked globally (src/setupTests.js) to
 * return `hh-<userId>`; its own tests use the real module.
 */

const cache = new Map()

export class NoHouseholdError extends Error {
  constructor(userId) {
    super(`No household found for account ${userId}`)
    this.name = 'NoHouseholdError'
  }
}

/**
 * Resolve the household id for `userId`. Rejects if the lookup fails or the
 * account has no household (that would mean the sign-up trigger didn't run).
 * A failed lookup is not remembered, so the next call tries again.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<string>}
 */
export function getHouseholdId(supabase, userId) {
  if (!userId) return Promise.reject(new Error('getHouseholdId: userId is required'))
  if (!cache.has(userId)) {
    const pending = Promise.resolve(
      supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .maybeSingle(),
    ).then(({ data, error }) => {
      if (error) throw error
      if (!data?.household_id) throw new NoHouseholdError(userId)
      return data.household_id
    })
    cache.set(userId, pending)
    pending.catch(() => {
      if (cache.get(userId) === pending) cache.delete(userId)
    })
  }
  return cache.get(userId)
}

/** Forget every remembered household (sign-in, sign-out, tests). */
export function clearHouseholdCache() {
  cache.clear()
}
