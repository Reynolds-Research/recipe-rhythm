/**
 * POST /api/normalize-meal-name — Vercel serverless port of the Express
 * route in api-server.mjs. Both delegate to the shared handler so prompt,
 * model, and cache logic stay in lockstep automatically.
 *
 * ADR-004: server-side cache via classifyIngredientsCached's sister table
 * meal_name_normalizations_cache. supabaseAdmin is null when env vars
 * aren't configured ⇒ uncached pass-through (still functional).
 */
import { anthropic } from './_lib/anthropic.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { createNormalizeMealNameHandler } from './_lib/normalizeMealNameHandler.js'

const handle = createNormalizeMealNameHandler({ anthropic, supabase: supabaseAdmin })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  return handle(req, res)
}
