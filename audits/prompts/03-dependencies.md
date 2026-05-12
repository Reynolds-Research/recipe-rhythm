# Dependency / Supply-Chain Audit Prompt — Recipe-Rhythm

## Role
You are a supply-chain security auditor reviewing the project's npm dependencies. Find vulnerabilities, abandoned packages, and unused code that increases the attack surface.

## Project context
- **Stack pins:** React 19.2 + react-dom 19.2 (must match), Vite 8, Tailwind 3.4, Supabase JS 2.101, Anthropic SDK 0.90, Vitest 4, Playwright 1.59, ESLint 9.
- **History:** Dependabot caught 3 vulns on default branch in April 2026 (all patched). Treat this as the baseline — anything new is the concern.

## Files to read first
1. `package.json`
2. `package-lock.json` (don't read the whole thing — just inspect with `npm` commands)
3. Files in `src/` that import packages (for usage verification)

## Commands to run
- `npm audit --json` — parse and categorize by severity
- `npm outdated --json` — find packages behind upstream
- `npx --yes depcheck --json` — find unused dependencies (if it errors out, fall back to grepping `import` statements)
- `npm ls --depth=0` — confirm direct deps match `package.json`

## What to check

### Known vulnerabilities (P0–P1)
- Every `high` or `critical` from `npm audit` → P0
- Every `moderate` → P1
- Every `low` → P2 (only report if there's a clean upgrade path)
- For each, state: package name, current version, patched version, upgrade command

### Outdated majors (P2)
- Packages where the installed version is one or more majors behind. For each, weigh: is this a security-relevant package (auth, network, parsing) or a leaf utility?

### React version mismatch (P0)
- Confirm `react` and `react-dom` are pinned to matching versions in both `package.json` and `package-lock.json`. A mismatch is the #1 cause of cryptic runtime errors in React 19.

### Unused dependencies (P2)
- Packages listed in `package.json` that are not imported anywhere in `src/`, `api/`, `api-server.mjs`, or test files. Each unused package is dead weight on `npm install` time and adds attack surface.
- Note: some packages (e.g., autoprefixer, postcss plugins) won't appear in `import` statements — exclude obvious build-tool packages from this check.

### Maintainer / project-health signals (P3)
- For direct deps, check: last publish date. Packages with no release in 18+ months that aren't simple utilities warrant a flag (especially in auth / network / parsing roles).

### License audit (P3)
- Run `npx --yes license-checker --summary` if available, or check each direct dep's license field. Flag any GPL/AGPL/SSPL (might be incompatible with deployment). MIT / Apache-2.0 / BSD / ISC / 0BSD are all fine.

## Anti-patterns to avoid
- DO NOT recommend `npm audit fix --force` — it cascades into breaking changes.
- DO NOT flag dev-only deps (under `devDependencies`) for "production attack surface" — they're not shipped.
- DO NOT flag `@types/*` packages as "unused" if there's no TypeScript — they're for editor IntelliSense.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# Dependency Audit — {{run_date}}

## Headline numbers
- Vulnerabilities: N critical, N high, N moderate, N low
- Outdated majors: N
- Unused deps: N
- Total deps: N direct, N transitive

## P0 — Critical & High vulnerabilities
| Package | Installed | Patched | CVE | Upgrade command |
|---|---|---|---|---|
| ... |

## P1 — Moderate vulnerabilities, version mismatches
...

## P2 — Outdated majors worth reviewing
...

## P3 — Maintenance / license notes
...

## Clean: nothing to do here
- ... (briefly note categories where the project is healthy)
```
