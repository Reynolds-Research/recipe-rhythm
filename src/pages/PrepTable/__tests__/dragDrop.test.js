import { describe, it, expect } from 'vitest'
import { DRAG_SENSOR_OPTIONS, dayDropId, mealDragId, resolveDrop } from '../dragDrop'

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
