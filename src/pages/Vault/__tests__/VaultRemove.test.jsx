import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Vault from '../index'
import { useVault } from '../useVault'

// Ship-first fix "Recipe delete has no confirm and no undo" (UXR audit
// 2026-08-02, ROADMAP VP-5): Remove asks first, then offers Undo, which
// clears deleted_at.

vi.mock('../useVault', () => ({ useVault: vi.fn() }))
vi.mock('../../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))
// The card itself isn't under test: a stand-in with just its Remove button.
vi.mock('../RecipeCard', () => ({
  default: ({ recipe, onDelete }) => (
    <button type="button" onClick={() => onDelete(recipe.id)}>{`Remove ${recipe.name}`}</button>
  ),
}))

const RECIPES = [{ id: 'r1', name: 'Chicken Piccata' }, { id: 'r2', name: 'Egg Roll Bowls' }]

function setup({ deleteResult = { ok: true }, restoreResult = { ok: true } } = {}) {
  const deleteRecipe = vi.fn().mockResolvedValue(deleteResult)
  const restoreRecipe = vi.fn().mockResolvedValue(restoreResult)
  useVault.mockReturnValue({
    recipes: RECIPES, loading: false, vaultError: null, setVaultError: vi.fn(),
    extrasByCategory: {}, addExtra: vi.fn(), addRecipe: vi.fn(), addSuggestion: vi.fn(),
    deleteRecipe, restoreRecipe, updateRecipe: vi.fn(), setRating: vi.fn(),
    setIngredientEssentiality: vi.fn(), reExtractIngredients: vi.fn(),
    readRecipeScreenshots: vi.fn(), readRecipeLink: vi.fn(), setRecipeLink: vi.fn(),
  })
  render(<Vault userId="user-1" />)
  return { deleteRecipe, restoreRecipe }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('Cookbook — Remove asks first', () => {
  it('Remove opens a confirm and deletes nothing yet', async () => {
    const user = userEvent.setup()
    const { deleteRecipe } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    expect(await screen.findByText('Remove Chicken Piccata?')).toBeInTheDocument()
    expect(deleteRecipe).not.toHaveBeenCalled()
  })

  it('Cancel keeps the recipe', async () => {
    const user = userEvent.setup()
    const { deleteRecipe } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(deleteRecipe).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('confirming removes that recipe and offers Undo', async () => {
    const user = userEvent.setup()
    const { deleteRecipe } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }))
    expect(deleteRecipe).toHaveBeenCalledWith('r1')
    expect(await screen.findByRole('status')).toHaveTextContent('Chicken Piccata removed')
  })

  it('a failed remove says so and keeps the confirm open', async () => {
    const user = userEvent.setup()
    setup({ deleteResult: { ok: false } })
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t remove it')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // The confirm stays open so she can try again.
    expect(screen.getByText('Remove Chicken Piccata?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Remove$/ })).toBeEnabled()
  })
})

describe('Cookbook — Undo after Remove', () => {
  it('Undo restores the same recipe (clears deleted_at)', async () => {
    const user = userEvent.setup()
    const { restoreRecipe } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(restoreRecipe).toHaveBeenCalledWith('r1')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a failed Undo says so and keeps Undo on screen to try again', async () => {
    const user = userEvent.setup()
    const { restoreRecipe } = setup({ restoreResult: { ok: false } })
    const { setVaultError } = useVault.mock.results.at(-1).value
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(restoreRecipe).toHaveBeenCalledWith('r1')
    expect(setVaultError).toHaveBeenCalledWith(expect.stringContaining('Couldn’t bring back Chicken Piccata'))
    expect(await screen.findByRole('status')).toHaveTextContent('Chicken Piccata removed')
  })

  it('the Undo bar goes away after 8 seconds', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    await user.click(screen.getByRole('button', { name: 'Remove Chicken Piccata' }))
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(8000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
