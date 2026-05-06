# Claude Code Prompt — PRD-003 P0.11 + P0.9 + P0.10: routing + share-link infra

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-05
**Linked PRD:** [`docs/prds/PRD-003-grocery-tracking.md`](../prds/PRD-003-grocery-tracking.md) §P0.11 + §P0.9 + §P0.10
**Bundled PR rationale:** P0.11 (routing) is an architectural prerequisite for P0.9 (public share route). P0.10 (revoke) is the inverse of P0.9 — they share the same UI surface. Shipping all three together avoids a half-built share affordance in any intermediate state.
**Depends on:**
- PRD-003 P0.1 shipped — `grocery_lists.share_token text UNIQUE` column exists. Anon-role RLS policies (`grocery_lists_public_share`, `grocery_list_items_public_share`) already allow public reads when `share_token IS NOT NULL`. **No migration in this PR.**
- PRD-003 P0.2 + P0.4 + P0.5 + P0.7 shipped — the in-app grocery list works end-to-end (generate, render, ad-hoc add). Phase D adds the share/revoke action on top.

---

## Why this exists

Today the grocery list is a single-user surface — the planner generates it, the planner sees it on their phone, and that's the whole interaction. The "share with my wife at the store" workflow has been falling back to screenshots and texts. PRD-003 has always intended a real share-link primitive: tap Share → get a public read-only URL → text it to the spouse → spouse opens it in any browser, no login.

The blocker has been that the app has no router. `App.jsx` uses `page` state + conditional rendering, so there's no `/share/grocery/:token` URL to send anyone to. The first public route is the right forcing function for adding `react-router-dom` (per PRD OQ.F's recommendation).

This PR does three things in one shot because they're tightly coupled:

