import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChipPicker from '../ChipPicker'

const { mockTrigger } = vi.hoisted(() => ({ mockTrigger: vi.fn() }))
vi.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: mockTrigger }),
}))

const OPTIONS = ['Chicken', 'Beef', 'Tofu']

describe('ChipPicker — haptic feedback (Vault surface)', () => {
  beforeEach(() => {
    mockTrigger.mockReset()
  })

  it('fires the haptic trigger when a chip is toggled', async () => {
    const onChange = vi.fn()
    render(
      <ChipPicker
        options={OPTIONS}
        value={[]}
        onChange={onChange}
        multi
      />
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Chicken' }))

    expect(mockTrigger).toHaveBeenCalled()
  })
})
