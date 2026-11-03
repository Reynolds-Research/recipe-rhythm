/**
 * featureFlags.js — build-time switches.
 *
 * VITE_NEW_PREP_TABLE (PRD-008 phase 2b, decided 2026-11-02): "true" shows the
 * new calendar Prep Table (src/pages/PrepTable) instead of the old period-based
 * one (src/pages/BrainstormMode). Anything else — including unset — keeps
 * today's app exactly. It's read when the app is built, so flipping it means a
 * redeploy. Removed in PRD-008 phase 4 along with the old screens.
 *
 * SECURITY: always read ONE named setting (import.meta.env.VITE_SOMETHING),
 * never the whole `import.meta.env` object. Vite copies whatever the code
 * reads into the public app bundle, so passing the whole object around
 * publishes every VITE_ setting in the project (this happened once, on a
 * 2026-11-03 preview; src/__tests__/no-whole-env-in-client.test.js now
 * guards it).
 */

/** @param {string|undefined} [value] defaults to the build's VITE_NEW_PREP_TABLE */
export function isNewPrepTableEnabled(value = import.meta.env.VITE_NEW_PREP_TABLE) {
  return value === 'true'
}