1. **P0.11 — Routing.** Adds `react-router-dom`, defines `/` (main authenticated app) and `/share/grocery/:token` (public read-only view). Existing `page` state stays put — it lives inside the `/` route, unchanged. **Scope discipline:** we don't convert the bottom nav to `<NavLink>` in this PR; that's a separate refactor.
2. **P0.9 — Share-link.** Generates a `share_token` (`crypto.randomUUID()` — 128-bit random) on first share request, persists it to `grocery_lists.share_token`, surfaces a "copy link" affordance. Builds the public `SharedGroceryList` component that renders the same section-grouped list in read-only mode. Spouse check-off persists in `localStorage` keyed by token (per PRD — no sync to server, that's a P2 future).
3. **P0.10 — Revoke.** Inverse of P0.9. "Revoke link" sets `share_token = null`. Public route handles missing/invalid token with a "list closed" empty state.

DB schema is already in place — the P0.1 migration added the column, the public RLS policies, and the supporting indexes. The anon Supabase client already has the right key. This PR is purely a frontend + routing change plus a Vercel SPA fallback config.

Branch suggestion: `feat/prd-003-share-link`.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/prd-003-p0-11-9-10-share-link.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5

# Confirm STATUS.md still lists P0.9, P0.10, P0.11 as pending.
grep -E "P0\.(9|10|11)" docs/STATUS.md
```

If working tree isn't clean or any of P0.9/P0.10/P0.11 is already shipped, stop and surface to the user.

---

## Hard prerequisites — verify before writing any code

```bash
# 1. share_token column + public RLS policies exist.
#    Run via Supabase MCP (read-only):
#      SELECT column_name, data_type, is_nullable
#      FROM information_schema.columns
#      WHERE table_schema='public' AND table_name='grocery_lists'
#        AND column_name='share_token';
#    Expected: 1 row | data_type='text' | is_nullable='YES'
#
#      SELECT policyname FROM pg_policies
#      WHERE schemaname='public' AND tablename IN ('grocery_lists', 'grocery_list_items')
#        AND policyname LIKE '%public_share%';
#    Expected: 2 rows — grocery_lists_public_share, grocery_list_items_public_share

# 2. react-router-dom is NOT yet in package.json.
grep -n "react-router" package.json || echo "(not yet — that's correct)"

# 3. App.jsx still uses page-state routing.
grep -n "const \[page, setPage\]" src/App.jsx
# Expected: 1 match around line 17.

# 4. The single supabase client uses the anon key.
grep -n "VITE_SUPABASE_ANON_KEY" src/lib/supabase.js
# Expected: 1 match. The anon role is what the public RLS policies allow.

# 5. Check if vercel.json exists at the repo root.
ls vercel.json 2>/dev/null && echo "vercel.json exists — check rewrites" || echo "vercel.json missing — Step 4 will create it"
```

If any of these fail (especially #1 — if the column or policies are missing, the P0.1 migration didn't ship the way STATUS.md claims), **stop and ask the user**.

---

## Architectural decisions to lock in upfront

These are the calls that the PRD leaves to engineering. Don't deviate without surfacing first.

1. **Router library:** `react-router-dom` v7 (the current major). Matches the project's "claim-stack" of v7 in earlier docs.
2. **Router type:** `BrowserRouter` — clean URLs (`/share/grocery/abc123`), not hash-based. Requires the Vercel SPA rewrite (Step 4).
3. **Route table — minimal:**
   - `/` → the existing authenticated `App` component, unchanged. The `page` state inside it stays as-is.
   - `/share/grocery/:token` → new `SharedGroceryList` component. Public, no auth required.
   - **No other routes.** Don't migrate bottom-nav entries to `<NavLink>` in this PR. Don't add `/settings`, `/calendar`, etc. The TODOs in `App.jsx` flagging those conversions are for a future refactor — leaving them in place.
4. **Token format:** `crypto.randomUUID()` — produces a 36-char UUID v4 (128-bit random). Sufficient per PRD ("32+ random chars"). Browser-built-in; no library needed. Collision probability is astronomical, but the DB UNIQUE constraint is the safety net.
5. **Token generation location:** Client-side, in the share handler. We don't need an RPC — the authenticated user is doing the write through their own RLS-allowed UPDATE.
6. **Public read client:** Reuse the existing `src/lib/supabase.js` client. The anon key is what the `*_public_share` RLS policies expect; no second client needed. The public route just queries with `WHERE share_token = :token`.
7. **Spouse check-off persistence:** `localStorage`, keyed by `recipe-rhythm:share-checked:{token}`. Stores a JSON array of item IDs. **No server write from the spouse path.** This is the v1 simplification — sync is P2 future work. The note about `localStorage` being banned in some Claude.ai contexts does NOT apply here; this is shipped product code.
8. **Share UI:** New bottom sheet using `react-modal-sheet` (already in deps). Two states inside:
   - When `share_token IS NULL`: a "Generate share link" CTA.
   - When `share_token` is set: the URL in a read-only input + "Copy link" button + "Revoke link" button.
9. **Public route's "list closed" state:** Renders when the token query returns no rows (revoked, never existed, or typo'd). Non-alarming copy: "This list is no longer being shared. Ask the planner for a new link."
10. **Page transitions:** Don't add motion / animation. Just route swaps. Keep it boring.

---

## Implementation plan

Eight files change (plus three new files): the router setup, the public view, the share UI on the existing page, the Vercel config, and tests.

### Step 1 — Add the dependency

```bash
npm install react-router-dom@^7
```

Verify the install added `"react-router-dom": "^7.x.x"` under `dependencies` in `package.json`.

### Step 2 — Wire the router at the entry point

#### File: `src/main.jsx`

Replace the current contents:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import SharedGroceryList from './pages/SharedGroceryList.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
```

Two design notes:

- **`path="/*"` for App, not `path="/"`**. The wildcard catches everything that isn't an explicit route, so the existing in-app navigation continues to "work" even though it's still page-state-based. The user can navigate to `/whatever` and still see the app shell.
- **Public route comes first.** Specific paths must precede the wildcard or React Router never reaches the share route. Verify by hitting `/share/grocery/test123` after the change — it should render the SharedGroceryList component (which will show the "list closed" state because that token doesn't exist).

#### File: `src/App.jsx`

**Don't touch the page-state logic.** It stays exactly as it is. The only thing that changes here is removing the two TODO comments that referenced "when PRD-003 P0.11 ships react-router" — those TODOs are now outdated (we're choosing not to do that conversion in this PR; leave a single-line TODO instead noting it's deferred):

Find lines around 85 and 90:

```jsx
{/* TODO: Convert to /settings/preferences route when PRD-003 P0.11 ships react-router. */}
{page === 'settings' && (
  <Preferences userId={userId} />
)}
```

Replace the comment with:

```jsx
{/* TODO (post-PRD-003): convert page-state routing to <NavLink> + <Route>. PRD-003 P0.11 introduced react-router for the public share route only. */}
{page === 'settings' && (
  <Preferences userId={userId} />
)}
```

And update the matching comment around line 90 the same way (single TODO consolidated, or two with the same wording — your call). The point is the TODOs no longer claim "P0.11 will do it" — that's now historically inaccurate.

### Step 3 — Build the public read-only view

#### File: `src/pages/SharedGroceryList.jsx` (new)

```jsx
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, ShoppingCart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import { GROCERY_SECTIONS } from '../lib/constants'

/**
 * PRD-003 P0.9 — public read-only grocery list.
 *
 * Renders when an unauthenticated visitor hits /share/grocery/:token. Looks
 * up the list by share_token (the *_public_share RLS policies on
 * grocery_lists + grocery_list_items allow anon SELECT when share_token IS
 * NOT NULL). Renders the same section-grouped layout as the authenticated
 * GroceryListBody, with one v1 simplification: check-offs are persisted in
 * localStorage only — no DB write from the public path.
 *
 * Empty / closed states:
 *   - Token returns no rows → "This list is no longer being shared." (covers
 *     revoke, typo'd URL, never-existed.)
 *   - Token resolves to a list with zero items → "This list is empty."
 *
 * No auth flow, no sign-in CTA — the spouse should never see one.
 */

const STORAGE_PREFIX = 'recipe-rhythm:share-checked:'

function loadChecked(token) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + token)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveChecked(token, set) {
  try {
    localStorage.setItem(STORAGE_PREFIX + token, JSON.stringify([...set]))
  } catch {
    // Quota / disabled storage. Non-fatal — checks just won't persist
    // across reloads in that one browser. The list itself still renders.
  }
}

export default function SharedGroceryList() {
  const { token } = useParams()
  const [loading, setLoading]   = useState(true)
  const [list, setList]         = useState(null)   // null = not found / closed
  const [items, setItems]       = useState([])
  const [checked, setChecked]   = useState(() => new Set())

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    setChecked(loadChecked(token))

    let cancelled = false
    ;(async () => {
      // 1. Resolve the list by token (anon SELECT allowed by RLS).
      const { data: listRow, error: listErr } = await supabase
        .from('grocery_lists')
        .select('id')
        .eq('share_token', token)
        .maybeSingle()

      if (cancelled) return
      if (listErr || !listRow) {
        setList(null)
        setLoading(false)
        return
      }
      setList(listRow)

      // 2. Fetch items for that list (anon SELECT allowed by RLS).
      const { data: itemRows, error: itemsErr } = await supabase
        .from('grocery_list_items')
        .select('id, name, quantity, section')
        .eq('list_id', listRow.id)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (itemsErr) {
        console.error('[SharedGroceryList] items fetch failed:', itemsErr.message)
        setItems([])
      } else {
        setItems(itemRows ?? [])
      }
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [token])

  const toggle = (id) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveChecked(token, next)
      return next
    })
  }

  if (loading) {
    return (
      <div className="mobile-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="mobile-screen pb-28">
        <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
          <Logo className="w-8 h-8 mb-2" />
          <p className="text-lg text-gray-900 mt-1 font-serif italic">Grocery List</p>
        </div>
        <div className="px-5 py-16 text-center space-y-2">
          <ShoppingCart size={32} className="mx-auto text-gray-500" />
          <p className="body-text">This list is no longer being shared.</p>
          <p className="helper-text">Ask the planner for a new link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">Grocery List</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">For My Wife</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {items.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <ShoppingCart size={32} className="mx-auto text-gray-500" />
            <p className="body-text">This list is empty.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {GROCERY_SECTIONS.map(section => {
              const sectionItems = items.filter(i => i.section === section)
              if (sectionItems.length === 0) return null
              return (
                <section key={section}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="section-heading">{section}</p>
                    <div className="flex-1 h-px bg-cream-200" />
                  </div>
                  <ul className="space-y-2">
                    {sectionItems.map(item => {
                      const isChecked = checked.has(item.id)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => toggle(item.id)}
                            aria-pressed={isChecked}
                            className="flex items-baseline justify-between gap-3 py-1 w-full text-left"
                          >
                            <span className={`body-text ${isChecked ? 'line-through text-gray-400' : ''}`}>
                              {item.name}
                            </span>
                            {item.quantity && (
                              <span className={`helper-text shrink-0 ${isChecked ? 'line-through text-gray-400' : ''}`}>
                                {item.quantity}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

Three things worth noting in this component:

1. **`maybeSingle()` instead of `single()`** for the list lookup — `single()` throws when 0 rows; `maybeSingle()` resolves to `null`. The "list closed" state IS a 0-row response, so we need the non-throwing variant.
2. **localStorage is wrapped in try/catch.** Some browsers (private mode, some embedded browsers) throw on `setItem`. The list still renders even if persistence fails — the spouse just loses checks across reloads.
3. **No auth check, no `userId`.** The component is intentionally unaware of authentication. RLS does the gatekeeping; the app trusts it.

### Step 4 — Vercel SPA fallback

For `BrowserRouter` to work in production, Vercel needs to serve `index.html` for any non-API path that doesn't match a static asset.

#### File: `vercel.json` (check first; create if missing)

```bash
test -f vercel.json && cat vercel.json
```

If the file exists, look at the `rewrites` (or `routes`) section. If there's already a catch-all to `index.html`, you're done with Step 4. If not, add one.

If the file doesn't exist, create it with:

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)",     "destination": "/index.html" }
  ]
}
```

The first rule preserves the existing `api/*` serverless functions; the second sends everything else to the SPA. Order matters — the API rule must come first.

> **If `vercel.json` already exists with a different shape (e.g. uses `routes` instead of `rewrites`), don't replace it wholesale.** Add the catch-all in the same shape as the existing rules. Surface the existing config to the user before editing if you're not sure how it composes with the catch-all.

### Step 5 — Add the share UI to GroceryListBody

#### File: `src/pages/GroceryList/GroceryListBody.jsx`

Three additions:

1. New state: `shareSheetOpen`, `shareToken` (the persisted token), `revokeBusy`.
2. New handlers: `handleOpenShare`, `handleGenerateShareLink`, `handleRevokeShareLink`, `handleCopyLink`.
3. New UI: a "Share" button next to the existing "Regenerate" button + a `react-modal-sheet` panel that reads either "generate link" or "active link + revoke" depending on `shareToken`.

#### 5a. State + the load path

In `loadList` (where the page already fetches the list row), extend the SELECT to also fetch `share_token`:

```jsx
async function loadList(planId) {
  const { data: listRow, error: listErr } = await supabase
    .from('grocery_lists')
    .select('id, created_at, share_token')   // ← add share_token
    .eq('user_id', userId)
    .eq('meal_plan_id', planId)
    .maybeSingle()
  // ...
  if (!listRow) {
    setItems([])
    setListId(null)
    setShareToken(null)                       // ← new
    return
  }
  setListId(listRow.id)
  setShareToken(listRow.share_token ?? null)  // ← new
  // ...
}
```

Add the new state next to `listId`:

```jsx
const [shareToken, setShareToken]     = useState(null)
const [shareSheetOpen, setShareSheetOpen] = useState(false)
const [shareBusy, setShareBusy]       = useState(false)   // covers both generate + revoke
```

#### 5b. Handlers

Add these just below `handleAddAdhoc`:

```jsx
const shareUrl = shareToken
  ? `${window.location.origin}/share/grocery/${shareToken}`
  : null

async function handleGenerateShareLink() {
  if (!listId || shareBusy) return
  setShareBusy(true)
  setError(null)
  try {
    const newToken = crypto.randomUUID()
    const { error: updErr } = await supabase
      .from('grocery_lists')
      .update({ share_token: newToken })
      .eq('id', listId)
    if (updErr) throw updErr
    setShareToken(newToken)
  } catch (err) {
    console.error('[GroceryList] handleGenerateShareLink:', err)
    setError('Could not create share link. Please try again.')
  } finally {
    setShareBusy(false)
  }
}

async function handleRevokeShareLink() {
  if (!listId || shareBusy) return
  setShareBusy(true)
  setError(null)
  try {
    const { error: updErr } = await supabase
      .from('grocery_lists')
      .update({ share_token: null })
      .eq('id', listId)
    if (updErr) throw updErr
    setShareToken(null)
  } catch (err) {
    console.error('[GroceryList] handleRevokeShareLink:', err)
    setError('Could not revoke share link. Please try again.')
  } finally {
    setShareBusy(false)
  }
}

async function handleCopyLink() {
  if (!shareUrl) return
  try {
    await navigator.clipboard.writeText(shareUrl)
  } catch {
    // Some browsers (older Safari, embedded webviews) reject clipboard
    // writes outside a user-initiated context. The button is itself a click
    // so this is rare, but if it happens we fall back gracefully — the URL
    // is visible in a read-only input the user can long-press to copy.
    console.warn('[GroceryList] clipboard write blocked')
  }
}
```

The `crypto.randomUUID()` call works in every browser the app already targets (it's part of the React 19-era baseline). No polyfill needed.

#### 5c. Share button + sheet

In the `items.length > 0` block, add a Share button next to Regenerate:

```jsx
<div className="flex gap-2">
  <button
    onClick={handleGenerate}
    disabled={generating}
    className="btn-secondary flex-1"
  >
    {generating
      ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Generating…
        </span>
      )
      : 'Regenerate'
    }
  </button>
  <button
    onClick={() => setShareSheetOpen(true)}
    className="btn-primary flex-1"
  >
    {shareToken ? 'Share link active' : 'Share with…'}
  </button>
</div>
```

At the bottom of the component (just before the final closing `</>`), add the sheet:

```jsx
<Sheet
  isOpen={shareSheetOpen}
  onClose={() => setShareSheetOpen(false)}
  detent="content-height"
>
  <Sheet.Container>
    <Sheet.Header />
    <Sheet.Content>
      <div className="px-5 pb-8 space-y-4">
        <p className="section-heading">Share this list</p>

        {shareToken ? (
          <>
            <p className="helper-text">
              Anyone with this link can see the list, check items off (just for them, not synced back), and follow updates if you regenerate.
            </p>
            <input
              type="text"
              value={shareUrl ?? ''}
              readOnly
              onFocus={(e) => e.target.select()}
              aria-label="Share link"
              className="input-base"
            />
            <div className="flex gap-2">
              <button onClick={handleCopyLink} className="btn-primary flex-1">
                Copy link
              </button>
              <button
                onClick={handleRevokeShareLink}
                disabled={shareBusy}
                className="btn-secondary flex-1"
              >
                {shareBusy ? <Loader2 size={16} className="animate-spin" /> : 'Revoke'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="helper-text">
              Generate a link to share this list with someone. They'll see a read-only version — no login required.
            </p>
            <button
              onClick={handleGenerateShareLink}
              disabled={shareBusy}
              className="btn-primary"
            >
              {shareBusy
                ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Creating…</span>
                : 'Generate share link'
              }
            </button>
          </>
        )}
      </div>
    </Sheet.Content>
  </Sheet.Container>
  <Sheet.Backdrop onTap={() => setShareSheetOpen(false)} />
</Sheet>
```

Add the import at the top (named, NOT default — see CLAUDE.md gotcha #1):

```jsx
import { Sheet } from 'react-modal-sheet'
```

> **Don't auto-close the sheet after generate.** The user just created the link; their next action is "copy" or "show my spouse" — which both happen IN the sheet. They'll close it themselves. Auto-close would force a re-open round-trip.

### Step 6 — Tests

Three test files change.

#### `src/pages/__tests__/SharedGroceryList.test.jsx` (new)

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SharedGroceryList from '../SharedGroceryList'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))
import { supabase } from '../../lib/supabase'

function renderWithToken(token) {
  return render(
    <MemoryRouter initialEntries={[`/share/grocery/${token}`]}>
      <Routes>
        <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
      </Routes>
    </MemoryRouter>
  )
}

function listLookupChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}
function itemsLookupChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockResolvedValue(result),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Make sure each test starts with a clean localStorage.
  localStorage.clear()
})

