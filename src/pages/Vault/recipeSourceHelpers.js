/** A pasted link without a scheme gets https:// (so it opens). Empty = none. */
export function cleanLink(raw) {
  const v = (raw ?? '').trim()
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
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
