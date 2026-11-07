/**
 * analyzeRecipe
 * Calls the server-side proxy (/api/analyze-recipe) which holds the
 * Anthropic key and returns parsed component metadata for a recipe.
 * Used by both Vault (manual add) and LogMode (save-to-vault flow).
 */
import { apiFetch } from './apiClient.js'

export async function analyzeRecipe(arg) {
  let name = ''
  let url = ''
  let imageBase64 = null
  let mediaType = null
  // PRD-006 D1: optional user-confirmed chip values that pin ground truth in
  // the extractor prompt. Omitted when undefined so old call sites stay
  // wire-identical to pre-D1.
  let userChips
  // Screenshots of the recipe ([{ data, mediaType }], up to 3): the AI copies
  // the ingredients from them instead of estimating.
  let images
  // Read the real recipe from `url` on the server (2026-11-06). The result's
  // `page` says what happened: { read: true, kind } or { read: false, reason }.
  let readPage = false

  if (typeof arg === 'string') {
    name = arg
  } else if (arg) {
    name = arg.name || ''
    url = arg.url || ''
    imageBase64 = arg.imageBase64 || null
    mediaType = arg.mediaType || null
    userChips = arg.userChips
    images = arg.images
    readPage = arg.readPage === true
  }

  const body = { name, url, imageBase64, mediaType }
  if (userChips !== undefined) body.userChips = userChips
  if (Array.isArray(images) && images.length) body.images = images
  if (readPage && url) body.read_page = true

  let res
  try {
    res = await apiFetch('/api/analyze-recipe', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[analyzeRecipe] fetch failed:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    console.error('[analyzeRecipe] proxy error', res.status, JSON.stringify(body))
    return null
  }

  const data = await res.json()
  if (!data.components) return null
  return data.page ? { ...data.components, page: data.page } : data.components
}
