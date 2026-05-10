import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Skeleton from '../Skeleton'

describe('Skeleton', () => {
  it('renders with bg-gray-200 in the class list', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild.className).toContain('bg-gray-200')
  })

  it('merges custom className correctly', () => {
    const { container } = render(<Skeleton className="h-4 w-full" />)
    const el = container.firstChild
    expect(el.className).toContain('bg-gray-200')
    expect(el.className).toContain('h-4')
    expect(el.className).toContain('w-full')
  })

  it('has aria-hidden="true"', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})
