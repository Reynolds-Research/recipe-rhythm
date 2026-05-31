/**
 * Tests for api/_lib/supabaseAdmin.js
 *
 * Focuses on two behaviors introduced by the assertProductionConfig wiring:
 *   1. Production cold-start throws at module import when required vars are absent.
 *   2. Non-production null export is preserved (fail-open for caching).
 *
 * Also covers normalizeForCache which lives in the same module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}))

describe('supabaseAdmin — production throw at module import', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws at import when VERCEL_ENV=production and SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    await expect(import('../../../api/_lib/supabaseAdmin.js'))
      .rejects.toThrow('[config] supabaseAdmin')
  })

  it('throws at import when VERCEL_ENV=production and SUPABASE_URL is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    await expect(import('../../../api/_lib/supabaseAdmin.js'))
      .rejects.toThrow('[config] supabaseAdmin')
  })

  it('throws at import when VERCEL_ENV=production and both vars are missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    await expect(import('../../../api/_lib/supabaseAdmin.js'))
      .rejects.toThrow('[config] supabaseAdmin')
  })

  it('does not throw at import when VERCEL_ENV=production and both vars are present', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    await expect(import('../../../api/_lib/supabaseAdmin.js')).resolves.toBeDefined()
  })
})

describe('supabaseAdmin — non-production null export (fail-open)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exports null when VERCEL_ENV is unset and vars are missing', async () => {
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const { supabaseAdmin } = await import('../../../api/_lib/supabaseAdmin.js')
    expect(supabaseAdmin).toBeNull()
  })

  it('exports a client when vars are present (non-production)', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    const { supabaseAdmin } = await import('../../../api/_lib/supabaseAdmin.js')
    expect(supabaseAdmin).not.toBeNull()
  })
})

describe('normalizeForCache', () => {
  // normalizeForCache is pure — no env or module state needed.
  // Import once for the whole describe block.
  let normalizeForCache

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    ;({ normalizeForCache } = await import('../../../api/_lib/supabaseAdmin.js'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lowercases and trims the string', () => {
    expect(normalizeForCache('  Hello World  ')).toBe('hello world')
  })

  it('collapses multiple whitespace to a single space', () => {
    expect(normalizeForCache('chicken   tikka  masala')).toBe('chicken tikka masala')
  })

  it('returns empty string for non-string input', () => {
    expect(normalizeForCache(null)).toBe('')
    expect(normalizeForCache(undefined)).toBe('')
    expect(normalizeForCache(42)).toBe('')
  })

  it('returns empty string for empty/whitespace-only input', () => {
    expect(normalizeForCache('')).toBe('')
    expect(normalizeForCache('   ')).toBe('')
  })
})
