/**
 * analyzeRecipe
 * Calls the server-side proxy (/api/analyze-recipe) which holds the
 * Anthropic key and returns parsed component metadata for a recipe.
 * Used by both Vault (manual add) and LogMode (save-to-vault flow).
 */
export async function analyzeRecipe(arg) {
  let name = ''
  let url = ''
  let imageBase64 = null
  let mediaType = null
  // PRD-006 D1: optional user-confirmed chip values that pin ground truth in
  // the extractor prompt. Omitted when undefined so old call sites stay
  // wire-identical to pre-D1.
  let userChips

  if (typeof arg === 'string') {
    name = arg
  } else if (arg) {
    name = arg.name || ''
    url = arg.url || ''
    imageBase64 = arg.imageBase64 || null
    mediaType = arg.mediaType || null
    userChips = arg.userChips
  }

  const body = { name, url, imageBase64, mediaType }
  if (userChips !== undefined) body.userChips = userChips

  let res
  try {
    res = await fetch('/api/analyze-recipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
  return data.components ?? null
}