describe('SharedGroceryList — public read-only view (PRD-003 P0.9)', () => {
  it('renders the section-grouped list when the token resolves', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [
          { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
          { id: 'i-2', name: 'Milk',    quantity: null, section: 'Other' },
        ],
        error: null,
      }))

    renderWithToken('valid-token')

    await waitFor(() => screen.getByText('Carrots'))
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.getByText('Produce')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('shows the "list closed" state when the token returns no rows', async () => {
    supabase.from.mockReturnValueOnce(
      listLookupChain({ data: null, error: null })
    )
    renderWithToken('revoked-token')

    await waitFor(() =>
      expect(screen.getByText(/no longer being shared/i)).toBeInTheDocument()
    )
  })

  it('shows the "list closed" state when the lookup errors', async () => {
    supabase.from.mockReturnValueOnce(
      listLookupChain({ data: null, error: { message: 'rls denied' } })
    )
    renderWithToken('bad-token')

    await waitFor(() =>
      expect(screen.getByText(/no longer being shared/i)).toBeInTheDocument()
    )
  })

  it('shows the empty state when the list resolves but has zero items', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({ data: [], error: null }))

    renderWithToken('empty-list-token')

    await waitFor(() =>
      expect(screen.getByText(/this list is empty/i)).toBeInTheDocument()
    )
  })

  it('tapping an item toggles its strikethrough and persists to localStorage', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [{ id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' }],
        error: null,
      }))

    renderWithToken('check-token')

    const button = await screen.findByRole('button', { name: /Carrots/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.setup().click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')

    const stored = JSON.parse(
      localStorage.getItem('recipe-rhythm:share-checked:check-token') ?? '[]'
    )
    expect(stored).toEqual(['i-1'])
  })

  it('reads existing localStorage state on mount (checks survive a reload)', async () => {
    localStorage.setItem(
      'recipe-rhythm:share-checked:reload-token',
      JSON.stringify(['i-1'])
    )
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [{ id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' }],
        error: null,
      }))

    renderWithToken('reload-token')

    const button = await screen.findByRole('button', { name: /Carrots/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
```

#### `src/pages/GroceryList/__tests__/GroceryListBody.test.jsx`

Add a new `describe` block at the bottom for share/revoke. Reuse the existing chain helpers; add one new helper for the update chain:

```jsx
function updateChain(result = { error: null }) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('PRD-003 P0.9 / P0.10 — share + revoke', () => {
  function setupExistingListWithToken(token, items = []) {
    // loadList: existing list, with or without share_token
    supabase.from
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05', share_token: token },
        error: null,
      }))
      .mockReturnValueOnce(itemRowsChain({ data: items, error: null }))
  }

  it('Share button shows "Share with…" when no token, opens sheet to a Generate CTA', async () => {
    setupExistingListWithToken(null, [
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    render(<GroceryListBody userId="user-1" />)

    const shareBtn = await screen.findByRole('button', { name: /Share with/i })
    await userEvent.setup().click(shareBtn)

    expect(screen.getByRole('button', { name: /Generate share link/i })).toBeInTheDocument()
  })

  it('Share button shows "Share link active" when a token exists, opens sheet to Copy + Revoke', async () => {
    setupExistingListWithToken('abc123', [
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    render(<GroceryListBody userId="user-1" />)

    const shareBtn = await screen.findByRole('button', { name: /Share link active/i })
    await userEvent.setup().click(shareBtn)

    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revoke/i })).toBeInTheDocument()
  })

  it('Generate share link writes a UUID to share_token and updates state', async () => {
    setupExistingListWithToken(null, [
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    const upd = updateChain()
    supabase.from.mockReturnValueOnce(upd)

    // crypto.randomUUID is part of jsdom in newer versions; if your test env
    // doesn't have it, stub it before this test and restore after.
    const stubbed = vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid-1234')

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Share with/i }))
    await user.click(screen.getByRole('button', { name: /Generate share link/i }))

    await waitFor(() => expect(upd.update).toHaveBeenCalledWith({ share_token: 'test-uuid-1234' }))
    // Sheet should now show the active-link state (Copy + Revoke present).
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()

    stubbed.mockRestore()
  })

  it('Revoke nulls share_token and returns the sheet to the Generate state', async () => {
    setupExistingListWithToken('abc123', [
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    const upd = updateChain()
    supabase.from.mockReturnValueOnce(upd)

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Share link active/i }))
    await user.click(screen.getByRole('button', { name: /Revoke/i }))

    await waitFor(() => expect(upd.update).toHaveBeenCalledWith({ share_token: null }))
    expect(screen.getByRole('button', { name: /Generate share link/i })).toBeInTheDocument()
  })
})
```

> **`react-modal-sheet` is mocked globally in `src/setupTests.js` per `CLAUDE.md`** — `Sheet` is exported as a NAMED export. The existing test setup already handles this; you don't need to add new mocks for it.

#### `src/__tests__/routing.test.jsx` (new)

Sanity check the router itself:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import App from '../App'
import SharedGroceryList from '../pages/SharedGroceryList'

// We don't want App to actually try to bootstrap the auth session in a
// router unit test. Stub the supabase client to return a null session.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(),
  },
}))

describe('Routing (PRD-003 P0.11)', () => {
  it('/ renders the App shell (auth gate when signed out)', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    // Auth gate component renders when there's no session — sanity check
    // by looking for the loader OR an Auth-related node. Match what the
    // Auth/loading state actually renders in your codebase.
    // Pick the most stable selector after looking at App.jsx briefly.
    expect(await screen.findByRole('progressbar')).toBeTruthy()
    // (If there's no progressbar role, fall back to a known-stable text
    // node from <Auth /> or the loading state.)
  })

  it('/share/grocery/:token renders the SharedGroceryList component', () => {
    render(
      <MemoryRouter initialEntries={['/share/grocery/test123']}>
        <Routes>
          <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    // SharedGroceryList renders a loader before the supabase fetch resolves;
    // its absence here would mean the router resolved to App instead.
    // Use whatever stable element SharedGroceryList shows on first paint.
    expect(screen.getByText(/Grocery List/i)).toBeInTheDocument()
  })
})
```

