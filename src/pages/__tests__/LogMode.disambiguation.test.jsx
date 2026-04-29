import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogMode from '../LogMode'
import { matchVaultByName } from '../../lib/vaultMatch'
import { supabase } from '../../lib/supabase'

// --- Mocks ---------------------------------------------------------------
// supabase.from('meals').insert(...) — awaited directly; resolve { error: null }.
// supabase.from('vault') is only hit by handleSaveToVault (not exercised here)
// but keep a permissive default so unrelated lookups don't crash.
const mealsInsert = vi.fn().mockResolvedValue({ error: null })
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock('../../lib/vaultMatch', () => ({
  matchVaultByName: vi.fn(),
}))

vi.mock('../../lib/analyzeRecipe', () => ({
  analyzeRecipe: vi.fn().mockResolvedValue({}),
}))

// Spell-check / Title-case normalization is mocked to a passthrough so the
// disambiguation flow (vault match sheet) is exercised without an
// intervening spell-check confirm step. Coverage for the normalization
// itself lives in src/lib/__tests__/mealNameNormalize.test.js.
vi.mock('../../lib/mealNameNormalize', () => ({
  normalizeMealName: vi.fn((n) => Promise.resolve({ corrected: n, hasChanges: false })),
  toTitleCase: vi.fn((n) => n),
}))

// useSpeech: the real hook touches window.SpeechRecognition. Stub it so the
// component renders cleanly under jsdom and tests can drive the textarea
// directly.
vi.mock('../../hooks/useSpeech', () => ({
  useSpeech: () => ({
    transcript:      '',
    isListening:     false,
    error:           null,
    toggleListening: vi.fn(),
    setTranscript:   vi.fn(),
  }),
}))

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mealsInsert.mockResolvedValue({ error: null })
  // Default: every from(table) returns the meals chain. Tests that need
  // table-specific behavior override this in the test body.
  supabase.from.mockImplementation(() => ({
    insert: mealsInsert,
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    ilike:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
  }))
})

async function typeAndSave(name) {
  const user = userEvent.setup()
  const textarea = screen.getByPlaceholderText(/Tap the mic and speak, or type here/)
  await user.type(textarea, name)
  const saveBtn = screen.getByRole('button', { name: /Save to log/i })
  await user.click(saveBtn)
  return user
}

describe('LogMode disambiguation flow', () => {
  it('single fuzzy match → meal saved with that vault_id, no sheet shown', async () => {
    matchVaultByName.mockResolvedValue({
      matches: [{ id: 'vault-fuzzy-1', name: 'Carnitas Tacos', image_url: null }],
      confidence: 'fuzzy',
    })

    render(<LogMode userId="user-1" />)
    await typeAndSave('tacos')

    await waitFor(() => {
      expect(mealsInsert).toHaveBeenCalledTimes(1)
    })
    expect(mealsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ vault_id: 'vault-fuzzy-1', name: 'tacos' }),
    )
    expect(screen.queryByTestId('mock-sheet')).not.toBeInTheDocument()
  })

  it('multiple matches → sheet renders with both options + "None of these"', async () => {
    matchVaultByName.mockResolvedValue({
      matches: [
        { id: 'v1', name: 'Carnitas Tacos', image_url: null },
        { id: 'v2', name: 'Chicken Tacos',  image_url: null },
      ],
      confidence: 'fuzzy',
    })

    render(<LogMode userId="user-1" />)
    await typeAndSave('tacos')

    // Sheet appears, lists both candidates and the "None of these" affordance.
    await waitFor(() => {
      expect(screen.getByTestId('mock-sheet')).toBeInTheDocument()
    })
    expect(screen.getByText('Carnitas Tacos')).toBeInTheDocument()
    expect(screen.getByText('Chicken Tacos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /None of these/i })).toBeInTheDocument()
    // Insert hasn't fired yet — we're waiting on the user's pick.
    expect(mealsInsert).not.toHaveBeenCalled()
  })

  it('selecting a match in the sheet → meal saved with that vault_id', async () => {
    matchVaultByName.mockResolvedValue({
      matches: [
        { id: 'v1', name: 'Carnitas Tacos', image_url: null },
        { id: 'v2', name: 'Chicken Tacos',  image_url: null },
      ],
      confidence: 'fuzzy',
    })

    render(<LogMode userId="user-1" />)
    const user = await typeAndSave('tacos')

    await waitFor(() => {
      expect(screen.getByTestId('mock-sheet')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Chicken Tacos'))

    await waitFor(() => {
      expect(mealsInsert).toHaveBeenCalledWith(
        expect.objectContaining({ vault_id: 'v2', name: 'tacos' }),
      )
    })
  })

  it('"None of these" → meal saved with vault_id = null', async () => {
    matchVaultByName.mockResolvedValue({
      matches: [
        { id: 'v1', name: 'Carnitas Tacos', image_url: null },
        { id: 'v2', name: 'Chicken Tacos',  image_url: null },
      ],
      confidence: 'fuzzy',
    })

    render(<LogMode userId="user-1" />)
    const user = await typeAndSave('tacos')

    await waitFor(() => {
      expect(screen.getByTestId('mock-sheet')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /None of these/i }))

    await waitFor(() => {
      expect(mealsInsert).toHaveBeenCalledWith(
        expect.objectContaining({ vault_id: null, name: 'tacos' }),
      )
    })
  })

  it('no matches → no sheet, meal saved with vault_id = null (regression)', async () => {
    matchVaultByName.mockResolvedValue({ matches: [], confidence: 'none' })

    render(<LogMode userId="user-1" />)
    await typeAndSave('something brand new')

    await waitFor(() => {
      expect(mealsInsert).toHaveBeenCalledWith(
        expect.objectContaining({ vault_id: null, name: 'something brand new' }),
      )
    })
    expect(screen.queryByTestId('mock-sheet')).not.toBeInTheDocument()
  })

  it('exact single match → meal saved with that vault_id', async () => {
    matchVaultByName.mockResolvedValue({
      matches: [{ id: 'exact-1', name: 'Carnitas Tacos', image_url: null }],
      confidence: 'exact',
    })

    render(<LogMode userId="user-1" />)
    await typeAndSave('Carnitas Tacos')

    await waitFor(() => {
      expect(mealsInsert).toHaveBeenCalledWith(
        expect.objectContaining({ vault_id: 'exact-1' }),
      )
    })
    expect(screen.queryByTestId('mock-sheet')).not.toBeInTheDocument()
  })
})
