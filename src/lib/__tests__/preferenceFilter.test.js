import { describe, it, expect } from 'vitest'
import { passesPreferences } from '../preferenceFilter'

// PRD-002 P0.3 — passesPreferences(item, preferences). Pure predicate; first
// failing rule wins. Item shapes mirror what `vault` SELECTs return — see
// docs/schema.md → public.vault.

const EMPTY_PREFS = {
  dietary_restrictions: [],
  excluded_cuisines: [],
  excluded_ingredients: [],
  max_prep_time_minutes: null,
}

describe('passesPreferences — empty / missing preferences', () => {
  it('null preferences → every item passes', () => {
    const item = { id: 'v1', name: 'Anything', proteins: ['Chicken'] }
    expect(passesPreferences(item, null)).toBe(true)
  })

  it('empty preferences object → every item passes', () => {
    const items = [
      { id: 'v1', name: 'Carnivore', proteins: ['Beef'], cuisine_type: 'American', prep_time_minutes: 120 },
      { id: 'v2', name: 'Vegan', proteins: ['Tofu'], cuisine_type: 'Thai', prep_time_minutes: 20 },
      { id: 'v3', name: 'Mystery' }, // no metadata at all
    ]
    for (const item of items) {
      expect(passesPreferences(item, EMPTY_PREFS)).toBe(true)
    }
  })
})

describe('passesPreferences — max_prep_time_minutes', () => {
  const prefs = { ...EMPTY_PREFS, max_prep_time_minutes: 60 }

  it('passes when prep_time below the cap', () => {
    expect(passesPreferences({ prep_time_minutes: 45 }, prefs)).toBe(true)
  })
  it('fails when prep_time strictly exceeds the cap', () => {
    expect(passesPreferences({ prep_time_minutes: 75 }, prefs)).toBe(false)
  })
  it('passes at the boundary (prep_time === cap)', () => {
    expect(passesPreferences({ prep_time_minutes: 60 }, prefs)).toBe(true)
  })
  it('passes when prep_time is null (we do not punish under-tagged data)', () => {
    expect(passesPreferences({ prep_time_minutes: null }, prefs)).toBe(true)
    expect(passesPreferences({}, prefs)).toBe(true)
  })
  it('null/undefined max_prep_time_minutes → no filter', () => {
    expect(passesPreferences({ prep_time_minutes: 999 }, EMPTY_PREFS)).toBe(true)
    expect(passesPreferences({ prep_time_minutes: 999 }, { ...EMPTY_PREFS, max_prep_time_minutes: undefined })).toBe(true)
  })
})

describe('passesPreferences — excluded_cuisines', () => {
  const prefs = { ...EMPTY_PREFS, excluded_cuisines: ['Italian'] }

  it('fails when item.cuisine_type is excluded (case-insensitive)', () => {
    expect(passesPreferences({ cuisine_type: 'italian' }, prefs)).toBe(false)
    expect(passesPreferences({ cuisine_type: 'Italian' }, prefs)).toBe(false)
    expect(passesPreferences({ cuisine_type: 'ITALIAN' }, prefs)).toBe(false)
  })
  it('passes when item.cuisine_type is not excluded', () => {
    expect(passesPreferences({ cuisine_type: 'Thai' }, prefs)).toBe(true)
  })
  it('passes when item.cuisine_type is missing', () => {
    expect(passesPreferences({}, prefs)).toBe(true)
  })
})

