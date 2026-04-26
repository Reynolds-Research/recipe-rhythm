import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeForm from '../RecipeForm'

// PRD-002 P0.4: prep-time numeric input wires through onSubmit.
// The form calls analyzeRecipe internally for AI-suggest; mock it so the
// test stays focused on the manual prep-time field.
vi.mock('../../../lib/analyzeRecipe', () => ({
  analyzeRecipe: vi.fn().mockResolvedValue(null),
}))

describe('RecipeForm — PRD-002 P0.4 prep_time_minutes', () => {
  it('passes a numeric prepTimeMinutes through to onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    const user = userEvent.setup()

    render(
      <RecipeForm
        saving={false}
        extrasByCategory={{}}
        onAddExtra={() => {}}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Test recipe')
    await user.type(screen.getByPlaceholderText(/prep \+ cook time/i), '30')
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Test recipe',
      prepTimeMinutes: 30,
    })
  })

  it('passes prepTimeMinutes: null when the field is left blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    const user = userEvent.setup()

    render(
      <RecipeForm
        saving={false}
        extrasByCategory={{}}
        onAddExtra={() => {}}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByPlaceholderText(/recipe name/i), 'No-prep recipe')
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].prepTimeMinutes).toBeNull()
  })
})
