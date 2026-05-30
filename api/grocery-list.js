/**
 * POST /api/grocery-list — Vercel serverless port of the Express route in
 * api-server.mjs. Both share the request handler in
 * api/_lib/groceryListHandler.js so validation + prompt logic lives in
 * one place. See PRD-003 P0.3.
 */
import { anthropic } from './_lib/anthropic.js'
import { createGroceryListHandler } from './_lib/groceryListHandler.js'
import { requireAuth, AuthError } from './_lib/verifyAuth.js'

const handle = createGroceryListHandler({ anthropic })

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
