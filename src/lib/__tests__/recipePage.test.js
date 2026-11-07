import { describe, it, expect, vi } from 'vitest'
import {
  checkPublicUrl, fetchPage, isPrivateAddress, makeCheckedLookup, readRecipePage, recipeFromBlock, recipeFromText,
  servingsFromYield, MAX_TEXT_CHARS,
} from '../../../api/_lib/recipePage.js'

// Reading the real recipe from a saved link (2026-11-06). Pages here are small
// stand-ins shaped like her real ones (no network in tests).

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

const BLOCK_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [{ '@type': 'WebPage' }, {
    '@type': ['Recipe'], name: 'Chicken Piccata', recipeYield: ['4', '4 servings'],
    recipeIngredient: ['2 large chicken breasts', '1/4 cup flour', '3 tablespoons capers &amp; brine'],
  }],
})}</script></head><body><p>Story…</p></body></html>`

// Like broccyourbody: no Recipe block, the list is plain text after a long story.
const STORY = Array.from({ length: 40 }, (_, i) =>
  `<p>Paragraph ${i}: we love this skillet, and a cup of coffee, and 2 tablespoons of patience in a long sentence that goes on.</p>`).join('')
const TEXT_PAGE = `<html><body><nav>Home Recipes</nav>${STORY}
<h3>Ingredients</h3><ul>
<li>2 tablespoons extra-virgin olive oil</li><li>1 yellow onion, diced</li>
<li>1 pound ground turkey</li><li>1 tablespoon chili powder</li>
<li>1 1/2 teaspoons ground cumin</li><li>Kosher salt</li></ul>
<h3>Instructions</h3><p>Heat the oil.</p>
<div class="comments"><p>Loved it!</p></div><script>var x = "1 cup sugar"</script></body></html>`

describe('which addresses may be opened', () => {
  it('private, local and metadata addresses are refused', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true)
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1']) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it('judged on the numbers, not the spelling (reviewer, 2026-11-07): hex-mapped, compat, NAT64, 6to4, Teredo', async () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '::127.0.0.1', '64:ff9b::7f00:1',
      '2002:7f00:1::', '2001::1', '2001:db8::1', 'ff02::1']) expect(isPrivateAddress(ip), ip).toBe(true)
    expect(isPrivateAddress('::ffff:5db8:d822')).toBe(false) // 93.184.216.34, mapped
    for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::127.0.0.1]/',
      'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/']) {
      expect(await checkPublicUrl(u, { lookup: publicLookup }), u).toBeNull()
    }
  })

  it('the connection itself refuses a private answer (a DNS answer that changes after the check)', async () => {
    const answers = { 'rebind.example': [{ address: '127.0.0.1', family: 4 }], 'ok.example': [{ address: '93.184.216.34', family: 4 }] }
    const lookup = makeCheckedLookup((host, _opts, cb) => cb(null, answers[host]))
    const call = (host, opts) => new Promise((resolve) => lookup(host, opts, (err, a, f) => resolve({ err, a, f })))
    expect((await call('rebind.example', {})).err.code).toBe('EPRIVATE')
    expect(await call('ok.example', {})).toEqual({ err: null, a: '93.184.216.34', f: 4 })
    expect((await call('ok.example', { all: true })).a).toEqual(answers['ok.example'])
  })

  it('only public http(s) web addresses on normal ports', async () => {
    expect(await checkPublicUrl('https://broccyourbody.com/x/', { lookup: publicLookup })).toBeTruthy()
    for (const bad of ['file:///etc/passwd', 'ftp://x.com/', 'http://localhost/', 'http://127.0.0.1/', 'http://foo.internal/',
      'https://user:pw@x.com/', 'https://x.com:8443/', 'not a url']) {
      expect(await checkPublicUrl(bad, { lookup: publicLookup }), bad).toBeNull()
    }
    // A public-looking name that points inside is refused too.
    expect(await checkPublicUrl('https://sneaky.example/', { lookup: async () => [{ address: '10.1.2.3' }] })).toBeNull()
  })
})

describe('fetchPage', () => {
  const html = (body, status = 200, headers = { 'content-type': 'text/html; charset=utf-8' }) =>
    new Response(body, { status, headers })

  it('a site that refuses is "blocked"; a redirect to a private address is "unsafe"', async () => {
    expect(await fetchPage('https://www.gimmesomeoven.com/x/', { lookup: publicLookup, fetchImpl: async () => html('no', 403) }))
      .toEqual({ reason: 'blocked' })
    const lookup = vi.fn(async (host) => (host === 'evil.example' ? [{ address: '169.254.169.254' }] : [{ address: '93.184.216.34' }]))
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/meta' } })
    expect(await fetchPage('https://ok.example/', { lookup, fetchImpl })).toEqual({ reason: 'unsafe' })
  })

  it('follows a safe redirect, and never asks fetch to follow on its own', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/new' } }))
      .mockResolvedValueOnce(html(BLOCK_PAGE))
    const out = await fetchPage('https://ok.example/old', { lookup: publicLookup, fetchImpl })
    expect(out.html).toContain('Chicken Piccata')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://ok.example/new')
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
  })

  it('network trouble is "unreachable"; a non-page (PDF) has no recipe', async () => {
    expect(await fetchPage('https://ok.example/', { lookup: publicLookup, fetchImpl: async () => { throw new Error('ECONNRESET') } }))
      .toEqual({ reason: 'unreachable' })
    expect(await fetchPage('https://ok.example/a.pdf', { lookup: publicLookup, fetchImpl: async () => html('%PDF', 200, { 'content-type': 'application/pdf' }) }))
      .toEqual({ reason: 'no_recipe' })
  })
})

describe('finding the recipe in a page', () => {
  it('a Recipe block gives the exact lines and yield (inside @graph, type as a list, entities decoded)', () => {
    const r = recipeFromBlock(BLOCK_PAGE)
    expect(r.servings).toBe(4)
    expect(r.text).toContain('Recipe: Chicken Piccata')
    expect(r.text).toContain('- 3 tablespoons capers & brine')
    expect(r.text).toContain('Yield: 4 / 4 servings') // the AI reads servings from this line
  })

  it('plain text: keeps the ingredient list, not the story, the scripts or the comments', () => {
    expect(recipeFromBlock(TEXT_PAGE)).toBeNull()
    const r = recipeFromText(TEXT_PAGE)
    expect(r.text).toContain('1 tablespoon chili powder')
    expect(r.text).toContain('1 1/2 teaspoons ground cumin')
    expect(r.text).not.toContain('Paragraph 3:')
    expect(r.text).not.toContain('1 cup sugar')
    expect(r.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS)
  })

  it('an absurd character code in a page is left as is (no crash)', () => {
    const page = BLOCK_PAGE.replace('2 large chicken breasts', '2 large chicken breasts &#99999999;')
    expect(recipeFromBlock(page).text).toContain('&#99999999;')
  })

  it('a page with no ingredient list finds nothing', () => {
    expect(recipeFromText('<html><body><p>About us. We make pasta.</p></body></html>')).toBeNull()
  })

  it('servings from a yield: the first number; never a silly one', () => {
    expect(servingsFromYield(['4', '4 servings'])).toBe(4)
    expect(servingsFromYield('YIELD — 4 servings')).toBe(4)
    expect(servingsFromYield('4 to 6 servings')).toBe(4)
    expect(servingsFromYield('about a dozen')).toBeNull()
    expect(servingsFromYield(null)).toBeNull()
  })

  it('readRecipePage: block first, then text, else says why', async () => {
    const page = (body) => async () => new Response(body, { headers: { 'content-type': 'text/html' } })
    expect(await readRecipePage('https://a.example/', { lookup: publicLookup, fetchImpl: page(BLOCK_PAGE) })).toMatchObject({ kind: 'block', servings: 4 })
    expect(await readRecipePage('https://b.example/', { lookup: publicLookup, fetchImpl: page(TEXT_PAGE) })).toMatchObject({ kind: 'text' })
    expect(await readRecipePage('https://c.example/', { lookup: publicLookup, fetchImpl: page('<p>hi</p>') })).toEqual({ kind: null, reason: 'no_recipe' })
    expect(await readRecipePage('http://localhost/', { lookup: publicLookup, fetchImpl: page(BLOCK_PAGE) })).toEqual({ kind: null, reason: 'unsafe' })
  })
})
