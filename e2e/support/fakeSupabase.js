/**
 * A small STATEFUL fake of Supabase's REST API (PostgREST) for Playwright.
 *
 * The other E2E specs answer each request with a canned response, which can't
 * follow a plan across several days: the app writes a plan, then reads it back
 * tomorrow. This fake keeps tables in memory, so writes are visible to later
 * reads — including after page reloads — and it enforces the one database rule
 * the planner depends on: two meal_plans for the same user may not overlap
 * (the real `meal_plans_no_period_overlap` EXCLUDE constraint → error 23P01).
 *
 * It only understands the query shapes this app sends (eq/neq/gt/gte/lt/lte,
 * is.null, not.is.null, in.(), order, limit, single/maybeSingle, insert,
 * upsert, update, delete). Anything else fails loudly (HTTP 500 + a log entry)
 * so a test can't quietly pass against a wrong fake.
 */

import { randomUUID } from 'node:crypto'

const USER = { id: 'test-user', email: 'test@example.com' }

export function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDaysYmd(isoYmd, n) {
  const [y, m, d] = isoYmd.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}

// --- PostgREST filter parsing ----------------------------------------------

function parseValue(raw) {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

function makeFilter(col, expr) {
  let negate = false
  if (expr.startsWith('not.')) {
    negate = true
    expr = expr.slice(4)
  }
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const raw = expr.slice(dot + 1)
  const present = (v) => v !== null && v !== undefined
  let test
  switch (op) {
    case 'eq': test = (v) => v === parseValue(raw) || String(v) === raw; break
    case 'neq': test = (v) => !(v === parseValue(raw) || String(v) === raw); break
    case 'gt': test = (v) => present(v) && String(v) > raw; break
    case 'gte': test = (v) => present(v) && String(v) >= raw; break
    case 'lt': test = (v) => present(v) && String(v) < raw; break
    case 'lte': test = (v) => present(v) && String(v) <= raw; break
    case 'is': {
      const want = parseValue(raw)
      test = (v) => (want === null ? !present(v) : v === want)
      break
    }
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))
      test = (v) => list.includes(String(v))
      break
    }
    default:
      throw new Error(`unsupported filter operator "${op}" on ${col}`)
  }
  return (row) => (negate ? !test(row[col]) : test(row[col]))
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function parseQuery(url) {
  const filters = []
  let order = []
  let limit = null
  let onConflict = null
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'order') {
      order = value.split(',').map((part) => {
        const [col, dir = 'asc', nulls] = part.split('.')
        const desc = dir === 'desc'
        // Postgres default: NULLS LAST for ASC, NULLS FIRST for DESC.
        return { col, desc, nullsFirst: nulls ? nulls === 'nullsfirst' : desc }
      })
    } else if (key === 'limit') {
      limit = Number(value)
    } else if (key === 'on_conflict') {
      onConflict = value.split(',')
    } else if (key === 'or' || key === 'and') {
      throw new Error(`"${key}" filters are not supported`)
    } else if (!RESERVED.has(key)) {
      filters.push(makeFilter(key, value))
    }
  }
  return { filters, order, limit, onConflict }
}

function applyOrder(rows, order) {
  if (!order.length) return rows
  return [...rows].sort((a, b) => {
    for (const { col, desc, nullsFirst } of order) {
      const av = a[col]
      const bv = b[col]
      const aNull = av === null || av === undefined
      const bNull = bv === null || bv === undefined
      if (aNull || bNull) {
        if (aNull && bNull) continue
        return aNull === nullsFirst ? -1 : 1
      }
      if (av === bv) continue
      const c = String(av) < String(bv) ? -1 : 1
      return desc ? -c : c
    }
    return 0
  })
}

// --- The fake --------------------------------------------------------------

