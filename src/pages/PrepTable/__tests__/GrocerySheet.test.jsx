import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GrocerySheet from '../GrocerySheet'

// Her real Nov 1–7 list, in the new shape (a few lines of it).
const ITEMS = [
  { id: 'av', name: 'avocado', quantity: '2', recipe_quantity: '1½', section: 'Produce', assumed: false },
  { id: 'bs', name: 'Brussels sprouts', quantity: '1½ lb', recipe_quantity: '1.5 lbs', section: 'Produce', assumed: false },
  { id: 'sh', name: 'shrimp', quantity: '1¼ lb', recipe_quantity: '1⅛ lb', section: 'Meat & Seafood', assumed: false },
  { id: 'cu', name: 'cumin', quantity: '1 jar', recipe_quantity: '2¼ tsp', section: 'Pantry', assumed: true },
  { id: 'so', name: 'soy sauce', quantity: '1 bottle', recipe_quantity: '3 tbsp', section: 'Pantry', assumed: true },
  { id: 'mi', name: 'mirin', quantity: '1 bottle', recipe_quantity: '2¼ tbsp', section: 'Pantry', assumed: true },
  { id: 'sa', name: 'salt', quantity: '1 box', recipe_quantity: '1½ tsp', section: 'Pantry', assumed: true },
]

function renderSheet(props = {}) {
  const onSetAssumed = vi.fn(async () => {})
  const onSetAlwaysHave = vi.fn(async () => {})
  const utils = render(
    <GrocerySheet
      open loading={false} items={ITEMS} staples={['olive oil']} leftOff={[]}
      subtitle="Nov 1 – 7 · 5 dinners"
      onSetAssumed={onSetAssumed} onSetAlwaysHave={onSetAlwaysHave} onClose={() => {}}
      {...props}
    />,
  )
  return { ...utils, onSetAssumed, onSetAlwaysHave }
}

