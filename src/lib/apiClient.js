/**
 * Authenticated fetch wrapper for all /api/* calls from the client.
 *
 * Injects `Authorization: Bearer <token>` from the active Supabase session
 * so every server endpoint can verify the caller's identity. Falls back
 * gracefully (no Authorization header) when there is no active session —
 * the server will return 401, which propagates to the caller as-is.
 *
 * Drop-in replacement for fetch() for internal API calls:
 *   const res = await apiFetch('/api/grocery-list', { method: 'POST', body: JSON.stringify(data) })
 *
 * Returns the raw Response — each call site handles .ok checks and JSON
 * parsing the same way it did before.
 */
import { supabase } from './supabase.js'

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return fetch(path, { ...options, headers })
}
