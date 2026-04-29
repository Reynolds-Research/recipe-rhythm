/**
 * Unit test for the pure helpers in scripts/build-classification-truth-set.js.
 * No I/O against Supabase; loadExistingLabels is exercised via a tmp file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  parseArgs,
  dedupeByName,
  pickSample,
  loadExistingLabels,
  buildFixture,
  countUnfilled,
} from '../../../scripts/build-classification-truth-set.js'

describe('parseArgs', () => {
  it('accepts --max-available without --count', () => {
    const out = parseArgs(['--max-available'])
    expect(out.maxAvailable).toBe(true)
  })

  it('accepts --from-existing path', () => {
    const out = parseArgs(['--from-existing', 'old.json'])
    expect(out.fromExisting).toBe('old.json')
  })

  it('throws on bad --count when --max-available is absent', () => {
    expect(() => parseArgs(['--count', 'nope'])).toThrow(/positive number/i)
  })
})

describe('dedupeByName', () => {
  function row(id, name, vegetables = [], extras = {}) {
    return { id, name, vegetables, ...extras }
  }

  it('keeps one row per case-insensitive recipe name, preferring more populated', () => {
    const rows = [
      row('a', 'Spaghetti Bolognese'),                     // empty
      row('b', 'spaghetti bolognese', ['onion', 'tomato']), // populated, different casing
      row('c', 'Tater Tots', ['potato']),
    ]
    const result = dedupeByName(rows)
    expect(result).toHaveLength(2)
    const names = result.map(r => r.name).sort()
    expect(names).toEqual(['Tater Tots', 'spaghetti bolognese'])
    const bolognese = result.find(r => r.name.toLowerCase() === 'spaghetti bolognese')
    expect(bolognese.id).toBe('b')
  })

  it('priorityIds beat the populated-rows preference', () => {
    const rows = [
      row('empty-row', 'X'),                       // empty, but priority
      row('full-row',  'X', ['a', 'b', 'c']),      // more populated, no priority
    ]
    const result = dedupeByName(rows, { priorityIds: ['empty-row'] })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('empty-row')
  })

  it('falls back to lowest vault_id when populated counts tie', () => {
    const rows = [
      row('zzz', 'X', ['a', 'b']),
      row('aaa', 'X', ['c', 'd']),
    ]
    const result = dedupeByName(rows)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('aaa')
  })

  it('skips rows with empty/whitespace names', () => {
    const rows = [
      row('a', '   '),
      row('b', 'Real Recipe', ['x']),
    ]
    expect(dedupeByName(rows)).toHaveLength(1)
  })
})

describe('pickSample', () => {
  function row(id, name) {
    return { id, name, vegetables: [name] }
  }

  it('returns at most `count` rows when --max-available is false', () => {
    const rows = [row(1, 'a'), row(2, 'b'), row(3, 'c'), row(4, 'd')]
    const out = pickSample({ dedupedRows: rows, count: 2, includeIds: [] })
    expect(out).toHaveLength(2)
  })

  it('always includes forced ids', () => {
    const rows = [row('a', 'A'), row('b', 'B'), row('c', 'C'), row('d', 'D')]
    const out = pickSample({ dedupedRows: rows, count: 2, includeIds: ['c'] })
    expect(out.map(r => r.id)).toContain('c')
    expect(out).toHaveLength(2)
  })

  it('returns every row when maxAvailable is true', () => {
    const rows = [row(1, 'a'), row(2, 'b'), row(3, 'c')]
    const out = pickSample({ dedupedRows: rows, count: 1, includeIds: [], maxAvailable: true })
    expect(out).toHaveLength(3)
  })
})

describe('loadExistingLabels', () => {
  let tmpDir
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truthset-')) })
  afterEach(()  => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns empty map for null path', () => {
    const out = loadExistingLabels(null)
    expect(out.labels.size).toBe(0)
    expect(out.priorityIds).toEqual([])
  })

  it('builds a (recipe_name → ingredient_name → {essentiality, borderline}) lookup, ignoring nulls', () => {
    const file = path.join(tmpDir, 'old.json')
    fs.writeFileSync(file, JSON.stringify({
      recipes: [
        {
          vault_id: 'r1', recipe_name: 'Spaghetti Bolognese',
          ingredients: [
            { name: 'beef',     essentiality: 'essential' },
            { name: 'parmesan', essentiality: 'omittable', borderline: 'judgment call' },
            { name: 'half-baked', essentiality: null },
          ],
        },
      ],
    }))
    const { labels, priorityIds } = loadExistingLabels(file)
    expect(priorityIds).toEqual(['r1'])
    expect(labels.get('spaghetti bolognese').get('beef')).toEqual({
      essentiality: 'essential', borderline: null,
    })
    expect(labels.get('spaghetti bolognese').get('parmesan')).toEqual({
      essentiality: 'omittable', borderline: 'judgment call',
    })
    expect(labels.get('spaghetti bolognese').has('half-baked')).toBe(false)
  })

  it('quietly returns empty when the file is missing or malformed', () => {
    expect(loadExistingLabels(path.join(tmpDir, 'missing.json')).labels.size).toBe(0)
    const bad = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(bad, 'not json')
    expect(loadExistingLabels(bad).labels.size).toBe(0)
  })
})

describe('buildFixture + countUnfilled', () => {
  function row(id, name, vegetables = []) {
    return { id, name, cuisine_type: null, vegetables }
  }

  it('preserves labels and borderline notes from existingLabels by (recipe_name, ingredient_name) match', () => {
    const existing = new Map()
    existing.set('spaghetti bolognese', new Map([
      ['beef', { essentiality: 'essential', borderline: null }],
      ['parmesan', { essentiality: 'omittable', borderline: 'judgment call' }],
    ]))
    const fixture = buildFixture({
      rows: [row('r1', 'Spaghetti Bolognese', ['beef', 'parmesan', 'newcomer'])],
      existingLabels: existing,
      generatedAt: '2026-04-28T00:00:00.000Z',
    })
    expect(fixture.recipes).toHaveLength(1)
    const ings = fixture.recipes[0].ingredients
    expect(ings).toEqual([
      { name: 'beef', essentiality: 'essential' },
      { name: 'parmesan', essentiality: 'omittable', borderline: 'judgment call' },
      { name: 'newcomer', essentiality: null },
    ])
  })

  it('countUnfilled returns the number of null essentialities', () => {
    const fixture = {
      recipes: [
        { ingredients: [{ name: 'a', essentiality: 'essential' }, { name: 'b', essentiality: null }] },
        { ingredients: [{ name: 'c', essentiality: null }] },
      ],
    }
    expect(countUnfilled(fixture)).toBe(2)
  })
})
