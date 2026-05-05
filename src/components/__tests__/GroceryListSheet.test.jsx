import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroceryListSheet from '../GroceryListSheet'

vi.mock('../../pages/GroceryList/GroceryListBody', () => ({
  default: () => <div data-testid="mock-grocery-body" />,
}))

describe('GroceryListSheet', () => {
  it('renders nothing when isOpen is false', () => {
    render(<GroceryListSheet isOpen={false} userId="user-1" onClose={vi.fn()} />)
    expect(screen.queryByTestId('mock-sheet')).not.toBeInTheDocument()
  })

  it('renders the body and close button when isOpen is true', () => {
    render(<GroceryListSheet isOpen={true} userId="user-1" onClose={vi.fn()} />)
    expect(screen.getByTestId('mock-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('mock-grocery-body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close grocery list' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<GroceryListSheet isOpen={true} userId="user-1" onClose={onClose} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close grocery list' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
