import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppMenuSheet from '../AppMenuSheet'

describe('AppMenuSheet', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <AppMenuSheet
        isOpen={false}
        onOpenSettings={vi.fn()}
        onSignOut={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByTestId('mock-sheet')).not.toBeInTheDocument()
  })

  it('renders Settings and Sign out items when isOpen is true', () => {
    render(
      <AppMenuSheet
        isOpen={true}
        onOpenSettings={vi.fn()}
        onSignOut={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTestId('mock-sheet')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('calls onOpenSettings and onClose when Settings is clicked', async () => {
    const onOpenSettings = vi.fn()
    const onClose = vi.fn()
    render(
      <AppMenuSheet
        isOpen={true}
        onOpenSettings={onOpenSettings}
        onSignOut={vi.fn()}
        onClose={onClose}
      />
    )
    await userEvent.setup().click(screen.getByRole('menuitem', { name: /settings/i }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSignOut and onClose when Sign out is clicked', async () => {
    const onSignOut = vi.fn()
    const onClose = vi.fn()
    render(
      <AppMenuSheet
        isOpen={true}
        onOpenSettings={vi.fn()}
        onSignOut={onSignOut}
        onClose={onClose}
      />
    )
    await userEvent.setup().click(screen.getByRole('menuitem', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
