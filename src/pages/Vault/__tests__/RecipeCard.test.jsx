import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeCard from '../RecipeCard'

// PRD-002 P0.9 — AI candidates render with a "New" badge so users can tell
// AI suggestions apart from saved vault entries. Vault rows show no badge.

const baseRecipe = {
  id: 'r-1',
  name: 'Pad Thai',
  cuisine_type: 'Thai',
  family_rating: null,
}

const baseProps = {
  expanded: false,
  editing: false,
  editFields: {},
  setEditFields: () => {},
  savingEdit: false,
  extrasByCategory: {},
  onAddExtra: () => {},
  onToggleExpand: () => {},
  onStartEdit: () => {},
  onCancelEdit: () => {},
  onSaveEdit: () => {},
  onDelete: () => {},
  onRatingChange: () => {},
}

const baseClassified = [
  { name: 'onion',  essentiality: 'omittable', source: 'ai'   },
  { name: 'garlic', essentiality: 'essential', source: 'user' },
]

describe('RecipeCard — AI source badge (PRD-002 P0.9)', () => {
  it('renders the "New" badge when source="ai"', () => {
    render(<RecipeCard recipe={baseRecipe} source="ai" {...baseProps} />)

    const badge = screen.getByRole('status', { name: /AI suggestion/i })
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toMatch(/New/)
  })

  it('renders the "New" badge when recipe.source="ai" (badge reads from the recipe object)', () => {
    render(<RecipeCard recipe={{ ...baseRecipe, source: 'ai' }} {...baseProps} />)

    const badge = screen.getByRole('status', { name: /AI suggestion/i })
    expect(badge).toBeInTheDocument()
  })

  it('does NOT render the "New" badge when source="vault"', () => {
    render(<RecipeCard recipe={baseRecipe} source="vault" {...baseProps} />)

    expect(
      screen.queryByRole('status', { name: /AI suggestion/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/^New$/)).not.toBeInTheDocument()
  })

  it('does NOT render the "New" badge when no source is provided (current vault behavior)', () => {
    render(<RecipeCard recipe={baseRecipe} {...baseProps} />)

    expect(
      screen.queryByRole('status', { name: /AI suggestion/i }),
    ).not.toBeInTheDocument()
  })
})

describe('RecipeCard — ingredient essentiality (PRD-004 Phase D)', () => {
  function renderExpanded(recipeOverrides = {}, propOverrides = {}) {
    const onChange = vi.fn()
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: baseClassified, ...recipeOverrides }}
        {...baseProps}
        expanded
        onIngredientEssentialityChange={onChange}
        {...propOverrides}
      />
    )
    return { onChange }
  }

  it('renders a badge for every classified ingredient when expanded', () => {
    renderExpanded()
    expect(screen.getByRole('listitem', { name: /onion/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /garlic/i })).toBeInTheDocument()
  })

  it('does NOT render the section when ingredients_classified is null', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: null }}
        expanded
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('does NOT render the section when ingredients_classified is an empty array', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: [] }}
        expanded
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('does NOT render the section when the card is collapsed', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: baseClassified }}
        expanded={false}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('clicking an essential badge calls onChange with the omittable target', async () => {
    const { onChange } = renderExpanded()
    const garlic = screen.getByRole('listitem', { name: /garlic/i })
    await userEvent.setup().click(garlic)
    expect(onChange).toHaveBeenCalledWith('r-1', 'garlic', 'omittable')
  })

  it('clicking an omittable badge calls onChange with the essential target', async () => {
    const { onChange } = renderExpanded()
    const onion = screen.getByRole('listitem', { name: /onion/i })
    await userEvent.setup().click(onion)
    expect(onChange).toHaveBeenCalledWith('r-1', 'onion', 'essential')
  })

  it('exposes user-override provenance in the accessible label', () => {
    renderExpanded()
    // garlic in baseClassified has source: 'user'
    expect(screen.getByRole('listitem', { name: /garlic.*you set this/i })).toBeInTheDocument()
  })

  it('omits the user-override marker for ai-source entries in the accessible label', () => {
    renderExpanded()
    // onion in baseClassified has source: 'ai'
    const onion = screen.getByLabelText(/onion: omittable\. Tap/i)
    expect(onion).toBeInTheDocument()
    expect(onion.getAttribute('aria-label')).not.toMatch(/you set this/i)
  })

  it('clicking a badge does NOT fire the expand toggle (stopPropagation)', async () => {
    const onToggleExpand = vi.fn()
    renderExpanded({}, { onToggleExpand })
    const onion = screen.getByRole('listitem', { name: /onion/i })
    await userEvent.setup().click(onion)
    expect(onToggleExpand).not.toHaveBeenCalled()
  })
})

describe('RecipeCard — last-cooked badge (PRD-001 P1.3)', () => {
  it('renders "Last cooked X days ago" when last_cooked_on is set', () => {
    const today = new Date()
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
    const y = fiveDaysAgo.getFullYear()
    const m = String(fiveDaysAgo.getMonth() + 1).padStart(2, '0')
    const d = String(fiveDaysAgo.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        {...baseProps}
      />
    )
    expect(screen.getByText(/Last cooked 5 days ago/i)).toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is null', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: null }}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is missing entirely', () => {
    render(<RecipeCard recipe={baseRecipe} {...baseProps} />)
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is a future date (defensive)', () => {
    const today = new Date()
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const d = String(tomorrow.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('shows the badge in the collapsed card (always visible at a glance)', () => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000)
    const y = yesterday.getFullYear()
    const m = String(yesterday.getMonth() + 1).padStart(2, '0')
    const d = String(yesterday.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        expanded={false}
        {...baseProps}
      />
    )
    expect(screen.getByText(/Last cooked yesterday/i)).toBeInTheDocument()
  })
})
