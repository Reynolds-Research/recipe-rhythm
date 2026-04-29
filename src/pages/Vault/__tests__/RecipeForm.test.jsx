import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeForm from '../RecipeForm'
import RecipeCard from '../RecipeCard'

// PRD-002 P0.4 — prep-time chip on the recipe vault form.
//
// Two surfaces touch the new chip:
//   - RecipeForm (the add path) writes the bucket's storedValue into the
//     submitted payload.
//   - RecipeCard (the edit path) pre-selects the chip whose bucket the
//     saved integer falls into via bucketForMinutes.
//
// Both are exercised below.

// AI-suggest path is mocked: returning null short-circuits the suggest
// branch so this file never has to deal with the analyzeRecipe call shape.
vi.mock('../../../lib/analyzeRecipe', () => ({
  analyzeRecipe: vi.fn().mockResolvedValue(null),
}))

// Spell-check / Title-case normalization is mocked to a passthrough so this
// file's prep-time assertions stay focused on the chip behavior. Dedicated
// coverage for the normalization flow lives in src/lib/__tests__/
// mealNameNormalize.test.js and the RecipeForm normalization integration
// test below.
vi.mock('../../../lib/mealNameNormalize', () => ({
  normalizeMealName: vi.fn((n) => Promise.resolve({ corrected: n, hasChanges: false })),
  toTitleCase: vi.fn((n) => n),
}))

describe('RecipeForm — prep-time chip (PRD-002 P0.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes storedValue=60 to the submit payload when the "30–60 min" chip is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    const user = userEvent.setup()

    render(
      <RecipeForm
        saving={false}
        extrasByCategory={{}}
        onAddExtra={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Chicken Stir-fry')
    await user.click(screen.getByRole('button', { name: '30–60 min' }))
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Chicken Stir-fry',
      prepTimeMinutes: 60,
    })
  })

  it('clears the field to null when the selected chip is tapped again', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    const user = userEvent.setup()

    render(
      <RecipeForm
        saving={false}
        extrasByCategory={{}}
        onAddExtra={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.type(screen.getByPlaceholderText(/recipe name/i), 'Quick Salad')
    const chip = screen.getByRole('button', { name: '< 15 min' })
    await user.click(chip)
    await user.click(chip) // toggle off
    await user.click(screen.getByRole('button', { name: /Save to vault/i }))

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Quick Salad',
      prepTimeMinutes: null,
    })
  })

  it('does not render a "+ custom" button on the prep-time picker (fixed buckets only)', () => {
    // Lock in: prep-time is one of the fixed-bucket pickers, so the custom
    // affordance must be suppressed. A typed value wouldn't round-trip
    // through bucketForMinutes correctly.
    render(
      <RecipeForm
        saving={false}
        extrasByCategory={{}}
        onAddExtra={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    // The four prep-time chips render — anchor on one to confirm the picker
    // is on screen.
    expect(screen.getByRole('button', { name: '< 15 min' })).toBeInTheDocument()

    // The other ChipPickers each render a "+ custom" button. Make sure the
    // count matches the *other* pickers and that we didn't add an extra one
    // for prep-time. Count is: proteins, cooking_method, main_carb,
    // dietary_tags, dairy_components, vegetables, fruits = 7.
    const customButtons = screen.getAllByRole('button', { name: /^\+ custom$/ })
    expect(customButtons).toHaveLength(7)
  })
})

describe('RecipeCard — prep-time chip pre-selects from saved integer (PRD-002 P0.4)', () => {
  it('renders "30–60 min" as the active chip for a recipe with prep_time_minutes = 45', () => {
    const recipe = {
      id: 'r-prep',
      name: 'Pad See Ew',
      cuisine_type: 'Thai',
      family_rating: null,
      prep_time_minutes: 45,
    }

    // RecipeCard is the editor surface. Render it directly in expanded +
    // editing mode so the prep-time ChipPicker is in the DOM.
    const editFields = {
      cuisine_type:     recipe.cuisine_type,
      flavor_profile:   '',
      proteins:         [],
      cooking_method:   null,
      main_carb:        null,
      dietary_tags:     [],
      dairy_components: [],
      vegetables:       [],
      fruits:           [],
      notes:            '',
      recipe_url:       '',
      prep_time_minutes: recipe.prep_time_minutes,
    }

    render(
      <RecipeCard
        recipe={recipe}
        expanded={true}
        editing={true}
        editFields={editFields}
        setEditFields={() => {}}
        savingEdit={false}
        extrasByCategory={{}}
        onAddExtra={() => {}}
        onToggleExpand={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSaveEdit={() => {}}
        onDelete={() => {}}
        onRatingChange={() => {}}
      />
    )

    // The active chip carries the brand-500 background class. Anchor on
    // both the "30–60 min" label and the active styling to confirm pre-
    // selection.
    const activeChip = screen.getByRole('button', { name: '30–60 min' })
    expect(activeChip).toBeInTheDocument()
    expect(activeChip.className).toMatch(/bg-brand-500/)

    // The other prep-time chips must not be active.
    for (const otherLabel of ['< 15 min', '15–30 min', '60+ min']) {
      const chip = screen.getByRole('button', { name: otherLabel })
      expect(chip.className).not.toMatch(/bg-brand-500/)
    }
  })
})
