/**
 * POST /api/classify-ingredients — Vercel serverless port of the Express
 * route in api-server.mjs. Both share the request handler in
 * api/_lib/classifyHandler.js so validation + prompt logic lives in one
 * place. See ADR-002 / PRD-004 Phase A.
 */
import { anthropic } from './_lib/anthropic.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { createClassifyIngredientsHandler } from './_lib/classifyHandler.js'
import { requireAuth, AuthError } from './_lib/verifyAuth.js'

// ADR-004: pass Supabase service-role client so the handler reaches
// classifyIngredientsCached with cache I/O enabled. Null env ⇒ uncached
// pass-through.
const handle = createClassifyIngredientsHandler({ anthropic, supabase: supabaseAdmin })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  try {
    const { user } = await requireAuth(req)
    req.user = user
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500
    return res.status(status).json({ error: err.message })
  }
  return handle(req, res)
}
