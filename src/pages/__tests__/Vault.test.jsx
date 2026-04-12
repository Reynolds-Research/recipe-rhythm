import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Vault from '../Vault'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnThis(),
      then: vi.fn(),
    })),
  }
}))

describe('Vault Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: mockSelect }) })
    }))

    render(<Vault userId="test-user" />)
    expect(screen.getByText('Loading vault…')).toBeInTheDocument()
  })

  it('renders recipes once loaded', async () => {
    const mockData = [
      { id: '1', name: 'Test Recipe 1', cuisine_type: 'American', created_at: new Date().toISOString() }
    ]
    const mockSelect = vi.fn().mockResolvedValue({ data: mockData, error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: mockSelect }) })
    }))

    render(<Vault userId="test-user" />)
    
    await waitFor(() => {
      expect(screen.queryByText('Loading vault…')).not.toBeInTheDocument()
    })
    
    expect(screen.getByText('Test Recipe 1')).toBeInTheDocument()
  })
})
