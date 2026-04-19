import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeRecipe } from '../analyzeRecipe'

describe('analyzeRecipe', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  it('returns parsed components from the proxy response', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        components: { cuisine_type: 'Italian', proteins: ['Beef'] },
      }),
    })

    const result = await analyzeRecipe('Spaghetti Bolognese')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/analyze-recipe',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(body.name).toBe('Spaghetti Bolognese')
    expect(result).toEqual({ cuisine_type: 'Italian', proteins: ['Beef'] })
  })

  it('returns null when the proxy responds with an error', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'api_key_missing' }),
    })

    const result = await analyzeRecipe('Pizza')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('network'))
    const result = await analyzeRecipe('Pizza')
    expect(result).toBeNull()
  })
})
