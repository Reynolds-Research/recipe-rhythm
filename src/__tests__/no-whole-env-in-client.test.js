/* global process */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Vite copies into the public bundle whatever app code reads from
// import.meta.env. Reading ONE setting (import.meta.env.VITE_X) copies that
// value; touching the WHOLE object (passing it around, spreading it, keys
// lookups) copies every VITE_ setting in the project — including any secret
// someone once named VITE_*. That leaked a key on a preview build on
// 2026-11-03 (PRD-008 2b-2). Companion to no-anthropic-sdk-in-client.test.js.

const SRC = join(process.cwd(), 'src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Drop comments so a warning written in a comment doesn't count. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// import.meta.env NOT followed by ".NAME" (e.g. `= import.meta.env`, `{...import.meta.env}`,
// `import.meta.env[key]`, `Object.keys(import.meta.env)`).
const WHOLE_ENV = /import\.meta\.env(?!\.[A-Za-z_])/

describe('client bundle hygiene: build settings', () => {
  it('app code reads import.meta.env one named setting at a time, never the whole object', () => {
    const hits = walk(SRC).filter((f) => WHOLE_ENV.test(code(readFileSync(f, 'utf8'))))
    expect(hits, `whole import.meta.env used in:\n${hits.join('\n')}`).toEqual([])
  })

  it('the check itself catches the risky forms and allows the safe one', () => {
    expect(WHOLE_ENV.test(code('export function f(env = import.meta.env) {}'))).toBe(true)
    expect(WHOLE_ENV.test(code('const all = { ...import.meta.env }'))).toBe(true)
    expect(WHOLE_ENV.test(code('import.meta.env[name]'))).toBe(true)
    expect(WHOLE_ENV.test(code('const u = import.meta.env.VITE_SUPABASE_URL'))).toBe(false)
    expect(WHOLE_ENV.test(code('// never pass import.meta.env around'))).toBe(false)
  })
})
