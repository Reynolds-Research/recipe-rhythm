import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MouseSensor, useSensor, useSensors } from '@dnd-kit/core'
import MealPlanCard from '../MealPlanCard'

const { mockTrigger } = vi.hoisted(() => ({ mockTrigger: vi.fn() }))
vi.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: mockTrigger }),
}))

const plan = [
  { scheduled_date: '2026-11-02', name: 'Chicken tacos', item_id: 'a' },
  { scheduled_date: '2026-11-03', name: 'Lentil soup', item_id: 'b' },
]

// Same pointer constraint production uses (useBrainstorm.js).
function Harness({ isServed, onDragEnd = () => {} }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } })
  )
  return (
    <MealPlanCard
      isServed={isServed}
      selectedDates={[]}
      disabledDates={new Set()}
      dayGridDates={plan.map(p => p.scheduled_date)}
      itemsByDate={new Map(plan.map(p => [p.scheduled_date, [p]]))}
      plan={plan}
      sensors={sensors}
      onToggleDate={() => {}}
      onRegenerate={() => {}}
      onDragEnd={onDragEnd}
      onOpenPicker={() => {}}
      onToggleCooked={() => {}}
      onMoveToMaybe={() => {}}
    />
  )
}

describe('MealPlanCard drag affordance', () => {
  beforeEach(() => mockTrigger.mockClear())

  it('shows a labelled grip on each meal before the plan is served', () => {
    render(<Harness isServed={false} />)
    expect(screen.getByLabelText('Drag Chicken tacos to another day')).toBeInTheDocument()
    expect(screen.getByLabelText('Drag Lentil soup to another day')).toBeInTheDocument()
  })

  it('starts a drag from the meal name, not just the grip, and buzzes on pickup', () => {
    render(<Harness isServed={false} />)
    const name = screen.getByText('Chicken tacos')
    fireEvent.mouseDown(name, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 0, clientY: 20 })
    expect(mockTrigger).toHaveBeenCalledWith('light')
    fireEvent.mouseUp(document)
  })

  it('hides the grip and does not start a drag once the plan is served', () => {
    render(<Harness isServed />)
    expect(screen.queryByLabelText(/to another day/)).not.toBeInTheDocument()
    const name = screen.getByText('Chicken tacos')
    fireEvent.mouseDown(name, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 0, clientY: 20 })
    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
