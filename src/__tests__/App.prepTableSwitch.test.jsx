import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// PRD-008 2b-2: the Prep Table tab shows the old screen unless the build sets
// VITE_NEW_PREP_TABLE=true. Child pages are stubbed (same pattern as
// App.recentMeals.test.jsx) so this covers only App's choice.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(),
  },
}))
vi.mock('../pages/BrainstormMode', () => ({ default: () => <div data-testid="old-prep-table" /> }))
vi.mock('../pages/PrepTable', () => ({ default: () => <div data-testid="new-prep-table" /> }))
vi.mock('../pages/LogMode', () => ({ default: () => null }))
vi.mock('../pages/Vault', () => ({ default: () => null }))
vi.mock('../pages/GroceryList', () => ({ default: () => null }))
vi.mock('../components/CalendarView', () => ({ default: () => null }))
vi.mock('../components/Preferences', () => ({ default: () => null }))
vi.mock('../components/AppMenuSheet', () => ({ default: () => null }))
vi.mock('../components/About', () => ({ default: () => null }))
vi.mock('../components/MothersDayCard', () => ({ default: () => null }))
vi.mock('../components/InstallPrompt', () => ({ default: () => null }))

import { supabase } from '../lib/supabase'
import App from '../App'

function emptyQuery() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return chain
}

async function openPrepTable() {
  render(<MemoryRouter><App /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', { name: /prep table/i }))
}

describe('Prep Table switch (VITE_NEW_PREP_TABLE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    supabase.from.mockReturnValue(emptyQuery())
  })
  afterEach(() => vi.unstubAllEnvs())

  it('switch unset → the old Prep Table (today\'s app)', async () => {
    vi.stubEnv('VITE_NEW_PREP_TABLE', '')
    await openPrepTable()
    expect(screen.getByTestId('old-prep-table')).toBeInTheDocument()
    expect(screen.queryByTestId('new-prep-table')).not.toBeInTheDocument()
  })

  it('switch "true" → the new Prep Table', async () => {
    vi.stubEnv('VITE_NEW_PREP_TABLE', 'true')
    await openPrepTable()
    expect(screen.getByTestId('new-prep-table')).toBeInTheDocument()
    expect(screen.queryByTestId('old-prep-table')).not.toBeInTheDocument()
  })
})
