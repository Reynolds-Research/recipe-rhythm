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
const { insert, rows, update } = vi.hoisted(() => ({ insert: vi.fn(), rows: { vault: [] }, update: vi.fn() }))
vi.mock('../../../lib/supabase', () => {
  const chain = (table) => {
    const c = {}
    for (const k of ['select', 'eq', 'is', 'not', 'ilike', 'limit']) c[k] = () => c
    c.order = () => Promise.resolve({ data: table === 'vault' ? rows.vault : [], error: null })
    c.then = (res) => Promise.resolve({ data: [], error: null }).then(res)
    c.insert = insert
    c.update = (p) => { update(table, p); return c }
    return c
  }
  return { supabase: { from: vi.fn(chain) } }
})

import * as ri from '../../../lib/recipeIngredients'
import { analyzeRecipe } from '../../../lib/analyzeRecipe'
import RecipeForm from '../RecipeForm'
import RecipeSource from '../RecipeSource'
import { screenshotMessage, cleanLink } from '../recipeSourceHelpers'
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
    await user.upload(screen.getByLabelText(/Screenshots of the .*ingredients/), [file('a.png'), file('b.png')])

    expect(await screen.findByText('✓ 2 ingredients read from 2 screenshots · Serves 4')).toBeInTheDocument()
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
    await user.upload(screen.getByLabelText(/Screenshots of the .*ingredients/), [file('a.png')])
    expect(await screen.findByText('Reading screenshots…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save to vault/i })).toBeDisabled()
    await act(async () => finish(READ))
    expect(screen.getByRole('button', { name: /Save to vault/i })).toBeEnabled()
  })

  it('more than 3 screenshots: says so and reads nothing', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.upload(screen.getByLabelText(/Screenshots of the .*ingredients/),
      [file('1.png'), file('2.png'), file('3.png'), file('4.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick up to 3 screenshots.')
    expect(ri.readIngredients).not.toHaveBeenCalled()
  })

  it('no list found: says so; the recipe saves with no ingredients (filled in later)', async () => {
    ri.readIngredients.mockResolvedValue(null)
    const user = userEvent.setup()
    const onSubmit = renderForm()
    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Penne')
    await user.upload(screen.getByLabelText(/Screenshots of the .*ingredients/), [file('a.png')])
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
    await user.upload(screen.getByLabelText(/Screenshots of the .*ingredients/), [file('a.png')])
    await screen.findByText(/ingredients read from your screenshot/)
    await user.click(screen.getByRole('button', { name: /Auto-fill/ }))
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))
    expect(onSubmit.mock.calls[1][0].ingredients.ingredients_source).toBe('screenshot')
  })
})

