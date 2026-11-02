import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeSearchInput from '../RecipeSearchInput'

function Harness() {
  const [q, setQ] = useState('')
  return <RecipeSearchInput value={q} onChange={setQ} placeholder="Search your cookbook" />
}

describe('RecipeSearchInput', () => {
  it('is a named search box with the given placeholder', () => {
    render(<Harness />)
    const input = screen.getByRole('searchbox', { name: 'Search recipes' })
    expect(input).toHaveAttribute('placeholder', 'Search your cookbook')
    expect(input).toHaveAttribute('enterkeyhint', 'search')
  })

  it('shows × only when non-empty, and × clears the value', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument()

    const input = screen.getByRole('searchbox', { name: 'Search recipes' })
    await user.type(input, 'tacos')
    expect(input).toHaveValue('tacos')

    await user.click(screen.getByLabelText('Clear search'))
    expect(input).toHaveValue('')
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument()
  })

  it('Escape clears the value', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('searchbox', { name: 'Search recipes' })
    await user.type(input, 'curry')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })
})
