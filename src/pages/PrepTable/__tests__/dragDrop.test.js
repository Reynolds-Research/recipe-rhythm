import { describe, it, expect } from 'vitest'
import { DRAG_SENSOR_OPTIONS, dayDropId, dayUnderPointer, dragAnnouncements, mealDragId, resolveDrop, slotDropId } from '../dragDrop'

const mealsById = {
  m1: { id: 'm1', planned_on: '2026-11-02' },
  m2: { id: 'm2', planned_on: '2026-11-04' },
  m3: { id: 'm3', planned_on: '2026-11-05' },
  m4: { id: 'm4', planned_on: '2026-11-05' },
}
const mealsByDate = {
  '2026-11-02': [mealsById.m1],
  '2026-11-04': [mealsById.m2],
  '2026-11-05': [mealsById.m3, mealsById.m4],
}
const ev = (active, over) => ({ active: { id: active }, over: over ? { id: over } : null })
const r = (active, over) => resolveDrop(ev(active, over), mealsById, mealsByDate)

describe('resolveDrop — only the dragged meal moves; a taken spot swaps', () => {
  it('empty day → just move there', () => {
    expect(r(mealDragId('m1'), dayDropId('2026-11-03'))).toEqual({ mealId: 'm1', toDate: '2026-11-03', swapWithId: null })
  })

  it('day with one meal → swap with it', () => {
    expect(r(mealDragId('m1'), dayDropId('2026-11-04'))).toEqual({ mealId: 'm1', toDate: '2026-11-04', swapWithId: 'm2' })
  })

  it('onto a meal card → swap with that meal', () => {
    expect(r(mealDragId('m1'), slotDropId('m4'))).toEqual({ mealId: 'm1', toDate: '2026-11-05', swapWithId: 'm4' })
  })

  it('day with 2+ meals, not on a card → join that day (no single meal to swap)', () => {
    expect(r(mealDragId('m1'), dayDropId('2026-11-05'))).toEqual({ mealId: 'm1', toDate: '2026-11-05', swapWithId: null })
  })

  it('two meals on the same day can swap order', () => {
    expect(r(mealDragId('m3'), slotDropId('m4'))).toEqual({ mealId: 'm3', toDate: '2026-11-05', swapWithId: 'm4' })
  })

  it('no change: back on its own day or card, outside any target, unknown meal', () => {
    expect(r(mealDragId('m1'), dayDropId('2026-11-02'))).toBeNull()
    expect(r(mealDragId('m1'), slotDropId('m1'))).toBeNull()
    expect(r(mealDragId('m1'), null)).toBeNull()
    expect(r(mealDragId('nope'), dayDropId('2026-11-04'))).toBeNull()
    expect(r(mealDragId('m1'), slotDropId('nope'))).toBeNull()
    expect(r('something-else', dayDropId('2026-11-04'))).toBeNull()
  })
})

describe('feel matches the old Prep Table', () => {
  it('same mouse distance and touch press-and-hold as the old Prep Table (retired in phase 4)', () => {
    expect(DRAG_SENSOR_OPTIONS.mouse).toEqual({ activationConstraint: { distance: 8 } })
    expect(DRAG_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 250, tolerance: 5 } })
  })
})

describe('dayUnderPointer', () => {
  const box = (top) => ({ top, left: 0, width: 300, height: 100, bottom: top + 100, right: 300 })
  const args = (pointerCoordinates, collisionTop) => ({
    active: { id: 'meal:m1' },
    collisionRect: box(collisionTop),
    droppableRects: new Map([['day:a', box(0)], ['day:b', box(200)]]),
    droppableContainers: [{ id: 'day:a', data: { current: {} } }, { id: 'day:b', data: { current: {} } }],
    pointerCoordinates,
  })

  it('mouse / touch: the day under the pointer', () => {
    expect(dayUnderPointer(args({ x: 50, y: 250 }, 0)).map((c) => c.id)).toEqual(['day:b'])
  })

  it('a meal card wins over the day it sits in; the dragged meal\'s own card never counts', () => {
    const a = {
      active: { id: 'meal:m1' },
      collisionRect: box(0),
      droppableRects: new Map([['day:b', box(200)], ['slot:m2', { top: 220, left: 10, width: 200, height: 50, bottom: 270, right: 210 }], ['slot:m1', box(200)]]),
      droppableContainers: [{ id: 'day:b', data: { current: {} } }, { id: 'slot:m2', data: { current: {} } }, { id: 'slot:m1', data: { current: {} } }],
      pointerCoordinates: { x: 50, y: 240 },
    }
    expect(dayUnderPointer(a).map((c) => c.id)).toEqual(['slot:m2'])
    a.pointerCoordinates = { x: 250, y: 290 }  // inside the day, not on m2's card (only on m1's own)
    expect(dayUnderPointer(a).map((c) => c.id)).toEqual(['day:b'])
  })

  it('mouse / touch let go outside every day → no target, even if the card still overlaps a day', () => {
    expect(dayUnderPointer(args({ x: 900, y: 900 }, 210))).toEqual([])
  })

  it('keyboard (no pointer): the day the card overlaps', () => {
    expect(dayUnderPointer(args(null, 210)).map((c) => c.id)).toEqual(['day:b'])
  })
})

describe('screen reader announcements', () => {
  const a = dragAnnouncements((id) => ({ m1: 'Tacos', m2: 'Curry' })[id], (d) => ({ '2026-11-04': 'Wed Nov 4' })[d] ?? d, (id) => ({ m2: '2026-11-04' })[id])
  it('says when a drop will swap, and with what', () => {
    expect(a.onDragOver({ active: { id: 'meal:m1' }, over: { id: 'slot:m2' } })).toBe('Tacos would swap with Curry.')
    expect(a.onDragEnd({ active: { id: 'meal:m1' }, over: { id: 'slot:m2' } })).toBe('Tacos swapped with Curry on Wed Nov 4.')
    expect(a.onDragEnd({ active: { id: 'meal:m1' }, over: { id: 'day:2026-11-04' } })).toBe('Tacos moved to Wed Nov 4.')
  })
})
