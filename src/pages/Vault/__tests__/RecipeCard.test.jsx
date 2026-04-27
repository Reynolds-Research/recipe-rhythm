import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
