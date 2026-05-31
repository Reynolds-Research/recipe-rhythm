/**
 * Tests for api/_lib/assertProductionConfig.js
 *
 * All env manipulation uses vi.stubEnv so that vi.unstubAllEnvs() restores
 * original state in afterEach. vi.resetModules() before each test ensures the
 * module-level _warned Set is fresh so deduplication checks are reliable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('assertProductionConfig', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // ── production: missing vars ────────────────────────────────────────────────

  describe('VERCEL_ENV=production + var missing → throws', () => {
    it('throws an Error (not just any rejection)', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('PROD_VAR_A', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['PROD_VAR_A'], 'svc-a')).toThrow(Error)
    })

    it('error message contains the module name', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('PROD_VAR_A', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['PROD_VAR_A'], 'my-module'))
        .toThrow('[config] my-module')
    })

    it('error message contains each missing var name', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('PROD_VAR_X', '')
      vi.stubEnv('PROD_VAR_Y', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      let err
      try {
        assertProductionConfig(['PROD_VAR_X', 'PROD_VAR_Y'], 'svc')
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toContain('PROD_VAR_X')
      expect(err.message).toContain('PROD_VAR_Y')
    })

    it('counts a var as missing when it is set to an empty string', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('EMPTY_VAR', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['EMPTY_VAR'], 'svc')).toThrow()
    })
  })

  // ── production: all vars present → no throw, no log ────────────────────────

  describe('VERCEL_ENV=production + all vars present → silent pass', () => {
    it('does not throw', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('PRESENT_PROD_VAR', 'real-value')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['PRESENT_PROD_VAR'], 'svc')).not.toThrow()
    })

    it('does not log a warning', async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('PRESENT_PROD_VAR', 'real-value')
      const warnSpy = vi.spyOn(console, 'warn')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      assertProductionConfig(['PRESENT_PROD_VAR'], 'svc')
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  // ── local dev (VERCEL_ENV unset) + var missing → warn once, never throw ────

  describe('VERCEL_ENV unset (local dev) + var missing → warn once, no throw', () => {
    it('does not throw', async () => {
      // VERCEL_ENV is not set in local test runs; ensure it is absent
      vi.stubEnv('LOCAL_VAR', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['LOCAL_VAR'], 'local-svc')).not.toThrow()
    })

    it('logs a warning exactly once even when called multiple times', async () => {
      vi.stubEnv('LOCAL_VAR', '')
      const warnSpy = vi.spyOn(console, 'warn')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      assertProductionConfig(['LOCAL_VAR'], 'dedup-svc')
      assertProductionConfig(['LOCAL_VAR'], 'dedup-svc')
      assertProductionConfig(['LOCAL_VAR'], 'dedup-svc')
      const calls = warnSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('dedup-svc'),
      )
      expect(calls).toHaveLength(1)
    })
  })

  // ── preview (VERCEL_ENV=preview) + var missing → warn, never throw ─────────

  describe('VERCEL_ENV=preview + var missing → no throw', () => {
    it('does not throw', async () => {
      vi.stubEnv('VERCEL_ENV', 'preview')
      vi.stubEnv('PREVIEW_VAR', '')
      const { assertProductionConfig } = await import('../../../api/_lib/assertProductionConfig.js')
      expect(() => assertProductionConfig(['PREVIEW_VAR'], 'preview-svc')).not.toThrow()
    })
  })
})
