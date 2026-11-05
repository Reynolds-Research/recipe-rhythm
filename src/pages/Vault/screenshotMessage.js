/** The message for a readRecipeScreenshots result (useVault). */
export function screenshotMessage(result) {
  if (result.ok) return { kind: 'done', message: `✓ Read ${result.count} ingredients from your screenshots.` }
  const messages = {
    'too-many': 'Pick up to 3 screenshots.',
    unreadable: 'Couldn’t find an ingredient list in those screenshots. Try clearer ones.',
  }
  return { kind: 'error', message: messages[result.reason] ?? 'Couldn’t read those screenshots. Try again.' }
}