> **Adjust the App-render assertion to match what the Auth-loading state actually renders.** If you find no `progressbar` role, fall back to whatever stable text the loading or `<Auth />` component shows. The point of this test is to confirm the router wires `/` → `App`, not to assert auth behavior.

---

## Step 7 — STATUS.md update

In the same PR, update `docs/STATUS.md`:

1. **Top of file:** bump the `**Last verified:**` line to today's date and the latest commit hash on `main` (post-merge — set this just before pushing the final commit, or update in a follow-up if needed).
2. **At-a-glance table** (PRD-003 row): "Overall status" stays 🟡 (P1 polish remains). "Next thing to plan" — drop the share-link entries: change `Ad-hoc add (P0.7), share-link infra (P0.9–P0.11)` to `P1 polish (auto-regenerate prompt, individual-item edit, plain-text export, custom section order, source-recipe captions, staple override)`.
3. **PRD-003 section:**
   - Move P0.9, P0.10, P0.11 from "In progress / pending" to "Shipped":
     ```
     - [x] **P0.11 + P0.9 + P0.10** (PR #<your-PR>, commit `<hash>`): added `react-router-dom` v7 with two routes — `/` (existing app) and `/share/grocery/:token` (public read-only view). Share button on the grocery list opens a bottom sheet that generates a `crypto.randomUUID()` token, stores it on `grocery_lists.share_token`, and offers copy / revoke. Public route uses the same supabase client (anon key + existing public-share RLS policies) and persists spouse-side check-offs in localStorage keyed by token. Vercel SPA rewrite added so non-API paths fall through to `/index.html`. Bottom-nav-to-NavLink conversion deferred — out of scope for this PR.
     ```
   - The remaining "In progress / pending" entries (all P1 polish) stay.
