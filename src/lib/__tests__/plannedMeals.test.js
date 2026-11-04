import { describe, it, expect } from 'vitest'
import {
  addMeal,
  loadDidntGetTo,
  loadMaybeList,
  loadWeek,
  loadWeekDays,
  loadWeekMeals,
  moveMeal,
  keepsCookedTick,
  pickDidntGetTo,
  removeMeal,
  saveWeekDays,
  setCooked,
} from '../plannedMeals'

// ---------------------------------------------------------------------------
// Supabase fake — records every chain so a test can check the exact query:
//
//   .from(t).select(cols).eq(..).gte(..).lte(..).is(..).order(..)   (awaited)
//   .from(t).select(cols).eq(..).maybeSingle()
//   .from(t).insert(row).select(cols).single()
//   .from(t).update(patch).eq('id', id).select(cols).single()
//   .from(t).upsert(row, opts)                                     (awaited)
//   .from(t).delete().eq('id', id)                                 (awaited)
//
// Each chain resolves to responses[`${table}.${op}`] — or, when that's a
// list, the next item each time (for two selects on the same table).
// household.js is mocked globally (src/setupTests.js): household = `hh-<userId>`.
// ---------------------------------------------------------------------------
function makeSupabase(responses = {}) {
  const queues = Object.fromEntries(
    Object.entries(responses).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  )
  const client = {
    calls: [],
    from(table) {
      const call = { table, op: null, columns: null, payload: null, opts: null, filters: [], order: [], end: null }
      client.calls.push(call)
      const result = () => {
        const q = queues[`${table}.${call.op}`]
        const r = Array.isArray(q) ? q.shift() : q
        return Promise.resolve(r ?? { data: null, error: null })
      }
      const chain = {
        select(cols) { if (!call.op) call.op = 'select'; call.columns = cols; return chain },
        insert(row) { call.op = 'insert'; call.payload = row; return chain },
        update(patch) { call.op = 'update'; call.payload = patch; return chain },
        upsert(row, opts) { call.op = 'upsert'; call.payload = row; call.opts = opts; return chain },
        delete() { call.op = 'delete'; return chain },
        eq(c, v) { call.filters.push(['eq', c, v]); return chain },
        gte(c, v) { call.filters.push(['gte', c, v]); return chain },
        lte(c, v) { call.filters.push(['lte', c, v]); return chain },
        is(c, v) { call.filters.push(['is', c, v]); return chain },
        order(c, o) { call.order.push([c, o?.ascending !== false]); return chain },
        single() { call.end = 'single'; return result() },
        maybeSingle() { call.end = 'maybeSingle'; return result() },
        then(resolve, reject) { return result().then(resolve, reject) },
      }
      return chain
    },
  }
  return client
}

const USER = 'u1'
const HH = 'hh-u1'
const ok = (data) => ({ data, error: null })
const fail = (message) => ({ data: null, error: { message } })

const meal = (over = {}) => ({
  id: 'm1', household_id: HH, planned_on: '2026-11-02', position: 0, name: 'Tacos',
  vault_id: 'v1', is_wildcard: false, source_url: null, cooked: false, cooked_at: null,
  assigned_to: null, assigned_at: null, user_id: USER, ...over,
})

