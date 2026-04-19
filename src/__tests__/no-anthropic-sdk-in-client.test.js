import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const FORBIDDEN = [
  '@anthropic-ai/sdk',
  'api.anthropic.com',
  'anthropic-dangerous-direct-browser-access',
  'VITE_ANTHROPIC_API_KEY',
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('client bundle hygiene', () => {
  const files = walk(SRC)

  for (const needle of FORBIDDEN) {
    it(`no client source references "${needle}"`, () => {
      const hits = files.filter(f => readFileSync(f, 'utf8').includes(needle))
      expect(hits, `found "${needle}" in:\n${hits.join('\n')}`).toEqual([])
    })
  }
})
