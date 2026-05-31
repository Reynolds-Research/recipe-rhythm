/**
 * Fail-fast config guard for Vercel production deployments.
 *
 * Call assertProductionConfig(requiredVars, moduleName) at the top level of
 * any module that needs env vars to function correctly in production.
 *
 *   - VERCEL_ENV === 'production' + any var missing/empty → throws at module
 *     load, so the cold-start fails loudly with a clear diagnostic instead of
 *     degrading silently per-request.
 *   - All other environments (local dev, preview, test) → emits a one-time
 *     console.warn per moduleName so devs see the problem without being
 *     blocked from running the server locally without secrets set.
 *
 * VERCEL_ENV is injected automatically by Vercel — no extra package needed.
 * It is NOT set during local npm run dev or Vitest runs, so the throw path
 * is inert in both those contexts.
 */

const _warned = new Set()

/**
 * @param {string[]} requiredVars  - env var names that must be non-empty
 * @param {string}   moduleName    - shown in the error/warning message
 */
export function assertProductionConfig(requiredVars, moduleName) {
  const missing = requiredVars.filter(v => !process.env[v])
  if (!missing.length) return

  const msg =
    `[config] ${moduleName}: required env vars missing in production: ${missing.join(', ')}. ` +
    'Set them in Vercel Project Settings → Environment Variables.'

  if (process.env.VERCEL_ENV === 'production') {
    throw new Error(msg)
  }

  if (!_warned.has(moduleName)) {
    _warned.add(moduleName)
    console.warn(msg)
  }
}
