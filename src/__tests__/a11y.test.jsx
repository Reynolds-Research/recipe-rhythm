import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../App'

vi.mock('../lib/supabase', () => {
  const mealsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  const session = { user: { id: 'test-user-id', email: 'test@example.com' } }
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut: vi.fn(),
      },
      from: vi.fn(() => mealsQuery),
    },
  }
})

describe('Page-level accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has a single <main> landmark', async () => {
    render(<App />)

    const main = await waitFor(() => screen.getByRole('main'))
    expect(main).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