4. **Cross-cutting — Information Architecture** section:
   - Move "Remove the `page === 'grocery'` branch from `App.jsx`" status update (still pending — this PR does NOT remove that branch). No edit needed unless you find drift.

---

## Step 8 — Branch + commit + PR

```bash
git fetch origin
git checkout -b feat/prd-003-share-link origin/main

# Step 1: install the dep.
npm install react-router-dom@^7

# Steps 2–7: make the edits.

npm run test:unit
npm run lint
npm run lint:ds

git add package.json package-lock.json \
        src/main.jsx \
        src/App.jsx \
        src/pages/SharedGroceryList.jsx \
        src/pages/__tests__/SharedGroceryList.test.jsx \
        src/pages/GroceryList/GroceryListBody.jsx \
        src/pages/GroceryList/__tests__/GroceryListBody.test.jsx \
        src/__tests__/routing.test.jsx \
        vercel.json \
        docs/STATUS.md

git commit
git push -u origin feat/prd-003-share-link
```

### Suggested commit message

```
feat(prd-003): share-link infrastructure (P0.11 + P0.9 + P0.10)

Bundles three PRD-003 phase items because they're tightly coupled:
P0.11 (routing) is a hard prerequisite for P0.9 (public route);
P0.10 (revoke) shares a UI surface with P0.9.

- Adds react-router-dom v7. Two routes: '/' (existing App, page-state
  routing inside it preserved) and '/share/grocery/:token' (public
  read-only view).
- src/pages/SharedGroceryList.jsx (new): renders the section-grouped
  list for unauthenticated visitors. Anon-role RLS policies from the
  P0.1 migration allow the SELECT. Spouse check-off persists in
  localStorage keyed by token.
- src/pages/GroceryList/GroceryListBody.jsx: adds a Share button that
  opens a bottom sheet (react-modal-sheet, already in deps). Generate
  uses crypto.randomUUID() and writes share_token. Revoke sets it to
  NULL. Copy link uses navigator.clipboard.
- vercel.json: SPA rewrite so /share/grocery/* falls through to
  index.html for client-side routing.

No DB migration — the P0.1 migration shipped the share_token column
and the public_share RLS policies. This PR is the first writer that
sets share_token to a non-null value.

Out of scope, intentionally:
- Bottom-nav <NavLink> conversion (TODO updated, deferred).
- Server-side spouse check-off sync (P2 future per PRD).
- Token TTL / auto-expire (PRD OQ.D recommends revoke-only).
```

