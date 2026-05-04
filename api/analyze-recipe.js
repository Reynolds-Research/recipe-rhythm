/**
 * POST /api/analyze-recipe — Vercel serverless port of the Express route
 * in api-server.mjs. Keep the two in sync when changing prompt/model.
 *
 * PRD-006 P0.2: logic lives in api/_lib/analyzeRecipeHandler.js so this
 * file and api-server.mjs stay in lockstep automatically.
 */
import { anthropic } from './_lib/anthropic.js'
import { createAnalyzeRecipeHandler } from './_lib/analyzeRecipeHandler.js'

const handler = createAnalyzeRecipeHandler({ anthropic })

export default async function analyzeRecipeServerless(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  return handler(req, res)
}