// ---------------------------------------------------------------------------
describe('loadWeekMeals', () => {
  it("asks for the household's meals Sunday–Saturday of that week, by day then position", async () => {
    const sb = makeSupabase({ 'planned_meals.select': ok([meal()]) })
    const rows = await loadWeekMeals(sb, USER, '2026-11-04')

    expect(rows).toEqual([meal()])
    const [c] = sb.calls
    expect(c.table).toBe('planned_meals')
    expect(c.filters).toEqual([
      ['eq', 'household_id', HH],
      ['gte', 'planned_on', '2026-11-01'],
      ['lte', 'planned_on', '2026-11-07'],
    ])
    expect(c.order).toEqual([['planned_on', true], ['position', true]])
  })

  it('returns [] for an empty week and throws on a database error', async () => {
    await expect(loadWeekMeals(makeSupabase(), USER, '2026-11-04')).resolves.toEqual([])
    const sb = makeSupabase({ 'planned_meals.select': fail('boom') })
    await expect(loadWeekMeals(sb, USER, '2026-11-04')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('loadWeekDays', () => {
  it("reads this week's own days and the usual days for the household", async () => {
    const sb = makeSupabase({
      'week_days.select': ok({ days: [5, 0, 1] }),
      'household_preferences.select': ok({ usual_days: [0, 1, 2, 3, 4] }),
    })
    const r = await loadWeekDays(sb, USER, '2026-11-04')

    expect(r).toEqual({ weekDays: [0, 1, 5], usualDays: [0, 1, 2, 3, 4] })
    const week = sb.calls.find((c) => c.table === 'week_days')
    expect(week.filters).toEqual([['eq', 'household_id', HH], ['eq', 'week_start', '2026-11-01']])
    expect(week.end).toBe('maybeSingle')
    const prefs = sb.calls.find((c) => c.table === 'household_preferences')
    expect(prefs.columns).toBe('usual_days')
    expect(prefs.filters).toEqual([['eq', 'household_id', HH]])
  })

  it('a week nobody changed → weekDays null; no preferences yet → Sun–Thu', async () => {
    const r = await loadWeekDays(makeSupabase(), USER, '2026-11-04')
    expect(r).toEqual({ weekDays: null, usualDays: [0, 1, 2, 3, 4] })
  })

  it('an emptied week stays empty (not "never changed")', async () => {
    const sb = makeSupabase({ 'week_days.select': ok({ days: [] }) })
    expect((await loadWeekDays(sb, USER, '2026-11-04')).weekDays).toEqual([])
  })
})

describe('loadWeek', () => {
  it('combines the meals and the days with the week bounds', async () => {
    const sb = makeSupabase({
      'planned_meals.select': ok([meal()]),
      'week_days.select': ok(null),
      'household_preferences.select': ok({ usual_days: [0, 1, 2, 3, 4, 5] }),
    })
    expect(await loadWeek(sb, USER, '2026-11-04')).toEqual({
      weekStart: '2026-11-01',
      weekEnd: '2026-11-07',
      meals: [meal()],
      weekDays: null,
      usualDays: [0, 1, 2, 3, 4, 5],
    })
  })
})

describe('saveWeekDays', () => {
  it('saves the week and makes its days the usual days', async () => {
    const sb = makeSupabase()
    const saved = await saveWeekDays(sb, USER, '2026-11-01', [5, 0, 1, 1])

    expect(saved).toEqual([0, 1, 5])
    const [week, prefs] = sb.calls
    expect(week.table).toBe('week_days')
    expect(week.op).toBe('upsert')
    expect(week.payload).toEqual({ household_id: HH, week_start: '2026-11-01', days: [0, 1, 5], user_id: USER })
    expect(week.opts).toEqual({ onConflict: 'household_id,week_start' })
    expect(prefs.table).toBe('household_preferences')
    expect(prefs.payload).toEqual({ household_id: HH, user_id: USER, usual_days: [0, 1, 5] })
    expect(prefs.opts).toEqual({ onConflict: 'household_id' })
  })

  it('an emptied (vacation) week leaves the usual days alone', async () => {
    const sb = makeSupabase()
    await saveWeekDays(sb, USER, '2026-11-01', [])
    expect(sb.calls.map((c) => c.table)).toEqual(['week_days'])
  })

  it('refuses a week start that is not a Sunday', async () => {
    await expect(saveWeekDays(makeSupabase(), USER, '2026-11-02', [0])).rejects.toThrow(/not a Sunday/)
  })

  it("stops before touching the usual days if the week didn't save", async () => {
    const sb = makeSupabase({ 'week_days.upsert': fail('denied') })
    await expect(saveWeekDays(sb, USER, '2026-11-01', [0])).rejects.toMatchObject({ message: 'denied' })
    expect(sb.calls).toHaveLength(1)
  })
})

describe('addMeal', () => {
  it('adds a meal on a day, stamped with the household and who added it', async () => {
    const sb = makeSupabase({ 'planned_meals.insert': ok(meal()) })
    const row = await addMeal(sb, USER, { plannedOn: '2026-11-02', name: '  Tacos ', vaultId: 'v1', position: 2 })

    expect(row).toEqual(meal())
    const [c] = sb.calls
    expect(c.op).toBe('insert')
    expect(c.payload).toEqual({
      household_id: HH, user_id: USER, planned_on: '2026-11-02', position: 2, name: 'Tacos',
      vault_id: 'v1', is_wildcard: false, source_url: null,
    })
    expect(c.end).toBe('single')
  })

  it('with no date it goes on the Maybe list', async () => {
    const sb = makeSupabase()
    await addMeal(sb, USER, { name: 'Pho' })
    expect(sb.calls[0].payload).toMatchObject({ planned_on: null, vault_id: null, name: 'Pho' })
  })

  it('refuses a blank name or a malformed date before calling the database', async () => {
    const sb = makeSupabase()
    await expect(addMeal(sb, USER, { name: '   ' })).rejects.toThrow(/needs a name/)
    await expect(addMeal(sb, USER, { name: 'Pho', plannedOn: '11/2' })).rejects.toThrow()
    expect(sb.calls).toHaveLength(0)
  })
})

describe('moveMeal', () => {
  it('moves a meal to another day (and position) by id', async () => {
    const sb = makeSupabase({ 'planned_meals.update': ok(meal({ planned_on: '2026-11-05', position: 1 })) })
    await moveMeal(sb, 'm1', { plannedOn: '2026-11-05', position: 1 })

    const [c] = sb.calls
    expect(c.payload).toEqual({ planned_on: '2026-11-05', position: 1 })
    expect(c.filters).toEqual([['eq', 'id', 'm1']])
  })

  it('moving to Maybe clears the date and "cooked"', async () => {
    const sb = makeSupabase()
    await moveMeal(sb, 'm1', { plannedOn: null })
    expect(sb.calls[0].payload).toEqual({ planned_on: null, cooked: false, cooked_at: null })
  })

  it('reorder only touches position', async () => {
    const sb = makeSupabase()
    await moveMeal(sb, 'm1', { position: 3 })
    expect(sb.calls[0].payload).toEqual({ position: 3 })
  })

  it('refuses a move with nothing to change', async () => {
    await expect(moveMeal(makeSupabase(), 'm1', {})).rejects.toThrow(/plannedOn and\/or position/)
  })
})

describe('moveMeal and the cooked tick', () => {
  it('cooked: false clears the tick and its time', async () => {
    const sb = makeSupabase()
    await moveMeal(sb, 'm1', { plannedOn: '2026-11-05', position: 0, cooked: false })
    expect(sb.calls[0].payload).toEqual({ planned_on: '2026-11-05', position: 0, cooked: false, cooked_at: null })
  })

  it('cooked: true with cookedAt puts the tick back exactly (undo)', async () => {
    const sb = makeSupabase()
    await moveMeal(sb, 'm1', { plannedOn: '2026-11-01', position: 0, cooked: true, cookedAt: '2026-11-01T03:00:00.000Z' })
    expect(sb.calls[0].payload).toMatchObject({ cooked: true, cooked_at: '2026-11-01T03:00:00.000Z' })
  })

  it('leaving cooked out keeps the tick as it is', async () => {
    const sb = makeSupabase()
    await moveMeal(sb, 'm1', { plannedOn: '2026-11-01', position: 0 })
    expect(sb.calls[0].payload).toEqual({ planned_on: '2026-11-01', position: 0 })
  })
})

describe('keepsCookedTick (Matt, 2026-11-04)', () => {
  const TODAY = '2026-11-04'
  const cooked = { cooked: true }
  const notCooked = { cooked: false }

  it('moved into the future → loses the tick, even swapped with a cooked meal', () => {
    expect(keepsCookedTick(cooked, '2026-11-05', cooked, TODAY)).toBe(false)
  })

  it('plain move (no swap) → loses the tick, even to a past day', () => {
    expect(keepsCookedTick(cooked, '2026-11-02', null, TODAY)).toBe(false)
  })

  it('swapped with another cooked meal, today or in the past → keeps it', () => {
    expect(keepsCookedTick(cooked, '2026-11-02', cooked, TODAY)).toBe(true)
    expect(keepsCookedTick(cooked, TODAY, cooked, TODAY)).toBe(true)
  })

  it('swapped with an uncooked meal → loses it', () => {
    expect(keepsCookedTick(cooked, '2026-11-02', notCooked, TODAY)).toBe(false)
  })

  it('reordered on its own day → keeps it (same night)', () => {
    expect(keepsCookedTick({ cooked: true, planned_on: '2026-11-02' }, '2026-11-02', notCooked, TODAY)).toBe(true)
  })

  it('never gains a tick by moving', () => {
    expect(keepsCookedTick(notCooked, '2026-11-02', cooked, TODAY)).toBe(false)
  })
})

describe('removeMeal / setCooked', () => {
  it('removes by id', async () => {
    const sb = makeSupabase()
    await removeMeal(sb, 'm1')
    expect(sb.calls[0]).toMatchObject({ table: 'planned_meals', op: 'delete', filters: [['eq', 'id', 'm1']] })
  })

  it('surfaces a failed remove', async () => {
    const sb = makeSupabase({ 'planned_meals.delete': fail('nope') })
    await expect(removeMeal(sb, 'm1')).rejects.toMatchObject({ message: 'nope' })
  })

  it('ticks cooked with a timestamp, and unticking clears it', async () => {
    const now = new Date('2026-11-02T03:00:00Z')
    const sb = makeSupabase()
    await setCooked(sb, 'm1', true, now)
    await setCooked(sb, 'm1', false, now)
    expect(sb.calls[0].payload).toEqual({ cooked: true, cooked_at: '2026-11-02T03:00:00.000Z' })
    expect(sb.calls[1].payload).toEqual({ cooked: false, cooked_at: null })
    expect(sb.calls[0].filters).toEqual([['eq', 'id', 'm1']])
  })
})

describe('loadMaybeList', () => {
  it("asks for the household's meals with no date", async () => {
    const sb = makeSupabase({ 'planned_meals.select': ok([meal({ planned_on: null })]) })
    const rows = await loadMaybeList(sb, USER)

    expect(rows).toHaveLength(1)
    const [c] = sb.calls
    expect(c.filters).toEqual([['eq', 'household_id', HH], ['is', 'planned_on', null]])
    expect(c.order).toEqual([['position', true], ['created_at', true]])
  })
})

describe('"Didn\'t get to these"', () => {
  it('queries uncooked meals from the 14 days before today, and what is planned from today on', async () => {
    const sb = makeSupabase({
      'planned_meals.select': [ok([meal({ planned_on: '2026-10-29' })]), ok([])],
    })
    const rows = await loadDidntGetTo(sb, USER, '2026-11-02')

    expect(rows.map((r) => r.planned_on)).toEqual(['2026-10-29'])
    const [past, upcoming] = sb.calls
    expect(past.filters).toEqual([
      ['eq', 'household_id', HH],
      ['eq', 'cooked', false],
      ['gte', 'planned_on', '2026-10-19'],
      ['lte', 'planned_on', '2026-11-01'],
    ])
    expect(upcoming.filters).toEqual([['eq', 'household_id', HH], ['gte', 'planned_on', '2026-11-02']])
  })

  it('surfaces a database error', async () => {
    const sb = makeSupabase({ 'planned_meals.select': [fail('down'), ok([])] })
    await expect(loadDidntGetTo(sb, USER, '2026-11-02')).rejects.toMatchObject({ message: 'down' })
  })

  describe('pickDidntGetTo (the tray rule)', () => {
    const past = [
      meal({ id: 'a', planned_on: '2026-10-27', name: 'Tacos', vault_id: 'v1' }),
      meal({ id: 'b', planned_on: '2026-10-30', name: 'Tacos', vault_id: 'v1' }),
      meal({ id: 'c', planned_on: '2026-10-28', name: 'Pho ', vault_id: null }),
      meal({ id: 'd', planned_on: '2026-10-29', name: 'Curry', vault_id: 'v3' }),
    ]

    it('newest first, one per recipe', () => {
      expect(pickDidntGetTo(past, []).map((m) => m.id)).toEqual(['b', 'd', 'c'])
    })

    it('drops what is already planned again (same recipe, or same name for one-offs)', () => {
      const upcoming = [{ name: 'Green curry', vault_id: 'v3' }, { name: 'pho', vault_id: null }]
      expect(pickDidntGetTo(past, upcoming).map((m) => m.id)).toEqual(['b'])
    })

    it('empty in, empty out', () => {
      expect(pickDidntGetTo()).toEqual([])
    })
  })
})