### Suggested PR description

```markdown
## Why

PRD-003's share-link work has been blocked on the app having no router. `App.jsx` uses `page` state + conditional rendering, so there's no `/share/grocery/:token` URL to send anyone to. The first public route is the right forcing function for adding `react-router-dom` (per PRD OQ.F).

This PR ships the share infrastructure end-to-end:
1. `react-router-dom` + minimal route table (`/` and `/share/grocery/:token`).
2. Public read-only view rendered when an unauthenticated visitor opens the share URL.
3. Share + Revoke UI on the existing grocery list page.
4. Vercel SPA rewrite so `/share/grocery/*` doesn't 404 before React boots.

## What

- **Dependency:** `react-router-dom@^7`.
- **`src/main.jsx`:** wraps `<App />` in `<BrowserRouter>` + `<Routes>`. Public route comes first; `/*` catch-all routes to the existing App.
- **`src/pages/SharedGroceryList.jsx` (new):** queries the list by token via the anon-key supabase client (RLS policies allow it). Renders the same section-grouped layout as `GroceryListBody`, read-only. Spouse check-off in `localStorage` keyed by `recipe-rhythm:share-checked:{token}`. "List closed" state when the token resolves to no rows.
- **`src/pages/GroceryList/GroceryListBody.jsx`:** new Share button + bottom sheet. Generate uses `crypto.randomUUID()` (128-bit). Revoke nulls `share_token`. Copy uses `navigator.clipboard`.
- **`vercel.json`:** rewrites all non-API paths to `index.html`.
- **`src/App.jsx`:** unchanged behavior. Two TODO comments updated to reflect that the nav-to-NavLink conversion is deferred.

## What's NOT in this PR

- **Bottom-nav conversion to `<NavLink>`.** TODOs in `App.jsx` were updated to reflect the deferral. This is intentional scope discipline — the share route is the load-bearing requirement.
- **Server-side spouse check-off sync.** PRD §11 lists this as P2 future. v1 is localStorage-only on the spouse side.
- **Share-token TTL / auto-expire.** PRD OQ.D recommends revoke-only; this PR follows that.
- **A separate anon supabase client.** The existing client uses the anon key, which is exactly what the public-share RLS policies allow. No second client needed.
- **Removal of the legacy `page === 'grocery'` branch in `App.jsx`.** STATUS.md tracks that as a separate post-IA-cleanup follow-up.

## Schema

No schema change. The `share_token` column and the `*_public_share` RLS policies have been on `grocery_lists` and `grocery_list_items` since [the P0.1 migration](../supabase/migrations/20260502000001_grocery_lists_schema.sql). This PR is the first writer to set `share_token` to a non-null value.

## MCP verification

- **Supabase MCP (read-only):**
  - Confirmed `share_token text UNIQUE` column on `grocery_lists` (data_type=text, is_nullable=YES). ✅
  - Confirmed `grocery_lists_public_share` and `grocery_list_items_public_share` policies exist in `pg_policies`. ✅
  - After deploy, ran `SELECT id FROM grocery_lists WHERE share_token IS NOT NULL` (anon-impersonation via the dashboard) to confirm anon SELECT works as expected.
- **Vercel MCP:** preview deploy URL `<paste here>`. Smoke test below. Ran build-log inspection to confirm `react-router-dom` resolves cleanly in the production bundle.

## Smoke test

1. Sign in as the test user (creds in `.claude/test-credentials.md`).
2. Open Prep Table → Groceries on a served plan with items. Tap **Share with…**. Sheet opens with "Generate share link" CTA.
3. Tap Generate. Sheet flips to show the URL + Copy + Revoke. Tap Copy → confirm browser clipboard contains the URL.
4. Open the URL in a private/incognito window. Confirm:
   - Same section-grouped list renders.
   - No login prompt.
   - Tap an item → strikethrough toggles. Reload → strikethrough persists.
   - Open the URL on a different device/browser → its strikethroughs are independent (localStorage is per-device).
5. Back in the authenticated app, open the share sheet again → tap **Revoke**. Sheet flips back to "Generate share link" state.
6. Reload the public URL in the incognito tab → "This list is no longer being shared." renders.
7. Generate a new link → confirm a new UUID, different from the revoked one.
8. Try opening `/share/grocery/garbage-token` directly → "list closed" state renders cleanly (not a 404 from Vercel — the rewrite handles it).
9. Pull runtime logs from the preview deploy via MCP. Confirm no `[GroceryList] handleGenerateShareLink:` or `[SharedGroceryList]` errors.
```

---

## Smoke test (post preview deploy)

The 9-step list above. The five things to verify visually:

1. **Generate flips the button label** from "Share with…" to "Share link active" without a re-render glitch.
2. **The URL renders in a copyable input** that selects-on-focus.
3. **The public URL works in an incognito window** — proves RLS policies do what we expect.
4. **Revoke makes the same URL show "list closed"** — proves the column is actually nulled and the public read sees it.
5. **Vercel doesn't 404 on direct deep links** to `/share/grocery/anything` — proves the SPA rewrite is in place.

Report findings in the PR description before requesting review.

---

## Known gotchas

1. **`crypto.randomUUID()` requires a secure context.** Works in production over HTTPS and on `localhost`. On a non-localhost HTTP origin (e.g. preview-deploy URL on plain HTTP, which Vercel doesn't serve but worth noting), `crypto.randomUUID is not a function`. Vercel always serves HTTPS, so this is fine for prod and previews — but worth knowing if anyone tries to test from a custom-domain HTTP redirect.

2. **`react-modal-sheet` import shape.** Use `import { Sheet } from 'react-modal-sheet'` — NAMED, not default. CLAUDE.md gotcha #1 calls this out specifically because the default-import form may work in dev but breaks in prod. The existing `setupTests.js` global mock exports `Sheet` as a named export — match that.

3. **Don't migrate the bottom-nav `setPage` calls to `<NavLink>` in this PR.** The TODOs in `App.jsx` are inviting, but every nav route conversion is its own surface to test. PRD-003 only requires the share route. If you do this here, the PR doubles in size and the test surface explodes. Update the TODO comments to reflect the deferral, but leave the actual conversion alone.

4. **The Vercel SPA rewrite is mandatory.** Without it, `/share/grocery/abc123` returns a 404 from Vercel's edge before React ever sees the URL. Verify the `vercel.json` change shows up in the preview deploy (the rewrite is per-deployment, not retroactively applied).

5. **`maybeSingle()`, not `single()`** for the public list lookup. `single()` throws on 0 rows; we want the "list closed" state to be a clean null, not an exception.

6. **Don't introduce a second supabase client for the public route.** The existing client uses the anon key — that's exactly what `grocery_lists_public_share` RLS expects. A second client adds complexity without security benefit. The token in the URL is what gates access, not a different client.

7. **Revoke is irreversible from the user's perspective even though the column is just nulled.** Each new "Generate share link" creates a *new* random UUID — the revoked one is gone forever. Make sure the helper text in the sheet conveys "this link will be the same for as long as it exists; revoking ends it" rather than implying the link is regenerable. The current copy ("They'll see a read-only version — no login required.") is fine; don't add a "you can re-share later with the same link" note that would be misleading.

8. **Don't fix unrelated lint or test errors while doing this work.** Note them as follow-ups in the PR description.

9. **The `localStorage` rule from artifact-creation guidance does NOT apply here.** Some Claude Code project rules ban `localStorage` in claude.ai HTML artifacts because it doesn't work in that sandbox. This is shipped product code in a real browser; `localStorage` is the right primitive for the spouse-side check-off per PRD §11.

---

## When done

Report back with:

- The PR URL.
- Confirmation that the prerequisite Supabase queries returned the expected schema + policies.
- Vercel preview deploy URL + status. Build log excerpt confirming `react-router-dom` resolved cleanly.
- Smoke-test findings (the 9-step list above — pay particular attention to step 4's incognito verification, which is the load-bearing public-RLS check).
- Confirmation that STATUS.md got updated in the same PR.
- Any drift you noticed between the prompt and the actual codebase (renamed files, different existing patterns, etc.) — better to surface than to silently work around.

If anything in the prompt doesn't match the codebase (a renamed file, a different existing pattern, the share_token column missing, the RLS policies not in place), stop and ask the user. The CLAUDE.md "When in doubt" rule applies.
