/**
 * Shared Supabase service-role client for the API server (Express + Vercel
 * serverless mirrors).
 *
 * Used ONLY for writing to cross-user shared cache tables that have no
 * authenticated INSERT/UPDATE/DELETE policies (see ADR-004 +
 * supabase/migrations/20260506000003_ai_response_caches.sql). Service-role
 * key bypasses RLS, which is exactly what these tables need — anonymous,
 * server-attributed writes from a trusted server process.
 *
 * Mirrors the env-driven singleton pattern in `./anthropic.js`. If the
 * env vars are missing (e.g. local dev without SUPABASE_* set), this
 * exports `null` and callers MUST gracefully skip caching — no crash, no
 * 500 error, just degrade to the uncached path. This way a forgotten
 * Vercel env var is never user-visible.
 *
 * NEVER expose this client to the browser. Vercel auto-bundles only what
 * api/* imports; src/ never imports from api/_lib/.
 *
 * The same env vars (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are already
 * used by scripts/backfill-*.js — see .env.example for the documented setup.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Single one-time warning at startup so the operator knows caching is off
  // without spamming every request log.
  console.warn(
    '[api] supabaseAdmin: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing — AI response caching is DISABLED. AI endpoints still work; they just don\'t persist or read cache entries.',
  )
}

export const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      // We only ever do anonymous, server-attributed reads/writes. No user
      // sessions to persist or refresh — the service-role key is the
      // authentication. These flags keep the SDK from doing unnecessary
      // work on each request.
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
    })
  : null

/**
 * Lowercase + collapse whitespace + trim. Used as the canonical
 * normalization for cache keys (recipe names, ingredient names, raw user
 * input). Exported so tests can verify cache lookups use the same shape.
 *
 * @param {unknown} s
 * @returns {string} normalized string, or '' for non-string / empty input
 */
export function normalizeForCache(s) {
  if (typeof s !== 'string') return ''
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}