describe("Recipe source (card and Add a recipe): link and screenshots side by side", () => {
  const DOUBLED = [{ name: 'penne pasta', quantity: '8 ounces', unit: 'ounces', notes: null },
    { name: 'onion', quantity: '1/2', unit: null, notes: 'chopped finely' }]
  function renderSource(over = {}) {
    const props = {
      name: 'Penne', link: null, onSaveLink: vi.fn(), source: null, servings: null, hasList: false, hasNames: true,
      onScreenshots: vi.fn(), onDismissRead: vi.fn(), ...over,
    }
    render(<RecipeSource {...props} />)
    return props
  }

  it('no source: "Add link" and "Add screenshots" side by side, as small actions, and a short status', () => {
    renderSource()
    expect(screen.getByRole('button', { name: 'Add link' }).className).not.toMatch(/btn-/)
    expect(screen.getByText('Add screenshots').closest('label').className).not.toMatch(/btn-/)
    expect(screen.getByTestId('ingredient-source')).toHaveTextContent('No amounts saved yet.')
  })

  it('no names either: "No ingredients yet."', () => {
    renderSource({ hasNames: false })
    expect(screen.getByTestId('ingredient-source')).toHaveTextContent('No ingredients yet.')
  })

  it('add a link right on the card: paste, Save → saved (https:// added), no Edit needed', async () => {
    const p = renderSource()
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await userEvent.type(screen.getByLabelText('Recipe link'), 'cooking.nytimes.com/recipes/penne')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.onSaveLink).toHaveBeenCalledWith('https://cooking.nytimes.com/recipes/penne')
  })

  it('Cancel saves nothing', async () => {
    const p = renderSource()
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.onSaveLink).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Recipe link')).not.toBeInTheDocument()
  })

  it('a saved link shows short, opens in a new tab, and can be changed (empty = removed)', async () => {
    const p = renderSource({ link: 'https://www.example.com/penne', hasList: true, source: 'estimated', servings: 4 })
    const a = screen.getByRole('link', { name: 'example.com/penne' })
    expect(a).toHaveAttribute('href', 'https://www.example.com/penne')
    expect(a).toHaveAttribute('target', '_blank')
    expect(screen.getByTestId('ingredient-source')).toHaveTextContent('Amounts estimated · Serves 4')
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await userEvent.clear(screen.getByLabelText('Recipe link'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(p.onSaveLink).toHaveBeenCalledWith(null)
  })

  it('from screenshots: says so, with Replace; no status line', () => {
    renderSource({ source: 'screenshot', hasList: true, servings: 4 })
    expect(screen.getByText('Amounts from your screenshots · Serves 4')).toBeInTheDocument()
    expect(screen.getByText('Replace').closest('label')).toBeInTheDocument()
    expect(screen.queryByTestId('ingredient-source')).not.toBeInTheDocument()
  })

  it('right after a read: a quiet "Here’s what I read" panel, no doubled units, closed by "Looks right"', async () => {
    const p = renderSource({ source: 'screenshot', hasList: true, servings: 4, justRead: DOUBLED })
    const panel = screen.getByRole('status', { name: 'Here’s what I read' })
    expect(panel).toHaveTextContent('Here’s what I read · Serves 4')
    expect(panel).toHaveTextContent('penne pasta — 8 ounces')
    expect(panel).not.toHaveTextContent('ounces ounces')
    expect(panel).toHaveTextContent('Saved for your grocery list.')
    expect(panel.className).not.toMatch(/dashed/)
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(p.onDismissRead).toHaveBeenCalledTimes(1)
  })

  it('picking screenshots hands them over; while reading, says so', async () => {
    const p = renderSource()
    await userEvent.upload(screen.getByLabelText("Screenshots of the Penne recipe's ingredients (up to 3)"), [file('a.png')])
    expect(p.onScreenshots).toHaveBeenCalledTimes(1)
  })

  it('reading and error states', () => {
    renderSource({ reading: true, error: 'Pick up to 3 screenshots.' })
    expect(screen.getByText('Reading screenshots…')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick up to 3 screenshots.')
  })

  it('cleanLink and result messages', () => {
    expect(cleanLink('  ')).toBeNull()
    expect(cleanLink('example.com/x')).toBe('https://example.com/x')
    expect(cleanLink('http://example.com')).toBe('http://example.com')
    expect(screenshotMessage({ ok: true, count: 1, list: LIST.slice(0, 1) }))
      .toEqual({ kind: 'done', message: '✓ Read 1 ingredients from your screenshots.', list: LIST.slice(0, 1) })
    expect(screenshotMessage({ ok: false, reason: 'too-many' }).message).toBe('Pick up to 3 screenshots.')
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

describe('setRecipeLink (card link without Edit)', () => {
  it('updates the screen at once and saves recipe_url for the household', async () => {
    rows.vault = [{ id: 'r1', name: 'Penne', recipe_url: null, created_at: '2026-11-01' }]
    const { result } = renderHook(() => useVault('u1'))
    await waitFor(() => expect(result.current.recipes).toHaveLength(1))
    let out
    await act(async () => { out = await result.current.setRecipeLink('r1', 'https://example.com/p') })
    expect(out).toEqual({ ok: true })
    expect(result.current.recipes[0].recipe_url).toBe('https://example.com/p')
    expect(update).toHaveBeenCalledWith('vault', { recipe_url: 'https://example.com/p' })
  })
})
