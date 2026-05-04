/**
 * PRD-006 D1: chip-diff helper for the vault edit flow.
 *
 * After a user saves a chip edit on a recipe, we re-extract the ingredient
 * list only when one of the *structural* chip categories changed —
 * proteins, main_carb, dairy_components, vegetables, fruits. Cosmetic
 * changes (notes, prep_time_minutes, family_rating, etc.) don't warrant a
 * round-trip through the AI.
 *
 * Both inputs are recipe-shaped objects (or partial chip dicts) that may
 * contain the listed fields. Missing fields are treated as null / empty.
 */

const STRUCTURAL_ARRAY_FIELDS = [
  'proteins',
  'dairy_components',
  'vegetables',
  'fruits',
]

const STRUCTURAL_SCALAR_FIELDS = [
  'main_carb',
]

function arrayChanged(a, b) {
  const aArr = Array.isArray(a) ? a : []
  const bArr = Array.isArray(b) ? b : []
  if (aArr.length !== bArr.length) return true
  // Order-insensitive set comparison: chip pickers don't preserve order and
  // the underlying chip vocabulary is small.
  const aSet = new Set(aArr)
  for (const v of bArr) {
    if (!aSet.has(v)) return true
  }
  return false
}

function scalarChanged(a, b) {
  return (a ?? null) !== (b ?? null)
}

export function chipsRequireReExtraction(oldChips, newChips) {
  const o = oldChips || {}
  const n = newChips || {}
  for (const f of STRUCTURAL_ARRAY_FIELDS) {
    if (arrayChanged(o[f], n[f])) return true
  }
  for (const f of STRUCTURAL_SCALAR_FIELDS) {
    if (scalarChanged(o[f], n[f])) return true
  }
  return false
}
