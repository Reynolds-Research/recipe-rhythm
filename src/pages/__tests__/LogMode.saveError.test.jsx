import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogMode from '../LogMode'
import { matchVaultByName } from '../../lib/vaultMatch'
import { supabase } from '../../lib/supabase'

// Ship-first fix "Meal-log save fails silently" (UXR audit 2026-08-02, ROADMAP VP-16):
// a failed save must say so by the button and keep what she typed.

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../lib/vaultMatch', () => ({ matchVaultByName: vi.fn() }))
vi.mock('../../lib/analyzeRecipe', () => ({ analyzeRecipe: vi.fn() }))
vi.mock('../../lib/mealNameNormalize', async (importOriginal) => ({
  ...(await importOriginal()),
  normalizeMealName: vi.fn(async (name) => ({ corrected: name, hasChanges: false })),
}))
vi.mock('../../hooks/useSpeech', () => ({
  useSpeech: () => ({ transcript: '', isListening: false, error: null, toggleListening: vi.fn(), setTranscript: vi.fn() }),
}))
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))

function mealsInsertReturns(result) {
  const insert = vi.fn().mockImplementation(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)))
  supabase.from.mockImplementation(() => ({ insert }))
  return insert
}

async function typeAndSave(name) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/Tap the mic and speak, or type here/), name)
  await user.click(screen.getByRole('button', { name: /Save to log/i }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  matchVaultByName.mockResolvedValue({ matches: [], confidence: 'none' })
})

describe('LogMode — a failed save is never silent', () => {
  it('shows an error by the Save button and keeps her text when the insert is refused', async () => {
    const onSave = vi.fn()
    mealsInsertReturns({ error: { message: 'permission denied' } })
    render(<LogMode userId="user-1" onSave={onSave} />)
    await typeAndSave('Chicken Piccata')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save this meal')
    expect(screen.getByPlaceholderText(/Tap the mic and speak, or type here/)).toHaveValue('Chicken Piccata')
    expect(screen.getByRole('button', { name: /Save to log/i })).toBeEnabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the same error when the save throws (no network)', async () => {
    mealsInsertReturns(new Error('Failed to fetch'))
    render(<LogMode userId="user-1" />)
    await typeAndSave('Chicken Piccata')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save this meal')
    expect(screen.getByRole('button', { name: /Save to log/i })).toBeEnabled()
  })

  it('clears the error when the next try works', async () => {
    const onSave = vi.fn()
    const insert = mealsInsertReturns({ error: { message: 'timeout' } })
    render(<LogMode userId="user-1" onSave={onSave} />)
    const user = await typeAndSave('Chicken Piccata')
    await screen.findByRole('alert')

    insert.mockResolvedValue({ error: null })
    await user.click(screen.getByRole('button', { name: /Save to log/i }))

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