describe('GrocerySheet — shop amounts', () => {
  it('shows what to buy, with what the recipes use under it when it differs', () => {
    renderSheet()
    const produce = screen.getByRole('region', { name: 'Produce' })
    expect(within(produce).getByText('Avocado')).toBeInTheDocument()
    expect(within(produce).getByText('2')).toBeInTheDocument()
    expect(within(produce).getByText('Recipes use 1½')).toBeInTheDocument()
    // 1½ lb to buy = 1.5 lbs in the recipes: no extra line
    expect(within(produce).queryByText(/Recipes use 1.5/)).not.toBeInTheDocument()
    expect(screen.getByText('Recipes use 1⅛ lb')).toBeInTheDocument()
  })

  it('shows the week and dinners under the title', () => {
    renderSheet()
    expect(screen.getByText('Nov 1 – 7 · 5 dinners')).toBeInTheDocument()
  })

  it('keeps assumed items off the list (no Pantry section here)', () => {
    renderSheet()
    expect(screen.queryByRole('region', { name: 'Pantry' })).not.toBeInTheDocument()
  })

  it('an old list (no recipe totals, nothing assumed) shows exactly as before', () => {
    renderSheet({
      items: [{ id: 'l', name: 'Limes', quantity: '6', section: 'Produce' }], staples: [],
    })
    expect(screen.getByText('Limes')).toBeInTheDocument()
    expect(screen.queryByText(/Recipes use/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Assumed you have' })).not.toBeInTheDocument()
  })
})

describe('GrocerySheet — Assumed you have', () => {
  it('is one collapsed line naming a few items', () => {
    renderSheet()
    const group = screen.getByRole('region', { name: 'Assumed you have' })
    expect(within(group).getByText('Cumin, Soy sauce, Mirin and 1 more')).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: 'Add Cumin' })).not.toBeInTheDocument()
  })

  it('Add puts it on the list and keeps an Undo in the group', async () => {
    const user = userEvent.setup()
    const { onSetAssumed, rerender } = renderSheet()
    await user.click(screen.getByRole('button', { name: /Assumed you have/ }))
    await user.click(screen.getByRole('button', { name: 'Add Soy sauce' }))
    expect(onSetAssumed).toHaveBeenCalledWith(expect.objectContaining({ id: 'so' }), false)

    // The parent swaps in the saved row (assumed: false).
    const saved = ITEMS.map((i) => (i.id === 'so' ? { ...i, assumed: false } : i))
    rerender(
      <GrocerySheet open loading={false} items={saved} staples={['olive oil']} leftOff={[]}
        onSetAssumed={onSetAssumed} onSetAlwaysHave={vi.fn()} onClose={() => {}} />,
    )
    expect(within(screen.getByRole('region', { name: 'Pantry' })).getByText('1 bottle')).toBeInTheDocument()
    expect(screen.getByText('On the list · 1 bottle')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo Soy sauce' }))
    expect(onSetAssumed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'so' }), true)
  })

  it('Always have saves it to her pantry list, with Undo', async () => {
    const user = userEvent.setup()
    const { onSetAlwaysHave } = renderSheet()
    await user.click(screen.getByRole('button', { name: /Assumed you have/ }))
    await user.click(screen.getByRole('button', { name: 'Always have Cumin' }))
    expect(onSetAlwaysHave).toHaveBeenCalledWith(expect.objectContaining({ id: 'cu' }), true)
    expect(await screen.findByText('Won’t show again · in your pantry list')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo Cumin' }))
    expect(onSetAlwaysHave).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'cu' }), false)
  })

  it('an item already in her pantry list is not shown; the footer names the list', async () => {
    const user = userEvent.setup()
    renderSheet({ staples: ['olive oil', 'cumin'] })
    await user.click(screen.getByRole('button', { name: /Assumed you have/ }))
    expect(screen.queryByRole('button', { name: 'Add Cumin' })).not.toBeInTheDocument()
    expect(screen.getByText('Not shown, in your pantry list: olive oil, cumin.')).toBeInTheDocument()
  })

  it('says so when a save fails, and changes nothing', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderSheet({ onSetAssumed: vi.fn(async () => { throw new Error('offline') }) })
    await user.click(screen.getByRole('button', { name: /Assumed you have/ }))
    await user.click(screen.getByRole('button', { name: 'Add Mirin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that")
    expect(screen.getByRole('button', { name: 'Add Mirin' })).toBeInTheDocument()
  })

  it('while one save runs, every Add / Always have waits (no lost pantry entry)', async () => {
    const user = userEvent.setup()
    let finish
    const onSetAlwaysHave = vi.fn(() => new Promise((r) => { finish = r }))
    renderSheet({ onSetAlwaysHave })
    await user.click(screen.getByRole('button', { name: /Assumed you have/ }))
    await user.click(screen.getByRole('button', { name: 'Always have Cumin' }))
    expect(screen.getByRole('button', { name: 'Always have Mirin' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Salt' })).toBeDisabled()
    finish()
    expect(await screen.findByText('Won’t show again · in your pantry list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Always have Mirin' })).toBeEnabled()
  })

  it('hides the group when nothing is assumed', () => {
    renderSheet({ items: ITEMS.filter((i) => !i.assumed) })
    expect(screen.queryByRole('region', { name: 'Assumed you have' })).not.toBeInTheDocument()
  })
})

// PRD-008 2c: her own lines (mockup "Grocery Share + Own Items Mockup").
describe('GrocerySheet — Added by you', () => {
  const OWN = [
    ...ITEMS,
    { id: 'pt', name: 'Paper towels', quantity: null, recipe_quantity: null, section: 'Other', assumed: false, is_adhoc: true },
  ]

  it('shows her own lines in "Added by you", not in a store section', () => {
    renderSheet({ items: OWN })
    const own = screen.getByRole('region', { name: 'Added by you' })
    expect(within(own).getByText('Paper towels')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Other' })).not.toBeInTheDocument()
  })

  it('adds a line from the box, then clears it', async () => {
    const user = userEvent.setup()
    const onAddOwn = vi.fn(async () => {})
    renderSheet({ onAddOwn })
    const box = screen.getByRole('textbox', { name: 'Add your own item' })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.type(box, 'Bananas{Enter}')

    expect(onAddOwn).toHaveBeenCalledWith('Bananas')
    expect(box).toHaveValue('')
  })

  it('✕ removes one of her lines', async () => {
    const user = userEvent.setup()
    const onRemoveOwn = vi.fn(async () => {})
    renderSheet({ items: OWN, onRemoveOwn })
    await user.click(screen.getByRole('button', { name: 'Remove Paper towels' }))
    expect(onRemoveOwn).toHaveBeenCalledWith(expect.objectContaining({ id: 'pt' }))
  })

  it("a failed save says so and keeps what she typed", async () => {
    const user = userEvent.setup()
    const onAddOwn = vi.fn(async () => { throw new Error('offline') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderSheet({ onAddOwn })
    const box = screen.getByRole('textbox', { name: 'Add your own item' })
    await user.type(box, 'Bananas')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that")
    expect(box).toHaveValue('Bananas')
  })

  it('recipe lines have no remove button', () => {
    renderSheet({ items: OWN })
    expect(screen.queryByRole('button', { name: 'Remove Avocado' })).not.toBeInTheDocument()
  })
})
