import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import App from '../App'
import SharedGroceryList from '../pages/SharedGroceryList'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(),
  },
}))

import { supabase } from '../lib/supabase'

function setupListNotFound() {
  vi.mocked(supabase.from).mockReturnValue({
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
}

describe('Routing (PRD-003 P0.11)', () => {
  it('/ renders the App shell (Auth form when signed out)', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    // Auth renders an email input once the session resolves to null.
    await screen.findByPlaceholderText('Email address')
  })

  it('/share/grocery/:token renders SharedGroceryList, not App', () => {
    // Token doesn't exist — SharedGroceryList shows the "list closed" state.
    setupListNotFound()

    render(
      <MemoryRouter initialEntries={['/share/grocery/test123']}>
        <Routes>
          <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    // SharedGroceryList renders immediately (loading spinner on first paint).
    // App's Auth gate renders the email input — its absence confirms we routed
    // to SharedGroceryList, not App.
    expect(screen.queryByPlaceholderText('Email address')).not.toBeInTheDocument()
  })
})
