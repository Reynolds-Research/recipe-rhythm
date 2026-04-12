import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeRecipe } from '../analyzeRecipe'

describe('analyzeRecipe', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    global.fetch = vi.fn()
  })

  it('should parse valid JSON from the AI response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '{"cuisine_type": "Italian", "proteins": ["Beef"]}' }]
      })
    })

    const result = await analyzeRecipe('Spaghetti Bolognese')
    
    expect(global.fetch).toHaveBeenCalled()
    expect(result).toEqual({
      cuisine_type: 'Italian',
      proteins: ['Beef']
    })
  })

  it('should return null if API key is missing', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', '')
    const result = await analyzeRecipe('Pizza')
    expect(result).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' })
    })

    const result = await analyzeRecipe('Pizza')
    expect(result).toBeNull()
  })
})
