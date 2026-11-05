/**
 * groceryAmounts.js — small, pure helpers for showing grocery amounts.
 *
 * Mental model: each grocery line has two amounts (migration 20261105000002):
 *   quantity         what to buy, in store units ("2", "1¼ lb", "1 bag (5 oz)")
 *   recipe_quantity  what the recipes use in total ("1½", "1⅛ lb")
 * The list shows the buy amount; the recipe total goes underneath only when
 * it says something different. And "Assumed you have" items (spices, oils,
 * sauces) sit in their own group until she adds one.
 *
 *   friendlyAmount('1.125 lbs')            → '1⅛ lbs'   (never decimals)
 *   sameAmount('1.5 lbs', '1½ lb')          → true
 *   showRecipeLine(item)                    → true when the recipe total differs
 *   matchesStaple('kosher salt', ['salt'])  → true      (same rule the server uses)
 *   splitList(items, staples)               → { onList, assumed, hiddenStaples }
 */

const FRACTIONS = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
]

/** 1.125 → "1⅛", 0.75 → "¾", 2 → "2"; null if it isn't close to a kitchen fraction. */
function toFraction(n) {
  if (!Number.isFinite(n) || n < 0) return null
  let whole = Math.floor(n)
  const part = n - whole
  if (part < 0.02) return String(whole)
  if (part > 0.98) return String(whole + 1)
  const hit = FRACTIONS.find(([v]) => Math.abs(part - v) < 0.02)
  if (!hit) return null
  return whole === 0 ? hit[1] : `${whole}${hit[1]}`
}

/**
 * Decimals in an amount become kitchen fractions: "1.125 lbs" → "1⅛ lbs",
 * "0.5 bunch" → "½ bunch". A decimal that isn't close to one (2.4) stays.
 */
export function friendlyAmount(text) {
  if (typeof text !== 'string') return text ?? null
  return text.replace(/\d*\.\d+/g, (m) => toFraction(Number(m)) ?? m)
}

const UNIT_ALIASES = { lbs: 'lb', pounds: 'lb', pound: 'lb', ounces: 'oz', ounce: 'oz' }

function normalize(text) {
  return friendlyAmount(String(text))
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => UNIT_ALIASES[w] ?? (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ')
}

// Words that make an amount mean something different ("1 lb" ≠ "1 bunch").
// Anything else after the number ("1 lemon", "1 lb trimmed") is a description.
const UNITS = new Set([
  'lb', 'oz', 'cup', 'tbsp', 'tsp', 'bunch', 'bag', 'head', 'pack', 'package', 'can',
  'bottle', 'jar', 'container', 'box', 'stick', 'clove', 'pint', 'quart', 'piece', 'loaf',
  'dozen', 'g', 'kg', 'ml', 'l',
])

/** "1½ lb trimmed" → { n: '1½', unit: 'lb' }; "2 avocados" → { n: '2', unit: null } */
function measure(text) {
  const words = normalize(text).split(' ')
  if (!/^[\d½¼¾⅓⅔⅛⅜⅝⅞/]+$/.test(words[0] ?? '')) return null
  return { n: words[0], unit: UNITS.has(words[1]) ? words[1] : null }
}

/**
 * Do two amounts say the same thing? ("1.5 lbs" = "1½ lb"; "1" = "1 lemon";
 * "1 lb" = "1 lb trimmed and halved"; but "1 head" ≠ "1 cup shredded").
 * Same number, and the same unit or no unit on one side.
 */
export function sameAmount(a, b) {
  if (!a || !b) return false
  if (normalize(a) === normalize(b)) return true
  const x = measure(a)
  const y = measure(b)
  if (!x || !y || x.n !== y.n) return false
  return x.unit === y.unit || !x.unit || !y.unit
}

/**
 * Show "Recipes use …" under a line only when it adds something: the recipe
 * total is a real amount (starts with a number — not "chopped" or "to taste")
 * and says something different from what to buy.
 */
export function showRecipeLine(item) {
  if (!item?.recipe_quantity || !measure(item.recipe_quantity)) return false
  return !sameAmount(item.quantity, item.recipe_quantity)
}

/**
 * Is this item one of her pantry staples? Same rule the grocery-list server
 * uses to leave staples off (case-insensitive substring): "salt" covers
 * "kosher salt".
 */
export function matchesStaple(name, staples = []) {
  const lower = String(name ?? '').toLowerCase()
  return staples.some((s) => {
    const t = String(s ?? '').toLowerCase().trim()
    return t && lower.includes(t)
  })
}

/**
 * Split a list for the sheet:
 *   onList        what to buy (not assumed)
 *   assumed       "Assumed you have" — minus anything now in her pantry list.
 *                 `keep` (ids she just acted on: Add or Always have) stay in
 *                 the group, with Undo, until the sheet closes; an added one
 *                 is also on the list
 *   hiddenStaples her pantry list, named in the footer
 */
export function splitList(items = [], staples = [], keep = []) {
  const keepSet = new Set(keep)
  const onList = []
  const assumed = []
  for (const item of items) {
    if (!item.assumed) onList.push(item)
    if (keepSet.has(item.id) || (item.assumed && !matchesStaple(item.name, staples))) assumed.push(item)
  }
  return { onList, assumed, hiddenStaples: staples.filter(Boolean) }
}
