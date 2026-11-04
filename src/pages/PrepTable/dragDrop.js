/**
 * Drag-and-drop for the new Prep Table (PRD-008, 2026-11-04: her request —
 * dragging meals between days is part of how she plans).
 *
 * Mental model: each meal card is something you can pick up; each day row is
 * a place you can put it down. Dropping a meal on a day moves just that meal
 * to that day (to the end of the day's list). Nothing else moves. The old
 * screen shifted every meal in between; with several meals a day and empty
 * days that would scatter the plan, so this behaves like a calendar instead.
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
 * Which day is the meal over? The day under the finger / mouse; for a
 * keyboard drag (no pointer), the day the card overlaps most.
 */
export function dayUnderPointer(args) {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

/** Draggable ids are `meal:<id>`, drop-target ids are `day:<YYYY-MM-DD>`. */
export const mealDragId = (mealId) => `meal:${mealId}`
export const dayDropId = (date) => `day:${date}`

/**
 * What a finished drag means: { mealId, toDate } to move, or null for "no
 * change" (dropped outside a day, or back on its own day).
 *
 * @param {{ active?: {id: string}, over?: {id: string} | null }} event  dnd-kit's onDragEnd event
 * @param {Record<string, {planned_on: string}>} mealsById
 */
export function resolveDrop(event, mealsById) {
  const activeId = String(event?.active?.id ?? '')
  const overId = String(event?.over?.id ?? '')
  if (!activeId.startsWith('meal:') || !overId.startsWith('day:')) return null
  const mealId = activeId.slice(5)
  const toDate = overId.slice(4)
  const meal = mealsById[mealId]
  if (!meal || meal.planned_on === toDate) return null
  return { mealId, toDate }
}

/**
 * What a screen reader says during a drag, in her words instead of dnd-kit's
 * internal ids ("Picked up draggable item meal:3f2…").
 *
 * @param {(mealId: string) => string|undefined} mealName
 * @param {(date: string) => string} dayName   e.g. "Wed Nov 4"
 */
export function dragAnnouncements(mealName, dayName) {
  const meal = (id) => mealName(String(id).replace(/^meal:/, '')) ?? 'meal'
  const day = (over) => (over ? dayName(String(over.id).replace(/^day:/, '')) : null)
  return {
    onDragStart: ({ active }) => `Picked up ${meal(active.id)}.`,
    onDragOver: ({ active, over }) => (day(over) ? `${meal(active.id)} is over ${day(over)}.` : `${meal(active.id)} is not over a day.`),
    onDragEnd: ({ active, over }) => (day(over) ? `${meal(active.id)} moved to ${day(over)}.` : `${meal(active.id)} put back.`),
    onDragCancel: ({ active }) => `Cancelled. ${meal(active.id)} stays where it was.`,
  }
}
