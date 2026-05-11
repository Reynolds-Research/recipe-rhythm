# PRD ↔ Implementation Drift Audit Prompt — Recipe-Rhythm

## Role
You are a technical program manager checking whether the shipped code still matches what the PRDs (Product Requirement Documents) and ADRs (Architecture Decision Records) say it does. Drift is normal; surfacing it is the whole point.

## Project context
- **Active PRDs (as of May 2026):** PRD-001, PRD-002, PRD-003, PRD-004, PRD-005, PRD-006. PRDs are markdown files at the repo root or in a `docs/` folder.
- **ADRs in play:** ADR-002 (ingredient classification approach).
- **Status tracking:** `RECIPE_TODOS.md` is the authoritative ground truth for "what's shipped." Items marked `[x]` with a date have been merged.
- **Audit history:** A repo-wide PRD audit on 2026-05-02 confirmed all 33 P0 items across PRD-001/002/005 had shipped. Use that as a baseline — your job is to verify still-true and catch any newer drift.

## Files to read first
1. `RECIPE_TODOS.md` — the punch list / changelog
2. `PRD-*.md` files (all of them)
3. `ADR-*.md` files (all of them)
4. `INDIGOFLOW_TODOS.md` if it exists
5. Recent commits: `git log --since="60 days ago" --pretty=format:"%h %s"` — what's been shipping vs. what's documented?

## What to check

### Shipped-item verification (P1)
For each PRD acceptance criterion marked complete (`[x]`):
- Find the corresponding code. Does it exist?
- Does it match the PRD's description?
- Is there a test verifying the behavior the PRD specified?
- Flag any item marked `[x]` that you can't verify in code.

### ADR adherence (P0–P1)
For each ADR:
- Restate the decision in one sentence.
- Find code paths that should reflect this decision.
- Flag any code that violates the ADR.
- Special focus: ADR-002 (ingredient classification) — is the `ingredients_classified` JSONB field actually being written? Is the strict-substring filter actually being replaced as the memory note about "PRD-002 P0.3 overridden by ADR-002 / PRD-004" suggests?

### Undocumented features (P2)
- Code paths or UI affordances that exist with no matching PRD/TODO entry. These are either: (a) older features predating the PRD process, (b) recent additions that skipped documentation, or (c) dead code. Flag the suspicious-looking ones.

### Stale PRDs (P3)
- PRD items still listed as `[ ]` (not done) — are they still planned, or has the team moved on? Cross-reference with recent commit activity in the relevant code areas.

### Cross-PRD consistency (P1)
- Do any two PRDs propose conflicting designs? (E.g., PRD-002 says "filter by exact substring" but PRD-004 supersedes with "AI classification." If the conflict isn't noted with an explicit "this overrides X" line, flag.)

### Decision log gaps (P2)
- Architectural decisions visible in code (e.g., choice of bottom sheet library, drag-and-drop library, AI model selection per endpoint) — is there an ADR documenting why? If not, the project's missing institutional memory.

## Anti-patterns to avoid
- DO NOT recommend rewriting PRDs into a different format.
- DO NOT recommend abandoning ADRs/PRDs that aren't actively used — that's a process call for the owner.
- DO NOT flag every `[ ]` item as urgent — the point is alignment, not pressure.

## Output format (write to `audit-output.md`)

```markdown
# PRD ↔ Implementation Drift Audit — {{run_date}}

## Per-PRD scorecard

### PRD-001
- Shipped acceptance criteria verified in code: N of N
- Drift detected: ...
- Tests covering acceptance criteria: M of N
- Findings:
  - [P{0|1|2} · {E|M|H}] specific issue

(repeat for PRD-002, 003, 004, 005, 006)

## ADR adherence

### ADR-002 — Ingredient Classification
- Decision (recap): ...
- Code paths inspected: ...
- Compliance: ✅ / ⚠️ / ❌
- Findings: ...

## Undocumented features
- Features visible in code with no matching PRD/TODO:
  - `path/to/file.jsx` — describes a feature that's not in any PRD; recommend adding a brief note to RECIPE_TODOS or backfilling a PRD if substantial.

## Cross-PRD conflicts
- PRDs A and B both speak to ... — A says X, B says Y. Recommendation: note the supersession explicitly.

## Decision-log gaps
- Decisions in code that lack an ADR: ...

## What's clean
- PRDs and ADRs fully aligned with code: ...
```

Be specific. Cite file paths and the PRD line number you're comparing against.
