/**
 * Unit/integration test for the shared /api/classify-ingredients request
 * handler used by both the Express proxy (api-server.mjs) and the Vercel
 * mirror (api/classify-ingredients.js). Driven via mocked req/res — no
 * Express server spun up, no Vercel runtime invoked.
 */
import { describe, it, expect, vi } from 'vitest'
import { createClassifyIngredientsHandler } from '../../../api/_lib/classifyHandler.js'

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
  }
  res.status = vi.fn(code => { res.statusCode = code; return res })
  res.json = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v })
  return res
}

const okClient = { messages: { create: vi.fn() } } // truthy "anthropic" stand-in

describe('createClassifyIngredientsHandler', () => {
  it('returns 503 when no anthropic client is configured', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: null })
    const res = mockRes()
    await handler({ body: { ingredients: ['x'], recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'api_key_missing' })
  })

  it('rejects an empty ingredients array with 400', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { ingredients: [], recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_ingredients')
  })

  it('rejects a non-array ingredients value with 400', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { ingredients: 'beef, onion', recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_ingredients')
  })

  it('rejects ingredients containing non-string entries with 400', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { ingredients: ['ok', '', 42], recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_ingredients')
  })

  it('rejects an empty recipeName with 400', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { ingredients: ['x'], recipeName: '   ' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipe_name')
  })

  it('rejects a non-string cuisine with 400', async () => {
    const handler = createClassifyIngredientsHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { ingredients: ['x'], recipeName: 'X', cuisine: 42 } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_cuisine')
  })

  it('passes through the classifier output on the 200 path', async () => {
    const fakeOutput = {
      classifications: [
        { name: 'beef',  essentiality: 'essential', source: 'ai' },
        { name: 'onion', essentiality: 'omittable', source: 'ai' },
      ],
    }
    const classifyImpl = vi.fn().mockResolvedValue(fakeOutput)
    const handler = createClassifyIngredientsHandler({ anthropic: okClient, classifyImpl })

    const res = mockRes()
    await handler(
      { body: { ingredients: ['  beef  ', 'onion'], recipeName: '  Cheeseburgers  ', cuisine: 'American' } },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(fakeOutput)

    // Trims whitespace before delegating.
    expect(classifyImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: ['beef', 'onion'],
        recipeName: 'Cheeseburgers',
        cuisine: 'American',
        anthropicClient: okClient,
      }),
    )
  })

  it('returns 502 with sanitized error when the classifier throws ClassifyIngredientsError', async () => {
    const { ClassifyIngredientsError } = await import('../classifyIngredients.js')
    const classifyImpl = vi.fn().mockRejectedValue(
      new ClassifyIngredientsError('parse failure', { rawResponse: 'oops' }),
    )
    const handler = createClassifyIngredientsHandler({ anthropic: okClient, classifyImpl })

    const res = mockRes()
    await handler({ body: { ingredients: ['x'], recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'parse_failed' })
    // Raw response stays out of the client payload.
    expect(JSON.stringify(res.body)).not.toContain('oops')
  })

  it('returns 500 with sanitized error on any other classifier failure', async () => {
    const classifyImpl = vi.fn().mockRejectedValue(Object.assign(new Error('upstream 500'), { status: 500 }))
    const handler = createClassifyIngredientsHandler({ anthropic: okClient, classifyImpl })

    const res = mockRes()
    await handler({ body: { ingredients: ['x'], recipeName: 'X' } }, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'classification_failed' })
  })
})
