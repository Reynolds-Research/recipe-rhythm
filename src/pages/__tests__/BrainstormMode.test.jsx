import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BrainstormMode from '../BrainstormMode'
import { supabase } from '../../lib/supabase'
import * as recommendations from '../../lib/recommendations'

const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  then: vi.fn((cb) => cb({ data: [], error: null }))
};

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockQuery),
  }
}))

vi.mock('@dnd-kit/core', async () => ({
  DndContext: ({ children }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  TouchSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', async () => ({
  SortableContext: ({ children }) => <div>{children}</div>,
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

describe('BrainstormMode Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    globalThis.fetch = vi.fn()
  })

  it('fetches basic setup data and renders correctly', async () => {
    vi.spyOn(recommendations, 'getRecommendations').mockReturnValue([
      { id: '1', name: 'Sunday Roast', is_wildcard: false }
    ])

    render(<BrainstormMode userId="test-user" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    expect(screen.getByText('Sunday Roast')).toBeInTheDocument()
  })

  it('regenerates plan on button click', async () => {
    vi.spyOn(recommendations, 'getRecommendations').mockReturnValue([
      { id: '1', name: 'Tacos', is_wildcard: false }
    ])

    render(<BrainstormMode userId="test-user" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // Click regenerate
    const regenBtn = screen.getByText(/Regenerate/i)
    fireEvent.click(regenBtn)

    await waitFor(() => {
      expect(screen.getByText('Tacos')).toBeInTheDocument()
    })
  })

  it('calls /api/swap-suggestions when Swap is clicked', async () => {
    vi.spyOn(recommendations, 'getRecommendations').mockReturnValue([
      { id: '1', name: 'Tacos', is_wildcard: false },
      { id: '2', name: 'Ramen', is_wildcard: false },
      { id: '3', name: 'Lasagna', is_wildcard: false },
      { id: '4', name: 'Pad Thai', is_wildcard: false },
      { id: '5', name: 'Risotto', is_wildcard: false },
    ])

    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ names: ['Pho', 'Curry', 'Pasta'] }),
    })

    render(<BrainstormMode userId="test-user" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    const swapButtons = screen.getAllByText(/^Swap$/i)
    fireEvent.click(swapButtons[0])

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/swap-suggestions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        })
      )
    })

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(body).toHaveProperty('planNames')
    expect(body).toHaveProperty('recentNames')
  })
})
