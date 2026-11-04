/**
 * Drag-and-drop for the new Prep Table (PRD-008, 2026-11-04: her request —
 * dragging meals between days is part of how she plans).
 *
 * Mental model: each meal card is something you can pick up; each day row,
 * and each meal card, is a place you can put it down. Only the dragged meal
 * moves — nothing in between shifts (Matt, 2026-11-04). If the spot is taken,
 * the two meals swap:
 *   - dropped on a meal card            → swap with that meal
 *   - dropped on a day with one meal    → swap with it
 *   - dropped on an empty day           → just move there
 *   - dropped on a day with 2+ meals,
 *     not on a card                     → join that day at the end
 *     (no single meal to swap with; drop on a card to swap)
 *
 * Sensors copied from the old Prep Table (useBrainstorm.js) so it feels the
 * same: mouse after 8px of movement (a click is still a click), touch after a
 * ~¼-second press-and-hold (a swipe still scrolls). Keyboard too: focus a meal,
 * Space to pick it up, arrow keys, Space to drop (the "Move" button is the
 * other non-pointer way).
 */

import { KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useSensor, useSensors } from '@dnd-kit/core'

export const DRAG_SENSOR_OPTIONS = {
  mouse: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 250, tolerance: 5 } },
}

export function usePrepTableSensors() {
  return useSensors(
    useSensor(MouseSensor, DRAG_SENSOR_OPTIONS.mouse),
    useSensor(TouchSensor, DRAG_SENSOR_OPTIONS.touch),
    useSensor(KeyboardSensor),
  )
}

/**
 * What is the dragged meal over? A meal card (to swap with) wins over the day
 * it sits in; the dragged meal's own card never counts. Uses the finger /
 * mouse position; for a keyboard drag (no pointer), what the card overlaps.
 */
export function dayUnderPointer(args) {
  const own = slotDropId(String(args.active?.id ?? '').replace(/^meal:/, ''))
  const pick = (hits) => {
    const usable = hits.filter((h) => h.id !== own)
    return usable.filter((h) => String(h.id).startsWith('slot:')).slice(0, 1).concat(
      usable.filter((h) => String(h.id).startsWith('day:')).slice(0, 1),
    ).slice(0, 1)
  }
  // Mouse / touch: only what's under the pointer — let go outside every day
  // and the meal goes back. Keyboard (no pointer): what the card overlaps.
  if (args.pointerCoordinates) return pick(pointerWithin(args))
  return pick(rectIntersection(args))
}

/**
 * Ids: a meal you pick up is `meal:<id>`; drop targets are `day:<YYYY-MM-DD>`
 * (a day row) and `slot:<id>` (a meal card, to swap with).
 */
export const mealDragId = (mealId) => `meal:${mealId}`
export const dayDropId = (date) => `day:${date}`
export const slotDropId = (mealId) => `slot:${mealId}`

/**
 * What a finished drag means:
 *   { mealId, toDate, swapWithId }  — move the meal to toDate; if swapWithId,
 *                                     that meal takes the dragged meal's spot
 *   null                            — no change (outside any target, back on
 *                                     its own spot, or unknown meal)
 *
 * @param {{ active?: {id: string}, over?: {id: string} | null }} event  dnd-kit's onDragEnd event
 * @param {Record<string, {id: string, planned_on: string}>} mealsById
 * @param {Record<string, object[]>} mealsByDate
 */
export function resolveDrop(event, mealsById, mealsByDate = {}) {
  const activeId = String(event?.active?.id ?? '')
  const overId = String(event?.over?.id ?? '')
  if (!activeId.startsWith('meal:')) return null
  const meal = mealsById[activeId.slice(5)]
  if (!meal) return null

  if (overId.startsWith('slot:')) {
    const other = mealsById[overId.slice(5)]
    if (!other || other.id === meal.id) return null
    return { mealId: meal.id, toDate: other.planned_on, swapWithId: other.id }
  }
  if (overId.startsWith('day:')) {
    const toDate = overId.slice(4)
    if (toDate === meal.planned_on) return null
    const there = mealsByDate[toDate] ?? []
    return { mealId: meal.id, toDate, swapWithId: there.length === 1 ? there[0].id : null }
  }
  return null
}

/**
 * What a screen reader says during a drag, in her words instead of dnd-kit's
 * internal ids ("Picked up draggable item meal:3f2…").
 *
 * @param {(mealId: string) => string|undefined} mealName
 * @param {(date: string) => string} dayName   e.g. "Wed Nov 4"
 * @param {(mealId: string) => string|undefined} [dayOfMeal]  a meal's date
 * @param {(date: string) => string|null} [onlyMealOn]  the id of a day's only meal, else null
 */
export function dragAnnouncements(mealName, dayName, dayOfMeal = () => null, onlyMealOn = () => null) {
  const meal = (id) => mealName(String(id).replace(/^(meal|slot):/, '')) ?? 'meal'
  const target = (over) => {
    if (!over) return null
    const id = String(over.id)
    if (id.startsWith('slot:')) return { swap: true, text: meal(id), day: dayOfMeal(id.slice(5)) }
    const d = id.replace(/^day:/, '')
    const only = onlyMealOn(d)      // a day with exactly one meal swaps with it
    return only ? { swap: true, text: meal(only), day: d } : { swap: false, text: dayName(d) }
  }
  return {
    onDragStart: ({ active }) => `Picked up ${meal(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const t = target(over)
      if (!t) return `${meal(active.id)} is not over a day.`
      return t.swap ? `${meal(active.id)} would swap with ${t.text}.` : `${meal(active.id)} is over ${t.text}.`
    },
    onDragEnd: ({ active, over }) => {
      const t = target(over)
      if (!t) return `${meal(active.id)} put back.`
      if (t.swap) return `${meal(active.id)} swapped with ${t.text}${t.day ? ` on ${dayName(t.day)}` : ''}.`
      return `${meal(active.id)} moved to ${t.text}.`
    },
    onDragCancel: ({ active }) => `Cancelled. ${meal(active.id)} stays where it was.`,
  }
}