describe('passesPreferences — excluded_ingredients', () => {
  const prefs = { ...EMPTY_PREFS, excluded_ingredients: ['cilantro'] }

  it('fails when item.ingredients (string blob) contains the excluded ingredient (case-insensitive)', () => {
    expect(passesPreferences({ ingredients: 'salt, Cilantro, lime' }, prefs)).toBe(false)
    expect(passesPreferences({ ingredients: 'CILANTRO PASTE' }, prefs)).toBe(false)
  })
  it('fails when item.ingredients (array) contains the excluded ingredient', () => {
    expect(passesPreferences({ ingredients: ['salt', 'Cilantro', 'lime'] }, prefs)).toBe(false)
  })
  it('passes when no ingredient field references the excluded ingredient', () => {
    expect(passesPreferences({ ingredients: 'salt, lime, basil' }, prefs)).toBe(true)
    expect(passesPreferences({ ingredients: ['salt', 'basil'] }, prefs)).toBe(true)
    expect(passesPreferences({}, prefs)).toBe(true)
  })
  it('also scans the existing vault tag arrays so excluding "tomato" catches a recipe tagged vegetables: ["Tomato"]', () => {
    // Pragmatic: vault has no ingredients column today — the closest signal is
    // the categorical tag arrays. Excluding "tomato" should drop a recipe that
    // lists it under vegetables.
    expect(
      passesPreferences(
        { vegetables: ['Tomato', 'Onion/Garlic'] },
        { ...EMPTY_PREFS, excluded_ingredients: ['tomato'] },
      ),
    ).toBe(false)
  })
  it('substring match (e.g. "fish" matches "Shrimp/Seafood" via fields) is intentional belt-and-suspenders', () => {
    // The protein "Fish" is in proteins[]; substring match catches it.
    expect(
      passesPreferences(
        { proteins: ['Fish'] },
        { ...EMPTY_PREFS, excluded_ingredients: ['fish'] },
      ),
    ).toBe(false)
  })
})

