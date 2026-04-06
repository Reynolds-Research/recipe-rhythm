/**
 * analyzeRecipe
 * Calls Claude to auto-fill component metadata from a recipe name.
 * Used by both Vault (manual add) and LogMode (save-to-vault flow).
 */
export async function analyzeRecipe(recipeName) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) return null

  let res
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 350,
        messages: [{
          role: 'user',
          content: `Analyze this recipe name and return a JSON object. Return ONLY valid JSON with no markdown or explanation.

Recipe: "${recipeName}"

{
  "cuisine_type": one of [American, Chinese, French, Greek, Indian, Italian, Japanese, Korean, Mexican, Middle Eastern, Spanish, Thai, Vietnamese, Other] or null,
  "flavor_profile": one of [Savory, Spicy, Umami, Fresh, Rich, Sweet, Tangy] or null,
  "proteins": array from [Chicken, Beef, Pork, Fish, Shrimp/Seafood, Tofu, Eggs, Beans/Lentils, Lamb, Turkey, Duck, None],
  "cooking_method": one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null,
  "main_carb": one of [Rice, Pasta, Noodles, Bread, Potato, Quinoa, Couscous, Polenta, Tortilla/Wrap, None] or null,
  "dietary_tags": array from [Vegetarian, Vegan, Gluten-Free, Dairy-Free, Low-Carb, High-Protein, Nut-Free, Paleo],
  "dairy_components": array from [Cheese, Cream, Butter, Milk, Yogurt, Parmesan, Mozzarella, None],
  "vegetables": array from [Tomato, Spinach/Greens, Mushrooms, Bell Peppers, Onion/Garlic, Broccoli, Zucchini, Eggplant, Carrot, Corn, Peas, Cucumber, Asparagus, Sweet Potato, Cauliflower, Brussels Sprouts, Celery, Cabbage],
  "fruits": array from [Avocado, Lemon/Lime, Orange, Apple, Mango, Pineapple, Berries, Banana, Coconut, Peach, Pomegranate, Grapes]
}`,
        }],
      }),
    })
  } catch (err) {
    console.error('[analyzeRecipe] fetch failed:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    console.error('[analyzeRecipe] API error', res.status, JSON.stringify(body))
    return null
  }

  const data = await res.json()
  const text = data.content?.[0]?.text
  if (!text) { console.error('[analyzeRecipe] empty response', data); return null }

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch (e) { console.error('[analyzeRecipe] JSON parse failed', e, text) }
    }
    return null
  }
}
