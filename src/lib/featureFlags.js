/**
 * featureFlags.js — build-time switches.
 *
 * VITE_NEW_PREP_TABLE (PRD-008 phase 2b, decided 2026-11-02): "true" shows the
 * new calendar Prep Table (src/pages/PrepTable) instead of the old period-based
 * one (src/pages/BrainstormMode). Anything else — including unset — keeps
 * today's app exactly. It's read when the app is built, so flipping it means a
 * redeploy. Removed in PRD-008 phase 4 along with the old screens.
 */

/** @param {Record<string, string|undefined>} [env] defaults to Vite's build env */
export function isNewPrepTableEnabled(env = import.meta.env) {
  return env?.VITE_NEW_PREP_TABLE === 'true'
}
