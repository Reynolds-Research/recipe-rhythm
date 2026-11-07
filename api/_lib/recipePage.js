/**
 * recipePage.js — read the real recipe from the page a saved link points at.
 *
 * Mental model: a recipe link was only ever handed to the AI as a line of
 * text; nothing opened the page, so the AI guessed the amounts (her first real
 * week, 2026-11-06: chili powder 1 tsp on the list, 1 tbsp on the page). This
 * opens the page on the server and pulls out the part with the ingredients, so
 * analyze-recipe can COPY them, the way it copies from her screenshots.
 *
 * Two ways a page carries a recipe (tested 2026-11-06 from Vercel on her 23
 * saved links: 10 have a block, 6 only text, 7 refuse automated visits):
 *   1. a schema.org Recipe block (JSON-LD): the exact ingredient lines + yield.
 *   2. plain page text: we keep the stretch with the most amounts in it
 *      (usually right after an "Ingredients" heading), not the story or comments.
 *
 *   readRecipePage(url, { fetchImpl, lookup }) → { kind: 'block'|'text', text, servings }
 *                                               | { kind: null, reason }
 *   reasons: 'unsafe' (not a public web address), 'blocked' (the site refused),
 *            'unreachable', 'no_recipe'
 *
 * Safety: only http(s) on the normal ports, and only public addresses (never
 * this server, a private network or cloud metadata). Decided on the address's
 * numbers, not its spelling (so "[::ffff:7f00:1]" is 127.0.0.1); IPv6 must be
 * ordinary global unicast. The address is checked again at the moment of
 * connecting (the default fetch below hands Node a checked lookup), so a DNS
 * answer that changes between the check and the fetch can't slip through.
 * Each redirect is checked the same way. Pages: up to 3 MB, 15 s in all.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { lookup as dnsLookupCb } from 'node:dns'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 15_000 // the whole read, redirects included
const MAX_REDIRECTS = 3
/** How much page text goes to the AI. */
export const MAX_TEXT_CHARS = 6000

// --- Is it a public web address? -------------------------------------------

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number)
  if ([a, b].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                // multicast, reserved
}

/** An IPv6 address as its eight 16-bit groups (dotted IPv4 tails included). */
function ipv6Groups(ip) {
  let s = ip.toLowerCase().split('%')[0]
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number)
    s = s.slice(0, tail.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head, rest] = s.split('::')
  const h = head ? head.split(':') : []
  const r = rest !== undefined && rest ? rest.split(':') : []
  const fill = rest !== undefined ? 8 - h.length - r.length : 0
  const groups = [...h, ...Array(Math.max(fill, 0)).fill('0'), ...r].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null
}

/**
 * True for any address that isn't on the public internet. IPv4: the private,
 * loopback, link-local (cloud metadata), shared and reserved ranges. IPv6:
 * anything but ordinary global unicast (2000::/3), minus 6to4, Teredo and the
 * documentation range; an IPv4-mapped address is judged as its IPv4 address.
 */
export function isPrivateAddress(ip) {
  const v = isIP(ip)
  if (v === 4) return privateV4(ip)
  if (v === 6) {
    const g = ipv6Groups(ip)
    if (!g) return true
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return privateV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
    }
    if (g[0] < 0x2000 || g[0] > 0x3fff) return true            // not global unicast: ::, ::1, ::x, fc00::, fe80::, ff00::, 64:ff9b::
    if (g[0] === 0x2002) return true                           // 6to4 (embeds any IPv4)
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true // Teredo, documentation
    return false
  }
  return true
}

/**
 * A dns.lookup that refuses private answers: what the connection itself uses.
 * `resolve` is dns.lookup (injectable for tests).
 */
export function makeCheckedLookup(resolve = dnsLookupCb) {
  return function checkedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'function' ? {} : (options ?? {})
  resolve(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 4 }]
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const e = new Error(`refused private address for ${hostname}`)
      e.code = 'EPRIVATE'
      return cb(e)
    }
    if (opts.all) return cb(null, list)
    return cb(null, list[0].address, list[0].family)
  })
  }
}
const checkedLookup = makeCheckedLookup()

/**
 * The default fetch: Node http(s) with checkedLookup, no redirects followed,
 * body read up to MAX_BYTES. Returns { status, ok, headers: { get }, text() }.
 */
export function guardedFetch(href, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(href)
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, { method: 'GET', headers, lookup: checkedLookup, signal }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size <= MAX_BYTES) chunks.push(c)
        else res.destroy()
      })
      const done = () => {
        const body = Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8')
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v ?? null } },
          text: async () => body,
        })
      }
      res.on('end', done)
      res.on('close', done)
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/** The URL if it's safe to open, else null. */
export async function checkPublicUrl(raw, { lookup = dnsLookup } = {}) {
  let url
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal')) return null
  if (isIP(host)) return isPrivateAddress(host) ? null : url
  let addresses
  try { addresses = await lookup(host, { all: true }) } catch { return null }
  if (!addresses?.length || addresses.some((a) => isPrivateAddress(a.address))) return null
  return url
}

// --- Fetch -----------------------------------------------------------------

