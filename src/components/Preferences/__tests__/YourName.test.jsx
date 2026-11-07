import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 phase 3b — Settings → Your name (shown on the nights you cook).
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/cookNights', () => ({ loadMembers: vi.fn(), setMyName: vi.fn() }))

import * as cn from '../../../lib/cookNights'
import { supabase } from '../../../lib/supabase'
import YourName from '../YourName'

beforeEach(() => {
  vi.clearAllMocks()
  cn.loadMembers.mockResolvedValue([{ user_id: 'u-matt', display_name: null }, { user_id: 'u-her', display_name: 'Sara' }])
})

describe('Settings — Your name', () => {
  it('shows the saved name, and Save stays off until it changes', async () => {
    render(<YourName userId="u-her" />)
    expect(await screen.findByDisplayValue('Sara')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves a new name through the own-name-only function, trimmed', async () => {
    cn.setMyName.mockResolvedValue('Matt')
    render(<YourName userId="u-matt" />)
    const input = await screen.findByLabelText(/Your household sees it/)
    await userEvent.type(input, '  Matt ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(cn.setMyName).toHaveBeenCalledWith(supabase, 'Matt')
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(input).toHaveValue('Matt')
  })

  it('a failed save says so and keeps what was typed', async () => {
    cn.setMyName.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<YourName userId="u-matt" />)
    const input = await screen.findByLabelText(/Your household sees it/)
    await userEvent.type(input, 'Matt')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your name')
    expect(input).toHaveValue('Matt')
  })

  it('names are capped at 30 characters (the database rule)', async () => {
    render(<YourName userId="u-matt" />)
    expect(await screen.findByLabelText(/Your household sees it/)).toHaveAttribute('maxLength', '30')
  })
})
