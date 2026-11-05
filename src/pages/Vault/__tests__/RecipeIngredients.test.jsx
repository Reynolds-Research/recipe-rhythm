import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Recipe ingredients in the Cookbook: read from screenshots, save on add,
// fill in the background. The lib (src/lib/recipeIngredients.js) is tested on
// its own; here prepareScreenshot (needs a real canvas) and the AI calls are
// mocked, the rest is real.
vi.mock('../../../lib/recipeIngredients', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareScreenshot: vi.fn(async (f) => ({ data: `b64-${f.name}`, mediaType: 'image/jpeg' })),
  readIngredients: vi.fn(),
  fillRecipeIngredients: vi.fn(),
}))
vi.mock('../../../lib/analyzeRecipe', () => ({ analyzeRecipe: vi.fn().mockResolvedValue(null) }))
vi.mock('../../../lib/mealNameNormalize', () => ({
  normalizeMealName: vi.fn((n) => Promise.resolve({ corrected: n, hasChanges: false })),
  toTitleCase: vi.fn((n) => n),
}))
vi.mock('../../../lib/vaultOptions', () => ({
  fetchVaultOptions: vi.fn().mockResolvedValue({}),
  addVaultOption: vi.fn().mockResolvedValue({ error: null }),
  migrateLocalStorageExtras: vi.fn().mockResolvedValue({ migrated: 0 }),
}))
const { insert, rows } = vi.hoisted(() => ({ insert: vi.fn(), rows: { vault: [] } }))
vi.mock('../../../lib/supabase', () => {
  const chain = (table) => {
    const c = {}
    for (const k of ['select', 'eq', 'is', 'not', 'ilike', 'limit']) c[k] = () => c
    c.order = () => Promise.resolve({ data: table === 'vault' ? rows.vault : [], error: null })
    c.then = (res) => Promise.resolve({ data: [], error: null }).then(res)
    c.insert = insert
    return c
  }
  return { supabase: { from: vi.fn(chain) } }
})

import * as ri from '../../../lib/recipeIngredients'
import { analyzeRecipe } from '../../../lib/analyzeRecipe'
import RecipeForm from '../RecipeForm'
import RecipeIngredients from '../RecipeIngredients'
import { screenshotMessage } from '../screenshotMessage'
import { useVault } from '../useVault'

const LIST = [
  { name: 'penne', quantity: '1', unit: 'lb', notes: null },
  { name: 'heavy cream', quantity: '1/2', unit: 'cup', notes: null },
]
const READ = { structured: LIST, classified: null, servings: 4, source: 'screenshot' }
const file = (name) => new File(['x'], name, { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  insert.mockResolvedValue({ error: null })
  rows.vault = []
  ri.readIngredients.mockResolvedValue(READ)
  ri.fillRecipeIngredients.mockResolvedValue(null)
})

function renderForm(onSubmit = vi.fn().mockResolvedValue({ ok: true })) {
  render(<RecipeForm saving={false} extrasByCategory={{}} onAddExtra={vi.fn()} onSubmit={onSubmit} />)
  return onSubmit
}