export async function installFakeSupabase(page, { now, seed = {} } = {}) {
  const tables = {
    vault: [],
    meals: [],
    meal_plans: [],
    meal_plan_items: [],
    household_preferences: [],
    plan_drafts: [],
    grocery_lists: [],
    grocery_list_items: [],
    vault_options: [],
    ...structuredClone(seed),
  }
  const log = [] // every write and every fake error, for debugging a run

  const defaults = {
    meal_plans: () => ({
      id: randomUUID(), user_id: USER.id, served_at: now().toISOString(),
      finalized_at: null, served_feedback: null, days: null, items: null, week_label: null,
      created_at: now().toISOString(),
    }),
    meal_plan_items: () => ({
      id: randomUUID(), user_id: USER.id, position: 0, vault_id: null, is_wildcard: false,
      source_url: null, cooked: false, cooked_at: null, is_shortlisted: false,
      created_at: now().toISOString(),
    }),
  }

  function overlapViolation(candidate) {
    if (!candidate.period_start || !candidate.period_end) return false
    return tables.meal_plans.some(
      (p) =>
        p.id !== candidate.id &&
        p.user_id === candidate.user_id &&
        p.period_start && p.period_end &&
        candidate.period_start <= p.period_end &&
        p.period_start <= candidate.period_end,
    )
  }

  // current_leftovers view: uncooked, scheduled items from FINALIZED periods
  // that ended within the last 14 days (mirrors the SQL view's intent).
  function currentLeftovers() {
    const today = ymd(now())
    const cutoff = addDaysYmd(today, -14)
    return tables.meal_plan_items
      .filter((i) => !i.cooked && !i.is_shortlisted && i.scheduled_date)
      .map((i) => ({ i, p: tables.meal_plans.find((p) => p.id === i.meal_plan_id) }))
      .filter(({ p }) => p && p.finalized_at && p.period_end && p.period_end < today && p.period_end >= cutoff)
      .map(({ i, p }) => ({
        ...i,
        source_period_start: p.period_start,
        source_period_end: p.period_end,
        source_finalized_at: p.finalized_at,
      }))
  }

  const json = (route, status, body) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: body === undefined ? '' : JSON.stringify(body),
    })

  const pgError = (route, status, code, message) =>
    json(route, status, { code, message, details: null, hint: null })

  const overlapError = (route) =>
    pgError(route, 409, '23P01',
      'conflicting key value violates exclusion constraint "meal_plans_no_period_overlap"')

  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const name = url.pathname.split('/rest/v1/')[1]
    const method = req.method()
    const headers = await req.allHeaders()
    const wantsObject = (headers.accept || '').includes('vnd.pgrst.object')
    const prefer = headers.prefer || ''
    const returnRows = prefer.includes('return=representation')

    try {
      if (name.startsWith('rpc/')) return json(route, 200, [])

      const source = name === 'current_leftovers' ? currentLeftovers() : tables[name]
      if (!source) throw new Error(`unknown table "${name}"`)
      const { filters, order, limit, onConflict } = parseQuery(url)
      const matches = (row) => filters.every((f) => f(row))

      const respond = (rows, status = 200) => {
        if (wantsObject) {
          if (rows.length !== 1) {
            return pgError(route, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned')
          }
          return json(route, status, rows[0])
        }
        return json(route, status, rows)
      }
      const copy = (rows) => rows.map((r) => ({ ...r }))

      if (method === 'GET' || method === 'HEAD') {
        let rows = applyOrder(source.filter(matches), order)
        if (limit !== null) rows = rows.slice(0, limit)
        return respond(copy(rows))
      }

      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        const incoming = Array.isArray(body) ? body : [body]
        const upsert = prefer.includes('resolution=merge-duplicates')
        const written = []
        for (const raw of incoming) {
          if (upsert && onConflict) {
            const existing = tables[name].find((r) => onConflict.every((c) => r[c] === raw[c]))
            if (existing) {
              Object.assign(existing, raw)
              written.push(existing)
              continue
            }
          }
          const row = { ...(defaults[name]?.() ?? {}), ...raw }
          if (name === 'meal_plans' && overlapViolation(row)) {
            log.push({ at: ymd(now()), method, name, rejected: 'overlap', period: [row.period_start, row.period_end] })
            return overlapError(route)
          }
          tables[name].push(row)
          written.push(row)
        }
        log.push({ at: ymd(now()), method, name, rows: written.length })
        return returnRows ? respond(copy(written), 201) : json(route, 201, undefined)
      }

      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}')
        const targets = tables[name].filter(matches)
        for (const row of targets) {
          if (name === 'meal_plans' && overlapViolation({ ...row, ...patch })) return overlapError(route)
          Object.assign(row, patch)
        }
        log.push({ at: ymd(now()), method, name, rows: targets.length, patch: Object.keys(patch) })
        return returnRows ? respond(copy(targets)) : json(route, 204, undefined)
      }

      if (method === 'DELETE') {
        const removed = tables[name].filter(matches)
        tables[name] = tables[name].filter((r) => !matches(r))
        if (name === 'meal_plans') {
          // ON DELETE CASCADE from meal_plan_items.meal_plan_id
          const ids = new Set(removed.map((r) => r.id))
          tables.meal_plan_items = tables.meal_plan_items.filter((i) => !ids.has(i.meal_plan_id))
        }
        log.push({ at: ymd(now()), method, name, rows: removed.length })
        return returnRows ? respond(copy(removed)) : json(route, 204, undefined)
      }

      throw new Error(`unsupported method ${method}`)
    } catch (err) {
      log.push({ at: ymd(now()), method, name, error: err.message })
      return pgError(route, 500, 'FAKE', `fakeSupabase: ${err.message}`)
    }
  })

  // The app's own API server (AI suggestions etc.) isn't running in E2E.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ names: [] }) }),
  )

  await page.route('**/auth/v1/user*', (route) => route.fulfill({ json: USER }))

  return { tables, log, user: USER }
}

/** Put a fake signed-in session in localStorage (same as new-period-flow.spec.js). */
export async function signIn(page) {
  await page.evaluate((user) => {
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
      expires_in: 3600,
      token_type: 'bearer',
      user,
    }))
  }, USER)
}

export const SEED_VAULT = [
  'Chicken Tacos', 'Salmon Rice Bowls', 'Veggie Curry', 'Turkey Chili', 'Pesto Pasta',
  'Beef Stir Fry', 'Black Bean Burgers', 'Shrimp Fried Rice', 'Lemon Chicken', 'Mushroom Risotto',
].map((name, i) => ({
  id: `00000000-0000-4000-8000-0000000000${i + 10}`,
  user_id: USER.id,
  name,
  cuisine_type: ['Mexican', 'Japanese', 'Indian', 'American', 'Italian'][i % 5],
  flavor_profile: ['Savory'],
  is_wildcard: false,
  proteins: [], cooking_method: [], main_carb: [], vegetables: [], dairy_components: [], fruits: [],
  family_rating: 4,
  prep_time_minutes: 30,
  ingredients_classified: null,
  ingredients: [],
  deleted_at: null,
  created_at: `2026-01-0${(i % 9) + 1}T00:00:00Z`,
}))
