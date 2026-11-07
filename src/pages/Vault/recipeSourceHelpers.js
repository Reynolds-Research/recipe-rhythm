/** A pasted link without a scheme gets https:// (so it opens). Empty = none. */
export function cleanLink(raw) {
  const v = (raw ?? '').trim()
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/**
 * Save a link from a card, then read its recipe page (Vault/index.jsx).
 * Reads only when the save worked and there is a link (removing one reads nothing).
 */
export async function saveLinkThenRead(recipeId, url, { save, read }) {
  const saved = await save(recipeId, url)
  if (saved?.ok && url) await read(recipeId, { newLink: true, url })
  return saved
}

/** The message for a readRecipeLink result (useVault). */
export function linkMessage(result) {
  if (result.ok) return { kind: 'done', message: `✓ Read ${result.count} ingredients from the recipe page.`, list: result.list ?? [] }
  const messages = {
    blocked: 'This site doesn’t let apps read its recipes. Add screenshots for the exact amounts.',
    no_recipe: 'Couldn’t find the ingredients on that page. Add screenshots for the exact amounts.',
    unreachable: 'Couldn’t open that link. Check it, or add screenshots.',
    unsafe: 'That link can’t be opened. Check it, or add screenshots.',
    screenshot: null,
  }
  if (result.reason in messages) return messages[result.reason] ? { kind: 'error', message: messages[result.reason] } : null
  return { kind: 'error', message: 'Couldn’t read the recipe page. Try again, or add screenshots.' }
}

/** The message for a readRecipeScreenshots result (useVault). */
export function screenshotMessage(result) {
  if (result.ok) return { kind: 'done', message: `✓ Read ${result.count} ingredients from your screenshots.`, list: result.list ?? [] }
  const messages = {
    'too-many': 'Pick up to 3 screenshots.',
    unreadable: 'Couldn’t find an ingredient list in those screenshots. Try clearer ones.',
  }
  return { kind: 'error', message: messages[result.reason] ?? 'Couldn’t read those screenshots. Try again.' }
}
