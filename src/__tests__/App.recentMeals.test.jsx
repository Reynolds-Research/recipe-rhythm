import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// App's recent-meals load: when a session appears, App queries the 10 most
// recent meals and hands them to LogMode. Child pages are stubbed so this test
// covers only App's own data flow.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(),
  },
}))
vi.mock('../pages/LogMode', () => ({
  default: ({ recentMeals }) => (
    <div data-testid="logmode">{recentMeals.map((m) => m.name).join(',')}</div>
  ),
}))
// vi.mock is hoisted, so each stub is listed literally.
vi.mock('../pages/BrainstormMode', () => ({ default: () => null }))
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

function mealsQuery(rows) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  }
  return chain
}

describe('App recent meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the recent meals for the signed-in user and passes them to LogMode', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    })
    const chain = mealsQuery([{ id: 'm1', name: 'Tacos', eaten_on: '2026-10-30' }])
    supabase.from.mockReturnValue(chain)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Tacos')).toBeInTheDocument()
    expect(supabase.from).toHaveBeenCalledWith('meals')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chain.limit).toHaveBeenCalledWith(10)
  })
})
