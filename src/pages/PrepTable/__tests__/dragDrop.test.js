import { describe, it, expect } from 'vitest'
import { DRAG_SENSOR_OPTIONS, dayDropId, dayUnderPointer, mealDragId, resolveDrop } from '../dragDrop'

const meals = { m1: { planned_on: '2026-11-02' } }
const ev = (active, over) => ({ active: { id: active }, over: over ? { id: over } : null })

describe('resolveDrop', () => {
  it('a meal dropped on another day → move it there', () => {
    expect(resolveDrop(ev(mealDragId('m1'), dayDropId('2026-11-04')), meals)).toEqual({ mealId: 'm1', toDate: '2026-11-04' })
  })

  it('dropped back on its own day, outside any day, or unknown → no change', () => {
    expect(resolveDrop(ev(mealDragId('m1'), dayDropId('2026-11-02')), meals)).toBeNull()
    expect(resolveDrop(ev(mealDragId('m1'), null), meals)).toBeNull()
    expect(resolveDrop(ev(mealDragId('nope'), dayDropId('2026-11-04')), meals)).toBeNull()
    expect(resolveDrop(ev('something-else', dayDropId('2026-11-04')), meals)).toBeNull()
    expect(resolveDrop(ev(mealDragId('m1'), 'not-a-day'), meals)).toBeNull()
  })
})

describe('feel matches the old Prep Table', () => {
  it('same mouse distance and touch press-and-hold as useBrainstorm.js', () => {
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

  it('keyboard (no pointer): the day the card overlaps', () => {
    expect(dayUnderPointer(args(null, 210)).map((c) => c.id)).toEqual(['day:b'])
  })
})
