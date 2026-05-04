# cooking_method Regression Report
**Date:** 2026-05-03  
**Scope:** `/api/analyze-recipe` — `cooking_method` extraction for Spaghetti Carbonara  
**Verdict:** ❌ Bite α is NOT the cause. Pre-existing prompt ambiguity.

---

## 1. Prompt diff (relevant lines only)

`git diff e102450..103eb1c -- src/lib/constants.js` shows one change to `buildAnalyzeRecipePromptBlock()`:

```diff
-  "prep_time_minutes": positive integer estimate of total prep + cook time in minutes, or null if you cannot reasonably estimate
+  "prep_time_minutes": positive integer estimate of total prep + cook time in minutes, or null if you cannot reasonably estimate,
+  "servings": integer number of portions this recipe yields, or null if the recipe text does not state it,
+  "ingredients_structured": [{"name": ingredient name (required, e.g. "olive oil"), "quantity": measurement value as written (e.g. "2 tbsp", "1/2 cup") or null if not given, "unit": unit of measurement if separable from quantity (e.g. "tbsp", "cup") or null when no unit applies (e.g. for "3 eggs"), "notes": any prep or handling notes for this ingredient (e.g. "diced", "room temperature", "to taste") or null if none}]
```

Plus a new line appended in `api/_lib/analyzeRecipeHandler.js` after the JSON block:

```diff
+textPrompt += '\n\nIMPORTANT: In ingredients_structured, include every ingredient from the recipe. If an ingredient cannot be cleanly parsed, include it with name populated and quantity/unit/notes set to null. Never omit an ingredient.'
```

The `cooking_method` instruction itself is **unchanged** between the two commits:

```
"cooking_method": one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null,
```

---

## 2. Hypothesis (formed before live tests)

The `ingredients_structured.notes` field asks the model to annotate each ingredient with preparation notes (e.g. "diced", "pan-seared"). For Carbonara, the pancetta step generates a note like "rendered in a pan" or "pan-fried," anchoring "pan" and "sear" in the model's working context. When `cooking_method` is then resolved, the model reaches for the most recently activated cooking-technique token — `Pan-seared`.

---

## 3. Live test results

**Input:** `{"name":"Spaghetti Carbonara"}` → both tests identical input.

| | `cooking_method` | Full response |
|---|---|---|
| **Test A** — Bite α prompt (with `ingredients_structured`, `servings`, IMPORTANT note) | **`"Pan-seared"`** | `cuisine_type: Italian, flavor_profile: Rich, proteins: [Pork, Eggs], cooking_method: Pan-seared, main_carb: Pasta, prep_time_minutes: 30, servings: 4, servings_inferred: true` |
| **Test B** — Pre-Bite α prompt (those three additions removed) | **`"Pan-seared"`** | `cuisine_type: Italian, flavor_profile: Rich, proteins: [Pork, Eggs], cooking_method: Pan-seared, main_carb: Pasta, prep_time_minutes: 30` |

**Both tests return the same wrong answer.**

---

## 4. Revised hypothesis — confirmed

**Bite α did not introduce this bug.** The pre-existing `cooking_method` instruction carries no dish-level scoping. It simply lists the vocabulary and says "one of [...]", giving the model no guidance on whether to pick the primary technique of the finished dish or any prominent sub-step preparation.

For Spaghetti Carbonara, the model has two competing signals:
- Boiling pasta (dominant, but low-salience — boiling is implicit and unremarkable)
- Rendering pancetta in a pan (salient, active, distinctive cooking action)

Without an explicit instruction that `cooking_method` should be **the primary technique of the finished dish**, the model reliably picks the more salient sub-step. This behavior exists identically in both the pre- and post-Bite α prompts.

The original hypothesis about `ingredients_structured.notes` bleeding into `cooking_method` is **disproven** by Test B. The bug's origin predates Bite α.

---

## 5. Proposed fix

### Recommendation: Smallest fix — add dish-level scoping to the existing `cooking_method` instruction

**Current line** (in `buildAnalyzeRecipePromptBlock()` in `src/lib/constants.js`):
```
"cooking_method": one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null,
```

**Proposed replacement:**
```
"cooking_method": the PRIMARY technique by which the finished dish is cooked — one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null. Choose the method that defines the dish as a whole, not a sub-step for a single ingredient (e.g. Spaghetti Carbonara is "Soup/Stew" or null before "Pan-seared", because the pancetta rendering is a sub-step; Chicken Parmesan is "Baked" not "Pan-seared" even though the chicken is seared first),
```

> **Note on the Carbonara label itself:** the correct answer is arguably `null` (there is no single dominant method — Carbonara's technique is "boiled pasta + raw egg emulsion") or `Soup/Stew` (the closest available option). The example in the fix above could use `null` or `Soup/Stew`; the important thing is the instruction steers the model away from sub-step reasoning.

### Why not the Medium fix (few-shot examples)?
Test B showed the bug is entirely reproducible without any new context — the model doesn't need more examples, it needs a clearer rule. The single-sentence dish-level scoping is the minimal change that directly addresses the root cause. Few-shot examples add ~150 tokens per call to every analyze-recipe invocation and are harder to maintain as the option list evolves.

### Why not the Heaviest fix (two-call split)?
Splitting into two calls doubles API cost and latency for every recipe save, and the problem is a prompt clarity issue — not a context-length or attention-dilution issue. The live tests show the model responds consistently to the same prompt; it's following the ambiguous instruction correctly, just not as intended.

---

## 6. Scope note

This is a pre-existing bug that Bite α's eval harness (PRD-006 P0.6, Bite γ scope) would have caught if it had covered `cooking_method` outputs. Confirmed argument for expanding that eval to include `cooking_method` alongside `ingredients_structured` when Bite γ ships.

No code was committed during this investigation. Files were temporarily patched locally and restored via `git checkout -- src/lib/constants.js api/_lib/analyzeRecipeHandler.js`.
