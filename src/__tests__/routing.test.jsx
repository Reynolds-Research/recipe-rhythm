import { describe, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import App from '../App'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: vi.fn(),
  },
}))

describe('Routing (PRD-003 P0.11)', () => {
  it('/ renders the App shell (Auth form when signed out)', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    // Auth renders an email input once the session resolves to null.
    await screen.findByPlaceholderText('Email address')
  })

  it('the old /share/grocery/:token link now just opens the app (sharing retired in PRD-008 phase 4)', async () => {
    render(
      <MemoryRouter initialEntries={['/share/grocery/test123']}>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByPlaceholderText('Email address')
  })
})
