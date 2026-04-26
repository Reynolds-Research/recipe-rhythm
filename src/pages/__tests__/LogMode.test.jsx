import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogMode from '../LogMode'
import { matchVaultByName } from '../../lib/vaultMatch'
import { analyzeRecipe } from '../../lib/analyzeRecipe'
import { supabase } from '../../lib/supabase'

// --- Mocks ---------------------------------------------------------------
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../lib/vaultMatch', () => ({
  matchVaultByName: vi.fn(),
}))

vi.mock('../../lib/analyzeRecipe', () => ({
  analyzeRecipe: vi.fn(),
}))

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

// Build a from('meals') / from('vault') mock that lets each test inspect
// every chain method call. Returns a fresh set of spies on each setup so
// asserting against e.g. `mealsUpdate.eq` doesn't bleed across tests.
function setupSupabase({ insertedVaultId = 'new-vault-1' } = {}) {
  // meals.insert (used by handleSave) — resolves immediately.
  const mealsInsert = vi.fn().mockResolvedValue({ error: null })

  // meals.update().eq().ilike().is().order().limit() — used by the back-link.
  // Each method returns the same chain so we can spy on the leaf.
  const mealsUpdateLimit = vi.fn().mockResolvedValue({ error: null })
  const mealsUpdateChain = {
    eq:     vi.fn().mockReturnThis(),
    ilike:  vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  mealsUpdateLimit,
  }
  const mealsUpdate = vi.fn(() => mealsUpdateChain)

  // vault.insert(...).select('id').single() — used by handleSaveToVault.
  const vaultSingle = vi.fn().mockResolvedValue({
    data:  { id: insertedVaultId },
    error: null,
  })
  const vaultSelect = vi.fn(() => ({ single: vaultSingle }))
  const vaultInsert = vi.fn(() => ({ select: vaultSelect }))

  supabase.from.mockImplementation((table) => {
    if (table === 'meals') {
      return { insert: mealsInsert, update: mealsUpdate }
    }
    if (table === 'vault') {
      return { insert: vaultInsert }
    }
    // Catch-all for any unexpected table reads — return an inert chain.
    return {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      ilike:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
    }
  })

  return { mealsInsert, mealsUpdate, mealsUpdateChain, mealsUpdateLimit, vaultInsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  matchVaultByName.mockResolvedValue({ matches: [], confidence: 'none' })
  analyzeRecipe.mockResolvedValue({})
})

async function logMealAndPromote(name) {
  const user = userEvent.setup()
  const textarea = screen.getByPlaceholderText(/Tap the mic and speak, or type here/)
  await user.type(textarea, name)
  await user.click(screen.getByRole('button', { name: /Save to log/i }))
  // Once saved with no vault link, the Save-to-Cookbook prompt appears.
  const promote = await screen.findByRole('button', { name: /Save .* to Cookbook/i })
  await user.click(promote)
}

describe('LogMode → Save-to-Cookbook back-link (PRD-001 P0.4)', () => {
  it("back-links the originating meal to the new vault row's id", async () => {
    const { mealsUpdate, mealsUpdateChain } = setupSupabase({
      insertedVaultId: 'vault-new-123',
    })

    render(<LogMode userId="user-1" />)
    await logMealAndPromote('Sheet Pan Salmon')

    await waitFor(() => {
      expect(mealsUpdate).toHaveBeenCalledWith({ vault_id: 'vault-new-123' })
    })
    expect(mealsUpdateChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mealsUpdateChain.ilike).toHaveBeenCalledWith('name', 'Sheet Pan Salmon')
  })

  it('only updates rows whose vault_id is currently NULL (older linked meals untouched)', async () => {
    // The query contract is what protects pre-existing links — we assert that
    // .is('vault_id', null) is included so Postgres skips already-linked rows.
    const { mealsUpdateChain } = setupSupabase()

    render(<LogMode userId="user-1" />)
    await logMealAndPromote('Sheet Pan Salmon')

    await waitFor(() => {
      expect(mealsUpdateChain.is).toHaveBeenCalledWith('vault_id', null)
    })
  })

  it('updates only the most recent matching meal (limit 1, ordered by created_at desc)', async () => {
    // Same idea: limit 1 + descending order is the contract that prevents
    // older NULL-vault_id rows with the same name from being back-linked too.
    const { mealsUpdateChain, mealsUpdateLimit } = setupSupabase()

    render(<LogMode userId="user-1" />)
    await logMealAndPromote('Sheet Pan Salmon')

    await waitFor(() => {
      expect(mealsUpdateLimit).toHaveBeenCalledWith(1)
    })
    expect(mealsUpdateChain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('does NOT call meals.update if the vault insert fails', async () => {
    const { mealsUpdate, vaultInsert } = setupSupabase()
    // Override the vault insert to return an error so the back-link skips.
    vaultInsert.mockReturnValueOnce({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
    })

    render(<LogMode userId="user-1" />)
    await logMealAndPromote('Sheet Pan Salmon')

    // Wait long enough for any spurious post-insert update to fire.
    await new Promise((r) => setTimeout(r, 50))
    expect(mealsUpdate).not.toHaveBeenCalled()
  })
})
