import { describe, it, expect } from 'vitest'
import {
  giveNight,
  giveLabel,
  loadMembers,
  loadNights,
  memberName,
  nightLabel,
  nightsToPick,
  otherMember,
  setMyName,
  takeBackNight,
} from '../cookNights'

// PRD-008 phase 3b — Matt's nights. household.js is mocked globally
// (src/setupTests.js): household = `hh-<userId>`.

// A tiny Supabase fake: records the chain, resolves to `result`.
function fakeSupabase(result = { data: [], error: null }) {
  const calls = []
  const client = {
    calls,
    from(table) {
      const call = { table, ops: [] }
      calls.push(call)
      const chain = new Proxy({}, {
        get(_t, op) {
          if (op === 'then') return (res, rej) => Promise.resolve(result).then(res, rej)
          return (...args) => { call.ops.push([op, ...args]); return chain }
        },
      })
      return chain
    },
    rpc(fn, args) { calls.push({ rpc: fn, args }); return Promise.resolve(result) },
  }
  return client
}

const HER = 'u-her'
const MATT = 'u-matt'
const MEMBERS = [{ user_id: HER, display_name: 'Sara' }, { user_id: MATT, display_name: 'Matt' }]

describe('cookNights data helpers', () => {
  it('loadNights reads her household for the date range, by date', async () => {
    const sb = fakeSupabase({ data: [{ cooks_on: '2026-11-17', cook_id: MATT }], error: null })
    const rows = await loadNights(sb, HER, '2026-11-15', '2026-11-21')
    expect(rows).toHaveLength(1)
    expect(sb.calls[0].table).toBe('cook_nights')
    expect(sb.calls[0].ops).toEqual(expect.arrayContaining([
      ['eq', 'household_id', `hh-${HER}`],
      ['gte', 'cooks_on', '2026-11-15'],
      ['lte', 'cooks_on', '2026-11-21'],
    ]))
  })

  it('giveNight saves one row per date (upsert), stamped with who handed it over', async () => {
    const sb = fakeSupabase({ data: { cooks_on: '2026-11-17', cook_id: MATT }, error: null })
    await giveNight(sb, HER, '2026-11-17', MATT)
    const upsert = sb.calls[0].ops.find(([op]) => op === 'upsert')
    expect(upsert[1]).toEqual({ household_id: `hh-${HER}`, cooks_on: '2026-11-17', cook_id: MATT, user_id: HER })
    expect(upsert[2]).toEqual({ onConflict: 'household_id,cooks_on' })
  })

  it('takeBackNight deletes that date in her household', async () => {
    const sb = fakeSupabase({ data: null, error: null })
    await takeBackNight(sb, HER, '2026-11-17')
    expect(sb.calls[0].ops).toEqual([
      ['delete'],
      ['eq', 'household_id', `hh-${HER}`],
      ['eq', 'cooks_on', '2026-11-17'],
    ])
  })

  it('a failed write throws (the screen says so)', async () => {
    const sb = fakeSupabase({ data: null, error: { message: 'denied' } })
    await expect(giveNight(sb, HER, '2026-11-17', MATT)).rejects.toEqual({ message: 'denied' })
    await expect(takeBackNight(sb, HER, '2026-11-17')).rejects.toEqual({ message: 'denied' })
    await expect(loadNights(sb, HER, 'a', 'b')).rejects.toEqual({ message: 'denied' })
  })

  it('loadMembers reads names for her household', async () => {
    const sb = fakeSupabase({ data: MEMBERS, error: null })
    expect(await loadMembers(sb, HER)).toEqual(MEMBERS)
    expect(sb.calls[0].ops).toEqual(expect.arrayContaining([['select', 'user_id, display_name'], ['eq', 'household_id', `hh-${HER}`]]))
  })

  it('setMyName goes through the database function (own name only)', async () => {
    const sb = fakeSupabase({ data: 'Sara', error: null })
    expect(await setMyName(sb, ' Sara ')).toBe('Sara')
    expect(sb.calls[0]).toEqual({ rpc: 'rr_set_my_display_name', args: { p_name: ' Sara ' } })
  })
})

describe('cookNights labels', () => {
  it('reads from the viewer\'s side: "Matt\'s night" on her phone, "Your night" on his', () => {
    const night = { cook_id: MATT }
    expect(nightLabel(night, HER, MEMBERS)).toBe("Matt's night")
    expect(nightLabel(night, MATT, MEMBERS)).toBe('Your night')
    expect(nightLabel(null, HER, MEMBERS)).toBeNull()
  })

  it('falls back to "Partner" until a name is saved', () => {
    const noNames = [{ user_id: HER, display_name: null }, { user_id: MATT, display_name: '  ' }]
    expect(nightLabel({ cook_id: MATT }, HER, noNames)).toBe("Partner's night")
    expect(memberName(noNames, MATT)).toBe('Partner')
    expect(giveLabel(noNames, HER)).toBe('Give to Partner')
  })

  it('offers "Give to …" only when there is someone else in the household', () => {
    expect(giveLabel(MEMBERS, HER)).toBe('Give to Matt')
    expect(giveLabel(MEMBERS, MATT)).toBe('Give to Sara')
    expect(giveLabel([{ user_id: HER, display_name: 'Sara' }], HER)).toBeNull()
    expect(otherMember(MEMBERS, HER).user_id).toBe(MATT)
  })

  it('nightsToPick: the viewer\'s own empty nights from today on', () => {
    const dates = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-19']
    const nightsByDate = {
      '2026-11-15': { cook_id: MATT },  // past
      '2026-11-17': { cook_id: MATT },  // empty → to pick
      '2026-11-19': { cook_id: MATT },  // has a meal
    }
    const mealsByDate = { '2026-11-19': [{ id: 'm' }] }
    expect(nightsToPick({ dates, today: '2026-11-16', nightsByDate, mealsByDate, viewerId: MATT })).toEqual(['2026-11-17'])
    expect(nightsToPick({ dates, today: '2026-11-16', nightsByDate, mealsByDate, viewerId: HER })).toEqual([])
  })
})