describe('passesPreferences — dietary_restrictions (vegetarian)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegetarian'] }

  it('fails for meat proteins', () => {
    expect(passesPreferences({ proteins: ['Chicken'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Beef'] }, prefs)).toBe(false)
  })
  it('fails for seafood proteins', () => {
    expect(passesPreferences({ proteins: ['Fish'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Shrimp/Seafood'] }, prefs)).toBe(false)
  })
  it('passes for plant proteins', () => {
    expect(passesPreferences({ proteins: ['Tofu'] }, prefs)).toBe(true)
    expect(passesPreferences({ proteins: ['Beans/Lentils'] }, prefs)).toBe(true)
  })
  it('passes for animal_byproduct (eggs / dairy via Eggs)', () => {
    expect(passesPreferences({ proteins: ['Eggs'] }, prefs)).toBe(true)
  })
  it('passes (conservatively) for missing or unknown protein', () => {
    expect(passesPreferences({}, prefs)).toBe(true)
    expect(passesPreferences({ proteins: [] }, prefs)).toBe(true)
    expect(passesPreferences({ proteins: ['Mystery Meat'] }, prefs)).toBe(true)
    expect(passesPreferences({ protein: null }, prefs)).toBe(true)
  })
})

describe('passesPreferences — dietary_restrictions (vegan)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegan'] }

  it('fails for meat / seafood / animal_byproduct proteins', () => {
    expect(passesPreferences({ proteins: ['Chicken'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Fish'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Eggs'] }, prefs)).toBe(false)
  })
  it('passes for plant proteins', () => {
    expect(passesPreferences({ proteins: ['Tofu'] }, prefs)).toBe(true)
    expect(passesPreferences({ proteins: ['Beans/Lentils'] }, prefs)).toBe(true)
  })
})

describe('passesPreferences — dietary_restrictions (pescatarian)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['pescatarian'] }

  it('fails for meat proteins', () => {
    expect(passesPreferences({ proteins: ['Beef'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Chicken'] }, prefs)).toBe(false)
  })
  it('passes for seafood', () => {
    expect(passesPreferences({ proteins: ['Fish'] }, prefs)).toBe(true)
    expect(passesPreferences({ proteins: ['Shrimp/Seafood'] }, prefs)).toBe(true)
  })
  it('passes for plant proteins', () => {
    expect(passesPreferences({ proteins: ['Tofu'] }, prefs)).toBe(true)
  })
})

// ─── ADR-003 ─────────────────────────────────────────────────────────────────
// Name-keyword layer for vegetarian / vegan / pescatarian. Catches dishes
// like "Smash burger" or "Meatloaf meatballs" where the protein-category
// check passes (under-tagged proteins, or PRD-004 substitutable-category
// rule marked the meat omittable) but the dish form clearly implies meat.

describe('passesPreferences — ADR-003 name-keyword layer (vegetarian)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegetarian'] }

  it('fails a "Smash burger" recipe with no proteins tagged (the canonical PRD-004 leak)', () => {
    expect(
      passesPreferences({ name: 'Smash burger', proteins: [] }, prefs),
    ).toBe(false)
  })

  it('fails a "Meatloaf meatballs" recipe with no proteins tagged', () => {
    expect(
      passesPreferences({ name: 'Meatloaf meatballs' }, prefs),
    ).toBe(false)
  })

  it('fails BLT, carnitas, gyro, and pulled pork by name alone', () => {
    for (const name of ['BLT sandwich', 'Carnitas tacos', 'Gyro plate', 'Pulled pork sliders']) {
      expect(passesPreferences({ name }, prefs)).toBe(false)
    }
  })

  it('passes "Veggie burger" via positive name override', () => {
    expect(passesPreferences({ name: 'Veggie burger' }, prefs)).toBe(true)
  })

  it('passes "Beyond meatballs" via positive name override', () => {
    expect(passesPreferences({ name: 'Beyond meatballs' }, prefs)).toBe(true)
  })

  it('passes "Black-bean burger" via positive name override', () => {
    expect(passesPreferences({ name: 'Black-bean burger' }, prefs)).toBe(true)
  })

  it('passes a meaty-named recipe when dietary_tags includes Vegetarian', () => {
    expect(
      passesPreferences(
        { name: 'Meatballs', dietary_tags: ['Vegetarian'] },
        prefs,
      ),
    ).toBe(true)
  })

  it('passes a meaty-named recipe when dietary_tags includes Vegan (vegan ⊃ vegetarian)', () => {
    expect(
      passesPreferences(
        { name: 'Smash burger', dietary_tags: ['Vegan'] },
        prefs,
      ),
    ).toBe(true)
  })

  it('passes a generic plant-protein recipe with no implied-meat name', () => {
    expect(
      passesPreferences({ name: 'Tofu stir fry', proteins: ['Tofu'] }, prefs),
    ).toBe(true)
  })

  it('still fails the protein layer first when proteins are tagged meat (no regression)', () => {
    // Even if the name has a vegetarian override, an explicit meat protein
    // is still a hard fail. The override only bypasses the NAME layer.
    expect(
      passesPreferences(
        { name: 'Veggie chicken curry', proteins: ['Chicken'] },
        prefs,
      ),
    ).toBe(false)
  })
})

describe('passesPreferences — ADR-003 name-keyword layer (vegan)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegan'] }

  it('fails a "Smash burger" recipe', () => {
    expect(passesPreferences({ name: 'Smash burger' }, prefs)).toBe(false)
  })

  it('fails seafood-implying names too (sushi, fish tacos)', () => {
    expect(passesPreferences({ name: 'Sushi platter' }, prefs)).toBe(false)
    expect(passesPreferences({ name: 'Fish tacos' }, prefs)).toBe(false)
  })

  it('Vegetarian dietary_tag does NOT bypass for vegan (eggs/dairy still possible)', () => {
    // ADR-003: vegan DIETARY_TAG_OVERRIDES only honors 'Vegan', not 'Vegetarian'.
    // A "Meatballs" tagged Vegetarian could still have eggs/dairy; vegan stays strict.
    expect(
      passesPreferences(
        { name: 'Meatballs', dietary_tags: ['Vegetarian'] },
        prefs,
      ),
    ).toBe(false)
  })

  it('Vegan dietary_tag bypasses the keyword fail', () => {
    expect(
      passesPreferences(
        { name: 'Meatballs', dietary_tags: ['Vegan'] },
        prefs,
      ),
    ).toBe(true)
  })
})

