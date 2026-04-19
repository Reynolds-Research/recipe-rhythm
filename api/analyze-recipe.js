/**
 * POST /api/analyze-recipe — Vercel serverless port of the Express route
 * in api-server.mjs. Keep the two in sync when changing prompt/model.
 */
import { anthropic, parseJsonLoose, sendUpstreamError } from './_lib/anthropic.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

  const { name = '', url = '', imageBase64 = null, mediaType = null } = req.body || {}

  const content = []
  if (imageBase64 && mediaType) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    })
  }

  let textPrompt = `Analyze this meal/recipe and return a JSON object with its components. Return ONLY valid JSON with no markdown or explanation.\n`
  if (name) textPrompt += `\nRecipe Name: "${name}"`
  if (url) textPrompt += `\nRecipe URL: "${url}"`
  if (imageBase64) textPrompt += `\n(See attached image)`

  textPrompt += `\n
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
}`

  content.push({ type: 'text', text: textPrompt })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      messages: [{ role: 'user', content }],
    })
    const text = msg.content?.[0]?.text ?? ''
    const parsed = parseJsonLoose(text, /\{[\s\S]*\}/)
    if (!parsed) return res.status(502).json({ error: 'parse_failed' })
    return res.json({ components: parsed })
  } catch (err) {
    return sendUpstreamError(res, err, 'analyze-recipe')
  }
}