describe('Add a recipe: read ingredients from screenshots', () => {
  it('reads up to 3 screenshots and saves the real list with the recipe', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()
    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Penne alla Vodka')
    await user.upload(screen.getByLabelText(/Screenshots of the recipe's ingredients/), [file('a.png'), file('b.png')])

    expect(await screen.findByRole('status')).toHaveTextContent('✓ 2 ingredients read from 2 screenshots · serves 4')
    expect(ri.readIngredients).toHaveBeenCalledWith({
      name: 'Penne alla Vodka', url: '',
      images: [{ data: 'b64-a.png', mediaType: 'image/jpeg' }, { data: 'b64-b.png', mediaType: 'image/jpeg' }],
    })

    await user.click(screen.getByRole('button', { name: /Save to vault/i }))
    expect(onSubmit.mock.calls[0][0].ingredients).toEqual({
      ingredients_structured: LIST, ingredients_classified: null, servings: 4, ingredients_source: 'screenshot',
    })
  })

  it('Save waits while screenshots are being read (so their list is never lost)', async () => {
    let finish
    ri.readIngredients.mockImplementation(() => new Promise((r) => { finish = r }))
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Penne')
    await user.upload(screen.getByLabelText(/Screenshots of the recipe's ingredients/), [file('a.png')])
    expect(await screen.findByText('Reading screenshots…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save to vault/i })).toBeDisabled()
    await act(async () => finish(READ))
    expect(screen.getByRole('button', { name: /Save to vault/i })).toBeEnabled()
  })

  it('more than 3 screenshots: says so and reads nothing', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.upload(screen.getByLabelText(/Screenshots of the recipe's ingredients/),
      [file('1.png'), file('2.png'), file('3.png'), file('4.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick up to 3 screenshots.')
    expect(ri.readIngredients).not.toHaveBeenCalled()
  })

  it('no list found: says so; the recipe saves with no ingredients (filled in later)', async () => {
    ri.readIngredients.mockResolvedValue(null)
    const user = userEvent.setup()
    const onSubmit = renderForm()
    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Penne')
    await user.upload(screen.getByLabelText(/Screenshots of the recipe's ingredients/), [file('a.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t find an ingredient list in those screenshots')
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))
    expect(onSubmit.mock.calls[0][0].ingredients).toBeNull()
  })

  it('"Auto-fill" keeps its ingredient list as an estimate, but never over a screenshot list', async () => {
    analyzeRecipe.mockResolvedValue({
      ingredients_structured: [{ name: 'guess' }], servings: 4, servings_inferred: false, ingredients_classified: null,
    })
    const user = userEvent.setup()
    const onSubmit = renderForm()
    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Penne')
    await user.click(screen.getByRole('button', { name: /Auto-fill/ }))
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))
    expect(onSubmit.mock.calls[0][0].ingredients).toMatchObject({ ingredients_source: 'estimated', servings: null })

    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Tacos')
    await user.upload(screen.getByLabelText(/Screenshots of the recipe's ingredients/), [file('a.png')])
    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /Auto-fill/ }))
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))
    expect(onSubmit.mock.calls[1][0].ingredients.ingredients_source).toBe('screenshot')
  })
})

describe("A saved recipe's card: one ingredient list (the chips); amounts only right after a read", () => {
  const recipe = (over) => ({ id: 'r1', name: 'Penne', ingredients_structured: LIST, ingredients_source: 'estimated', servings: 4, ...over })
  const DOUBLED = [{ name: 'penne pasta', quantity: '8 ounces', unit: 'ounces', notes: null },
    { name: 'onion', quantity: '1/2', unit: null, notes: 'chopped finely' }]

  it('normally shows no amounts list: just where they came from and the servings', () => {
    render(<RecipeIngredients recipe={recipe()} status={null} onReadScreenshots={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByText('penne — 1 lb')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByTestId('ingredient-source'))
      .toHaveTextContent('Amounts estimated by AI — add screenshots for the real ones · Serves 4')
  })

  it('from screenshots says so', () => {
    render(<RecipeIngredients recipe={recipe({ ingredients_source: 'screenshot' })} status={null} onReadScreenshots={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ingredient-source')).toHaveTextContent('Amounts from your screenshots · Serves 4')
  })

  it('no list: warns that the grocery list will skip it', () => {
    render(<RecipeIngredients recipe={recipe({ ingredients_structured: null, ingredients_source: null })} status={null} onReadScreenshots={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ingredient-source')).toHaveTextContent('No ingredients yet — the grocery list can’t include this recipe.')
  })

  it('right after a read: a temporary "Here’s what I read" panel, no doubled units, closed by "Looks right"', async () => {
    const onDismiss = vi.fn()
    render(<RecipeIngredients recipe={recipe({ ingredients_source: 'screenshot' })}
      status={{ kind: 'done', list: DOUBLED }} onReadScreenshots={vi.fn()} onDismiss={onDismiss} />)
    const panel = screen.getByRole('status', { name: 'Here’s what I read' })
    expect(panel).toHaveTextContent('Here’s what I read (2)')
    expect(panel).toHaveTextContent('penne pasta — 8 ounces')
    expect(panel).not.toHaveTextContent('ounces ounces')
    expect(panel).toHaveTextContent('onion — 1/2, chopped finely')
    expect(panel).toHaveTextContent('Saved for your grocery list. This preview closes when you tap below.')
    expect(screen.queryByTestId('ingredient-source')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('picking screenshots hands them over', async () => {
    const onRead = vi.fn()
    render(<RecipeIngredients recipe={recipe()} status={null} onReadScreenshots={onRead} onDismiss={vi.fn()} />)
    await userEvent.upload(screen.getByLabelText('Screenshots of the Penne recipe (up to 3)'), [file('a.png')])
    expect(onRead).toHaveBeenCalledTimes(1)
    expect(onRead.mock.calls[0][0]).toHaveLength(1)
  })

  it('result messages carry the list for the panel', () => {
    expect(screenshotMessage({ ok: true, count: 1, list: LIST.slice(0, 1) }))
      .toEqual({ kind: 'done', message: '✓ Read 1 ingredients from your screenshots.', list: LIST.slice(0, 1) })
    expect(screenshotMessage({ ok: false, reason: 'too-many' }).message).toBe('Pick up to 3 screenshots.')
    expect(screenshotMessage({ ok: false, reason: 'failed' }).kind).toBe('error')
  })
})

describe('Saving a recipe (useVault.addRecipe)', () => {
  const base = { name: 'Penne', notes: '', recipeUrl: '', proteins: [], dietaryTags: [], dairyComponents: [], vegetables: [], fruits: [] }

  it('saves the ingredient list it was given, with the new id; nothing filled in the background', async () => {
    const { result } = renderHook(() => useVault('u1'))
    const fields = { ingredients_structured: LIST, ingredients_classified: null, servings: 4, ingredients_source: 'screenshot' }
    await act(async () => { await result.current.addRecipe({ ...base, ingredients: fields }) })
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({ name: 'Penne', ...fields })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(ri.fillRecipeIngredients).not.toHaveBeenCalled()
  })

  it('no list: saves at once, then estimates it in the background for that same recipe', async () => {
    const { result } = renderHook(() => useVault('u1'))
    await act(async () => { await result.current.addRecipe({ ...base, mainCarb: 'Pasta' }) })
    const row = insert.mock.calls[0][0]
    expect(row.ingredients_structured).toBeUndefined()
    await waitFor(() => expect(ri.fillRecipeIngredients).toHaveBeenCalledTimes(1))
    const [, user, recipe] = ri.fillRecipeIngredients.mock.calls[0]
    expect(user).toBe('u1')
    expect(recipe).toMatchObject({ id: row.id, name: 'Penne', main_carb: 'Pasta', ingredients_source: null })
  })

  it('a failed save fills nothing', async () => {
    insert.mockResolvedValue({ error: { message: 'offline' } })
    const { result } = renderHook(() => useVault('u1'))
    let out
    await act(async () => { out = await result.current.addRecipe(base) })
    expect(out.ok).toBe(false)
    expect(ri.fillRecipeIngredients).not.toHaveBeenCalled()
  })
})

describe('Changing tags never replaces a screenshot list; screenshots replace any list', () => {
  const SHOT_RECIPE = { id: 'r1', name: 'Penne', ingredients_structured: LIST, ingredients_source: 'screenshot', created_at: '2026-11-01' }

  it('re-extract after a tag change skips a screenshot recipe (no AI call)', async () => {
    rows.vault = [SHOT_RECIPE]
    const { result } = renderHook(() => useVault('u1'))
    await waitFor(() => expect(result.current.recipes).toHaveLength(1))
    let out
    await act(async () => { out = await result.current.reExtractIngredients('r1', { main_carb: 'Rice' }) })
    expect(out).toBeNull()
    expect(analyzeRecipe).not.toHaveBeenCalled()
  })

  it('readRecipeScreenshots reads the files and updates the recipe on screen', async () => {
    rows.vault = [{ ...SHOT_RECIPE, ingredients_source: 'estimated' }]
    const saved = { ingredients_structured: LIST, ingredients_classified: null, servings: 2, ingredients_source: 'screenshot' }
    ri.fillRecipeIngredients.mockResolvedValue(saved)
    const { result } = renderHook(() => useVault('u1'))
    await waitFor(() => expect(result.current.recipes).toHaveLength(1))
    let out
    await act(async () => { out = await result.current.readRecipeScreenshots('r1', [file('a.png'), file('b.png')]) })
    expect(out).toEqual({ ok: true, count: 2, list: LIST })
    const [, , recipe, opts] = ri.fillRecipeIngredients.mock.calls[0]
    expect(recipe.id).toBe('r1')
    expect(opts.images).toHaveLength(2)
    expect(result.current.recipes[0]).toMatchObject(saved)
  })

  it('readRecipeScreenshots: more than 3 → refused before any reading', async () => {
    rows.vault = [SHOT_RECIPE]
    const { result } = renderHook(() => useVault('u1'))
    await waitFor(() => expect(result.current.recipes).toHaveLength(1))
    let out
    await act(async () => { out = await result.current.readRecipeScreenshots('r1', [1, 2, 3, 4].map((n) => file(`${n}.png`))) })
    expect(out).toEqual({ ok: false, reason: 'too-many' })
    expect(ri.prepareScreenshot).not.toHaveBeenCalled()
  })
})