describe('passesPreferences — ADR-003 name-keyword layer (pescatarian)', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['pescatarian'] }

  it('fails meat-implying dish names', () => {
    expect(passesPreferences({ name: 'Smash burger' }, prefs)).toBe(false)
    expect(passesPreferences({ name: 'BLT' }, prefs)).toBe(false)
  })

  it('passes seafood-implying dish names (pescatarian allows seafood)', () => {
    expect(passesPreferences({ name: 'Sushi platter' }, prefs)).toBe(true)
    expect(passesPreferences({ name: 'Shrimp scampi' }, prefs)).toBe(true)
    expect(passesPreferences({ name: 'Crab cake' }, prefs)).toBe(true)
  })

  it('Vegetarian dietary_tag bypasses meat-name fail (a labeled-vegetarian dish is fine for pescatarians)', () => {
    expect(
      passesPreferences(
        { name: 'Meatballs', dietary_tags: ['Vegetarian'] },
        prefs,
      ),
    ).toBe(true)
  })
})

describe('passesPreferences — ADR-003 name-keyword layer is case-insensitive and substring-matched', () => {
  const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegetarian'] }

  it('matches regardless of case', () => {
    expect(passesPreferences({ name: 'BURGER NIGHT' }, prefs)).toBe(false)
    expect(passesPreferences({ name: 'burger night' }, prefs)).toBe(false)
  })

  it('matches inside multi-word names', () => {
    expect(passesPreferences({ name: 'Sunday night meatloaf platter' }, prefs)).toBe(false)
  })

  it('does not match when the keyword is absent (no false positives on neutral names)', () => {
    expect(passesPreferences({ name: 'Pasta primavera' }, prefs)).toBe(true)
    expect(passesPreferences({ name: 'Tomato basil soup' }, prefs)).toBe(true)
    expect(passesPreferences({ name: 'Caprese salad' }, prefs)).toBe(true)
  })
})

describe('passesPreferences — non-protein dietary restrictions are NO-OPs in v1', () => {
  it('gluten-free does not filter anything', () => {
    const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['gluten-free'] }
    expect(passesPreferences({ proteins: ['Beef'], main_carb: 'Pasta' }, prefs)).toBe(true)
    expect(passesPreferences({ proteins: ['Chicken'] }, prefs)).toBe(true)
  })
  it('dairy-free / nut-free / kosher / halal / keto / paleo / low-carb are all no-ops', () => {
    for (const id of ['dairy-free', 'nut-free', 'kosher', 'halal', 'keto', 'paleo', 'low-carb']) {
      const prefs = { ...EMPTY_PREFS, dietary_restrictions: [id] }
      expect(passesPreferences({ proteins: ['Beef'], dairy_components: ['Cheese'] }, prefs)).toBe(true)
    }
  })
  it('combining vegetarian with gluten-free behaves like vegetarian alone', () => {
    const prefs = { ...EMPTY_PREFS, dietary_restrictions: ['vegetarian', 'gluten-free'] }
    expect(passesPreferences({ proteins: ['Chicken'] }, prefs)).toBe(false)
    expect(passesPreferences({ proteins: ['Tofu'] }, prefs)).toBe(true)
  })
})

describe('passesPreferences — multi-criteria ANDing', () => {
  // Surviving items must clear every active rule simultaneously.
  const prefs = {
    dietary_restrictions: ['vegetarian'],
    excluded_cuisines: ['Italian'],
    excluded_ingredients: ['mushroom'],
    max_prep_time_minutes: 45,
  }

  it('passes only when every constraint is satisfied', () => {
    expect(
      passesPreferences(
        {
          proteins: ['Tofu'],
          cuisine_type: 'Thai',
          vegetables: ['Bell Peppers'],
          prep_time_minutes: 30,
        },
        prefs,
      ),
    ).toBe(true)
  })

  it('fails on any single violated constraint (chicken)', () => {
    expect(
      passesPreferences(
        { proteins: ['Chicken'], cuisine_type: 'Thai', prep_time_minutes: 30 },
        prefs,
      ),
    ).toBe(false)
  })

  it('fails on any single violated constraint (Italian cuisine)', () => {
    expect(
      passesPreferences(
        { proteins: ['Tofu'], cuisine_type: 'Italian', prep_time_minutes: 30 },
        prefs,
      ),
    ).toBe(false)
  })

  it('fails on any single violated constraint (mushrooms)', () => {
    expect(
      passesPreferences(
        {
          proteins: ['Tofu'],
          cuisine_type: 'Thai',
          vegetables: ['Mushrooms'],
          prep_time_minutes: 30,
        },
        prefs,
      ),
    ).toBe(false)
  })

  it('fails on any single violated constraint (over prep cap)', () => {
    expect(
      passesPreferences(
        {
          proteins: ['Tofu'],
          cuisine_type: 'Thai',
          prep_time_minutes: 90,
        },
        prefs,
      ),
    ).toBe(false)
  })
})

