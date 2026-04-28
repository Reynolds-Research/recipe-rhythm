/**
 * POST /api/classify-ingredients — Vercel serverless port of the Express
 * route in api-server.mjs. Both share the request handler in
 * api/_lib/classifyHandler.js so validation + prompt logic lives in one
 * place. See ADR-002 / PRD-004 Phase A.
 */
import { anthropic } from './_lib/anthropic.js'
import { createClassifyIngredientsHandler } from './_lib/classifyHandler.js'

const handle = createClassifyIngredientsHandler({ anthropic })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  return handle(req, res)
}
