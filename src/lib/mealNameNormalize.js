/**
 * Meal-name normalization: spell-check + title-case.
 *
 * Two layers:
 *   - `toTitleCase(name)` — pure, deterministic title-casing applied to every
 *     accepted meal name (offline fallback when the spell-check API is
 *     unreachable). Lowercases common stop-words mid-name; preserves
 *     ALL-CAPS tokens (BBQ, BLT, NY); first/last word are always capitalized.
 *   - `normalizeMealName(rawName)` — calls /api/normalize-meal-name, which
 *     uses Haiku 4.5 to fix typos AND apply title-case. Returns a
 *     `{ corrected, hasChanges }` shape the caller can show in a confirm
 *     prompt before persisting. Falls back to the local title-case if the
 *     API errors or is unreachable.
 */

import { apiFetch } from './apiClient.js'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'en', 'for', 'if', 'in', 'of',
  'on', 'or', 'the', 'to', 'vs', 'via', 'with',
])

function capitalizeWord(word) {
  if (!word) return word
  // Short all-caps tokens (≤4 chars) are treated as acronyms (BBQ, BLT, NY,
  // LA, KFC, IPA) and preserved. Longer all-caps tokens are normalized — a
  // user typing "CHICKEN PARMESAN" almost certainly meant Title Case.
  if (
    word.length >= 2 &&
    word.length <= 4 &&
    word === word.toUpperCase() &&
    /[A-Z]/.test(word)
  ) {
    return word
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function titleCaseToken(token, isFirst, isLast) {
  // Tokens may contain hyphens or apostrophes — title-case each hyphen-part.
  if (token.includes('-')) {
    return token
      .split('-')
      .map((part, i, arr) =>
        titleCaseToken(part, isFirst && i === 0, isLast && i === arr.length - 1),
      )
      .join('-')
  }
  // Lowercase stop-word mid-name only.
  const lower = token.toLowerCase()
  if (!isFirst && !isLast && STOP_WORDS.has(lower)) return lower
  return capitalizeWord(token)
}

export function toTitleCase(name) {
  if (typeof name !== 'string') return ''
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const tokens = trimmed.split(' ')
  return tokens
    .map((tok, i) => titleCaseToken(tok, i === 0, i === tokens.length - 1))
    .join(' ')
}

/**
 * Spell-check + title-case a meal name via the Anthropic proxy.
 *
 * Returns:
 *   { corrected: string, hasChanges: boolean, error?: string }
 *
 * On any network/parse failure we fall back to the local `toTitleCase`
 * result so the caller never has to handle a missing value — the contract
 * is "always returns a normalized string". `hasChanges` reflects whether
 * the corrected form differs from the user's raw input (after trim), so
 * the caller can decide whether to prompt the user to confirm the change.
 */
export async function normalizeMealName(rawName) {
  const input = typeof rawName === 'string' ? rawName.trim() : ''
  if (!input) return { corrected: '', hasChanges: false }

  let res
  try {
    res = await apiFetch('/api/normalize-meal-name', {
      method: 'POST',
      body: JSON.stringify({ name: input }),
    })
  } catch (err) {
    console.error('[normalizeMealName] fetch failed:', err)
    const fallback = toTitleCase(input)
    return { corrected: fallback, hasChanges: fallback !== input, error: 'network' }
  }

  if (!res.ok) {
    const fallback = toTitleCase(input)
    return { corrected: fallback, hasChanges: fallback !== input, error: 'upstream' }
  }

  let data
  try {
    data = await res.json()
  } catch {
    const fallback = toTitleCase(input)
    return { corrected: fallback, hasChanges: fallback !== input, error: 'parse' }
  }

  const corrected = typeof data?.corrected === 'string' && data.corrected.trim()
    ? data.corrected.trim()
    : toTitleCase(input)

  return { corrected, hasChanges: corrected !== input }
}