async function readCapped(res) {
  if (!res.body?.getReader) return (await res.text()).slice(0, MAX_BYTES)
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    chunks.push(value)
    if (size >= MAX_BYTES) { await reader.cancel().catch(() => {}); break }
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES))
}

/** → { html } or { reason } */
export async function fetchPage(raw, { fetchImpl = guardedFetch, lookup = dnsLookup } = {}) {
  let current = raw
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkPublicUrl(current, { lookup })
    if (!url) return { reason: 'unsafe' }
    let res
    try {
      res = await fetchImpl(url.href, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
        signal,
      })
    } catch (err) {
      return { reason: err?.code === 'EPRIVATE' ? 'unsafe' : 'unreachable' }
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) return { reason: 'unreachable' }
      current = new URL(next, url).href
      continue
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) return { reason: 'blocked' }
    if (!res.ok) return { reason: 'unreachable' }
    const type = res.headers.get('content-type') || ''
    if (type && !/html/i.test(type)) return { reason: 'no_recipe' }
    try {
      return { html: await readCapped(res) }
    } catch {
      return { reason: 'unreachable' }
    }
  }
  return { reason: 'unreachable' }
}

// --- Find the recipe in the page --------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&frac12;|&#189;/g, '½').replace(/&frac14;|&#188;/g, '¼').replace(/&frac34;|&#190;/g, '¾')
    .replace(/&#8211;|&ndash;/g, '–').replace(/&#(\d+);/g, (m, n) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : m))
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipeNode(n); if (r) return r }
    return null
  }
  const type = node['@type']
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node
  return node['@graph'] ? findRecipeNode(node['@graph']) : null
}

/** "4", "4 servings", "YIELD — 4 servings", ["4", "4 servings"] → 4; "4 to 6 servings" → 4. */
export function servingsFromYield(y) {
  for (const v of [].concat(y ?? [])) {
    const m = String(v).match(/\d+/)
    if (m) {
      const n = Number(m[0])
      if (n > 0 && n <= 50) return n
    }
  }
  return null
}

/** The page's schema.org Recipe block as text the AI can copy, or null. */
export function recipeFromBlock(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let recipe
    try { recipe = findRecipeNode(JSON.parse(m[1].trim())) } catch { continue }
    if (!recipe) continue
    const lines = [].concat(recipe.recipeIngredient ?? recipe.ingredients ?? [])
      .map((l) => decodeEntities(String(l)).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (!lines.length) continue
    const servings = servingsFromYield(recipe.recipeYield)
    const head = [recipe.name ? `Recipe: ${decodeEntities(String(recipe.name))}` : null,
      recipe.recipeYield ? `Yield: ${[].concat(recipe.recipeYield).join(' / ')}` : null].filter(Boolean)
    return { text: [...head, 'Ingredients:', ...lines.map((l) => `- ${l}`)].join('\n').slice(0, MAX_TEXT_CHARS), servings }
  }
  return null
}

/** Visible page text, one block element per line. */
export function pageLines(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h[1-6]|tr|ul|ol|section|article|header|footer|dt|dd)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * An ingredient line: short, and starts with an amount ("1 tablespoon chili
 * powder", "½ cup feta", "2 garlic cloves"). Story paragraphs that merely
 * mention "a cup of" are long, so they don't count.
 */
const INGREDIENT_LINE = /^(?:\d|[½¼¾⅓⅔⅛])/
export const isIngredientLine = (l) => l.length <= 150 && INGREDIENT_LINE.test(l)
const WINDOW = 60 // lines

/**
 * The stretch of page text with the ingredients: the window of lines with the
 * most ingredient lines, preferring one that starts at an "Ingredients"
 * heading. Null when the page has too few to be a recipe.
 */
export function recipeFromText(html) {
  const lines = pageLines(html)
  if (!lines.length) return null
  const heading = (l) => /^ingredients\b/i.test(l) && l.length < 40
  const starts = new Set()
  lines.forEach((l, i) => { if (heading(l)) starts.add(i) })
  for (let i = 0; i < lines.length; i += 5) starts.add(i)
  let best = null
  for (const i of starts) {
    const n = lines.slice(i, i + WINDOW).filter(isIngredientLine).length
    const score = n + (heading(lines[i]) ? 2 : 0)
    if (!best || score > best.score || (score === best.score && heading(lines[i]))) best = { i, score, n }
  }
  if (!best || best.n < 4) return null
  // Start a few lines before the first ingredient line (title, yield,
  // "Ingredients"), so a long story at the top of the window can't push the
  // list past the text limit.
  const first = lines.findIndex((l, k) => k >= best.i && isIngredientLine(l))
  const from = Math.max(best.i, first - 8)
  return { text: lines.slice(from, from + WINDOW).join('\n').slice(0, MAX_TEXT_CHARS), servings: null }
}

/** Open the link and find the recipe in it. */
export async function readRecipePage(url, deps = {}) {
  const page = await fetchPage(url, deps)
  if (!page.html) return { kind: null, reason: page.reason }
  const block = recipeFromBlock(page.html)
  if (block) return { kind: 'block', ...block }
  const text = recipeFromText(page.html)
  if (text) return { kind: 'text', ...text }
  return { kind: null, reason: 'no_recipe' }
}