// ─── PRD-004 Phase C ──────────────────────────────────────────────────────────
// Essentiality gating for excluded_ingredients. The pre-Phase-C tests above
// (lines 71–106) continue to use items without `ingredients_classified`, so
// they hit the defensive-fallback path and prove backward compatibility.

describe('passesPreferences — Phase C: essentiality gating (P0.7)', () => {
  const prefs = { ...EMPTY_PREFS, excluded_ingredients: ['onion'] }

  it('excludes "onion" + recipe has onion as omittable → passes (the cheeseburger case)', () => {
    expect(
      passesPreferences(
        {
          name: 'Cheeseburger',
          ingredients_classified: [
            { name: 'beef', essentiality: 'essential', source: 'ai' },
            { name: 'onion', essentiality: 'omittable', source: 'ai' },
            { name: 'cheese', essentiality: 'essential', source: 'ai' },
          ],
        },
        prefs,
      ),
    ).toBe(true)
  })

  it('excludes "onion" + recipe has onion as essential → fails (the onion-rings case)', () => {
    expect(
      passesPreferences(
        {
          name: 'Onion Rings',
          ingredients_classified: [
            { name: 'onion', essentiality: 'essential', source: 'ai' },
            { name: 'breadcrumbs', essentiality: 'essential', source: 'ai' },
          ],
        },
        prefs,
      ),
    ).toBe(false)
  })

  it('excludes "onion" + ingredients_classified is null + haystack has onion → fails (defensive fallback)', () => {
    expect(
      passesPreferences(
        {
          name: 'Cheeseburger',
          ingredients_classified: null,
          vegetables: ['Onion'],
        },
        prefs,
      ),
    ).toBe(false)
  })

  it('excludes "onion" + ingredients_classified is [] (empty) → passes (no essentials to gate on)', () => {
    expect(
      passesPreferences(
        {
          name: 'Mystery Dish',
          ingredients_classified: [],
          vegetables: ['Onion'],
        },
        prefs,
      ),
    ).toBe(true)
  })

  it('excludes "onion" + classified has no onion entry but haystack does → passes (trust the classifier)', () => {
    expect(
      passesPreferences(
        {
          name: 'Cheeseburger',
          ingredients_classified: [
            { name: 'beef', essentiality: 'essential', source: 'ai' },
            { name: 'cheese', essentiality: 'essential', source: 'ai' },
          ],
          vegetables: ['Onion'],
        },
        prefs,
      ),
    ).toBe(true)
  })

  it('substring match still works within essential names: "garlic" matches "roasted garlic clove" → fails', () => {
    expect(
      passesPreferences(
        {
          name: 'Garlic Bread',
          ingredients_classified: [
            { name: 'roasted garlic clove', essentiality: 'essential', source: 'ai' },
            { name: 'bread', essentiality: 'essential', source: 'ai' },
          ],
        },
        { ...EMPTY_PREFS, excluded_ingredients: ['garlic'] },
      ),
    ).toBe(false)
  })

  it('other preference rules still apply alongside essentiality gating', () => {
    // A recipe with omittable onion passes the ingredient rule but still fails
    // if another preference (prep time) is violated.
    expect(
      passesPreferences(
        {
          name: 'Cheeseburger',
          ingredients_classified: [
            { name: 'onion', essentiality: 'omittable', source: 'ai' },
          ],
          prep_time_minutes: 120,
        },
        { ...prefs, max_prep_time_minutes: 30 },
      ),
    ).toBe(false)
  })
})
