# Prompt — Generate a CLAUDE.md for any project

> **For:** Claude Code, running in any codebase
> **Use:** Paste this prompt into a fresh Claude Code session at the root of a project that doesn't yet have a `CLAUDE.md`. Claude Code will investigate the codebase, ask clarifying questions, and write a tailored project-memory file.

---

## Goal

Create a `CLAUDE.md` at the repo root that future Claude Code sessions will read on launch. The file is **project memory** — it tells Claude Code what this codebase is, how it's organized, what conventions to follow, and what the recurring gotchas are.

## Why this matters

A new Claude Code session has no memory of prior work. Without project memory, every session has to re-discover the layout, conventions, and gotchas — which leads to inconsistent output across sessions. Writing `CLAUDE.md` once gives every future session the context it needs upfront.

## Steps

### Step 1 — Investigate the codebase (silently)

Read these files to gather context. You don't need to summarize for me; just absorb the information.

- `README.md` (and any `README.*` variants) — high-level project description
- The dependency manifest for the stack: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `Gemfile` / `composer.json` / etc.
- Framework/build configs: `tsconfig.json`, `vite.config.*`, `next.config.*`, `tailwind.config.*`, `webpack.config.*`, `Makefile`, etc.
- Top-level directory listing — names of folders and their apparent purpose
- `docs/` if it exists — schema docs, ADRs, PRDs, architecture overviews
- `.github/workflows/` if it exists — CI conventions
- A few representative source files to understand conventions: import style, where tests live, component / module patterns
- `git log --oneline -20` for recent activity
- `git branch -a | head -30` for branch naming patterns (look at both local and origin)
- Any existing `CLAUDE.md` — **do not overwrite blindly**; if one exists, ask the user whether to extend or replace

### Step 2 — Ask the user clarifying questions

Before writing, ask the user about anything you can't infer from the codebase. Likely candidates:

- "Is this a solo project, team project, or open source?"
- "What's the branch lifecycle — main-only, feature branches with PRs, gitflow?"
- "Are migrations / deploys applied manually or via CI? Anything about that I should warn future sessions about?"
- "Are there existing planning docs (PRDs, ADRs, design docs) I should point Claude Code at as the source of truth?"
- "Any common gotchas you've hit that are worth flagging for future sessions?"
- "Is there a 'planning surface' separate from 'execution surface' (e.g., Claude.ai for planning, Claude Code for execution)? Or is everything happening in this one tool?"

**Do not invent answers.** Better to ask one question and get the right `CLAUDE.md` than to write generic boilerplate.

### Step 3 — Write the file

Create `CLAUDE.md` at the repo root, following this template. **Adapt every section to what you actually found**; omit sections that don't apply.

```markdown
# Claude Code Project Memory — <Project Name>

> Read this file first at the start of every session. It tells you what this codebase is, how it's organized, and the conventions to follow. If a user-supplied prompt references files or patterns you don't recognize, start here.

## What this project is
<one paragraph: what it does, who uses it, the scope; primary surfaces with file paths>

## Tech stack (verified against <package.json / equivalent>)
<actual versions of major dependencies — not what docs claim, what's installed>
<flag any contradictions between documented stack and reality>

## Repo layout
<top-level directories with one-line purposes; point to where source / tests / docs / migrations / etc. live>

## Documentation (sources of truth)
<list any PRDs, ADRs, design docs, schema docs that exist; note that Claude Code should read these first when working on a feature in their area>

## Workflow conventions
<how planning vs execution work in this project; whether prompts are pre-authored; testing/lint/format expectations>

## Branch lifecycle
<branch naming convention, PR conventions, merge style, cleanup expectations after merge>

## Cross-branch / cross-worktree reading
<the `git show <ref>:<path>` pattern; warn against direct worktree access if relevant>

## Migration etiquette (if the project has migrations)
<idempotency, signature-change gotchas, verification, RLS requirements, schema doc updates>

## Test conventions
<where tests live, what framework, any mocking patterns to follow>

## Common gotchas (real ones the team has hit)
<list of recurring issues and the fix; only include ones the user has actually encountered>

## When in doubt
<what to read first; when to ask the user>
```

### Step 4 — Confirm with the user

After writing the file, show it to the user and ask:

- "Anything wrong, missing, or over-stated?"
- "Any sections that feel generic and need to be more specific to your situation?"
- "Any gotchas I should add that I couldn't see from the codebase alone?"

Iterate until the user is satisfied.

## Constraints

- **Do NOT include speculative content.** Every line should be either verifiable from the codebase or confirmed by the user.
- **Do NOT duplicate documentation that lives elsewhere.** If the project has a `docs/architecture.md`, link to it — don't restate its contents in `CLAUDE.md`.
- **Do NOT include feature backlogs, roadmaps, or open TODOs.** Project memory is about *how the project works*, not *what's coming next*. Roadmaps belong in TODO files.
- **Keep it tight — 80 to 150 lines is the sweet spot.** Future Claude Code sessions read this on every session start; verbose memory dilutes attention.
- **Use plain markdown.** No custom syntax, no fancy frontmatter, no embedded HTML. Future sessions need to parse this reliably.
- **Cite specific file paths** wherever possible (`src/pages/Home.jsx`, not "the home page component"). Concrete paths are cheap and immensely valuable for navigation.

## Out of scope

- Don't update existing documentation as part of this task (PRDs, ADRs, schema docs stay untouched)
- Don't add tests, CI, or other tooling
- Don't restructure the repo
- Don't generate new prompts in `docs/prompts/` (or wherever the project keeps them) — `CLAUDE.md` only

## When you finish

1. Show the user the final `CLAUDE.md`
2. Suggest they commit it: `git add CLAUDE.md && git commit -m "docs: add CLAUDE.md project memory"`
3. Suggest they verify it works by starting a fresh Claude Code session and asking it a project-level question — the response should reflect knowledge of `CLAUDE.md`'s contents
