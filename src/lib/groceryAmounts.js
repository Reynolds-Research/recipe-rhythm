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
 *   addUpAmount('1 tbsp + 1 tsp')          → '4 tsp'    (one total, never "+")
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
  const total = addUpAmount(item?.recipe_quantity)
  if (!total || !measure(total)) return false
  return !sameAmount(item.quantity, total)
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

// ---------------------------------------------------------------------------
// Adding up "1 tbsp + 1 tsp"
// ---------------------------------------------------------------------------
// The grocery-list AI is asked for one consolidated total per item, but it
// sometimes joins the recipes' amounts with "+" instead ("1½ tsp + ½ tsp").
// addUpAmount does the arithmetic it skipped, the way a calculator checks a
// sum: only for amounts it can add for certain. Anything else comes back
// exactly as it was written — it never guesses.

const VOLUME_TSP = { tsp: 1, tbsp: 3, cup: 48 }
const WEIGHT_OZ = { oz: 1, lb: 16 }
const UNIT_WORDS = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
}
const VULGAR = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 }

/** "1½", "1 1/2", "½", "3/4", "1.5", "2" at the start of a part → [value, rest]. */
function leadingNumber(text) {
  const m = text.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?(?:\s*(\d+)\/(\d+))?(?=\s|$)/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  let n = m[1] ? Number(m[1]) : 0
  if (m[2]) n += VULGAR[m[2]]
  if (m[3]) {
    if (Number(m[4]) === 0) return null
    n += Number(m[3]) / Number(m[4])
  }
  return [n, text.slice(m[0].length).trim()]
}

// Words that mean a part isn't a plain amount: a range ("1 to 2 tsp", "2 tsp
// or to taste"), or a size/strength we can't add ("heaping", "scant").
const NOT_PLAIN = new Set(['to', 'or', 'and', 'heaping', 'heaped', 'scant', 'rounded', 'level', 'fl', 'pinch', 'dash', 'slice', 'can'])

/** A word that names a unit (in either list), allowing plurals ("cloves", "bunches"). */
function isUnitWord(w) {
  const stems = w.length > 3 ? [w, w.slice(0, -1), w.slice(0, -2)] : [w]
  return stems.some((s) => UNITS.has(s) || UNIT_WORDS[s] || NOT_PLAIN.has(s))
}

// Size and freshness words: "1 yellow onion" and "½ small onion" are the same
// thing (the grocery prompt's own rule), so these don't stop a count adding up.
const SIZE_WORDS = new Set(['small', 'medium', 'large', 'big', 'whole', 'fresh', 'yellow'])

/**
 * One part of a "+" amount → { n, kind: 'volume'|'weight'|'count', what }, or
 * null when it can't be added for certain. Strict on purpose: a part with a
 * second number ("1 lb 8 oz", "1 (15 oz) can"), a range, a short or unknown
 * unit ("1 T", "1 tbs"), "heaping" / "scant", or a store unit ("1 can",
 * "2 cloves") is left alone, because adding it would give a wrong number or
 * drop the unit.
 */
function readPart(part) {
  const lead = leadingNumber(part.trim())
  if (!lead) return null
  const [n, rest] = lead
  const words = rest.toLowerCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.some((w) => /\d|[½¼¾⅓⅔⅛⅜⅝⅞/-]/.test(w))) return null
  const unit = UNIT_WORDS[words[0]]
  const after = words.slice(1)
  if (unit) {
    // "2 tbsp, divided" is fine; "1 lb 8 oz" and "2 tsp or to taste" aren't.
    if (after.some(isUnitWord)) return null
    if (VOLUME_TSP[unit]) return { n: n * VOLUME_TSP[unit], kind: 'volume' }
    return { n: n * WEIGHT_OZ[unit], kind: 'weight' }
  }
  // A count: "2", "1 yellow onion", "½ small onion". Every word must be a
  // plain word (no units, no one- or two-letter abbreviations like "T").
  if (words.some((w) => w.length <= 2 || isUnitWord(w))) return null
  const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
  const noun = singular(words.at(-1) ?? '')
  const describe = words.slice(0, -1).map(singular).filter((w) => !SIZE_WORDS.has(w)).sort().join(' ')
  return { n, kind: 'count', what: { noun, describe } }
}

/** Is n a whole number of `step`s (allowing float noise)? */
function multipleOf(n, step) {
  const k = n / step
  return Math.abs(k - Math.round(k)) < 0.01
}

/** Teaspoons → "2 tsp", "1½ tbsp", "⅓ cup"; null when no tidy way to say it. */
function formatVolume(tsp) {
  const cups = tsp / 48
  if (cups >= 0.25 && (multipleOf(cups, 1 / 4) || multipleOf(cups, 1 / 3))) return `${toFraction(cups)} cup${cups > 1 ? 's' : ''}`
  const tbsp = tsp / 3
  if (tbsp >= 1 && tbsp <= 8 && multipleOf(tbsp, 1 / 2)) return `${toFraction(tbsp)} tbsp`
  if (tsp <= 6 && toFraction(tsp)) return `${toFraction(tsp)} tsp`
  return null
}

/** Ounces → "12 oz", "1½ lb"; null when no tidy way to say it. */
function formatWeight(oz) {
  const lb = oz / 16
  if (lb >= 1 && multipleOf(lb, 1 / 4)) return `${toFraction(lb)} lb`
  if (multipleOf(oz, 1 / 2) && toFraction(oz)) return `${toFraction(oz)} oz`
  return null
}

/**
 * "1½ tsp + ½ tsp" → "2 tsp"; "1 tbsp + 1 tsp" → "4 tsp";
 * "1 yellow onion + ½ small onion" → "1½"; "1 lb + 8 oz" → "1½ lb".
 * Mixed kinds ("1 can + 2 tbsp"), different things ("1 lemon + 1 lime") and
 * anything it can't read come back unchanged.
 */
export function addUpAmount(text) {
  if (typeof text !== 'string' || !text.includes('+')) return text ?? null
  const parts = text.split('+').map(readPart)
  if (parts.length < 2 || parts.some((p) => !p)) return text
  const kind = parts[0].kind
  if (parts.some((p) => p.kind !== kind)) return text
  const total = parts.reduce((sum, p) => sum + p.n, 0)
  if (kind === 'volume') return formatVolume(total) ?? text
  if (kind === 'weight') return formatWeight(total) ?? text
  // Counts add up only when every part names the same thing: same last word,
  // and the same describing words once sizes are set aside ("1 red onion +
  // 1 onion" stays as written).
  const names = new Set(parts.map((p) => `${p.what.describe}|${p.what.noun}`))
  if (names.size !== 1) return text
  return toFraction(total) ?? text
}
