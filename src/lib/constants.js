/**
 * Vault enum lists — single source of truth (PRD-001 P0.6).
 *
 * Every chip-picker option list and the analyze-recipe AI prompt's
 * JSON-shape block read from this module. Adding "Filipino" to
 * CUISINE_OPTIONS here updates Vault.jsx's chip picker AND the AI
 * prompt the next time the proxy starts. Don't reorder existing
 * values — the AI prompt and existing data depend on these exact
 * strings.
 */

export const CUISINE_OPTIONS = [
  'American', 'Chinese', 'French', 'Greek', 'Indian',
  'Italian', 'Japanese', 'Korean', 'Mexican', 'Middle Eastern',
  'Spanish', 'Thai', 'Vietnamese', 'Other',
]

export const FLAVOR_OPTIONS = [
  'Savory', 'Spicy', 'Umami', 'Fresh', 'Rich', 'Sweet', 'Tangy',
]

export const PROTEIN_OPTIONS = [
  'Chicken', 'Beef', 'Pork', 'Fish', 'Shrimp/Seafood',
  'Tofu', 'Eggs', 'Beans/Lentils', 'Lamb', 'Turkey', 'Duck', 'None',
]

export const COOKING_METHOD_OPTIONS = [
  'Grilled', 'Baked', 'Roasted', 'Stir-fried', 'Braised',
  'Soup/Stew', 'Fried', 'Steamed', 'Raw/Salad', 'Pan-seared',
  'Slow-cooked', 'Smoked',
]

export const CARB_OPTIONS = [
  'Rice', 'Pasta', 'Noodles', 'Bread', 'Potato',
  'Quinoa', 'Couscous', 'Polenta', 'Tortilla/Wrap', 'None',
]

export const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free',
  'Low-Carb', 'High-Protein', 'Nut-Free', 'Paleo',
]

export const DAIRY_OPTIONS = [
  'Cheese', 'Cream', 'Butter', 'Milk', 'Yogurt',
  'Parmesan', 'Mozzarella', 'None',
]

export const VEGETABLE_OPTIONS = [
  'Tomato', 'Spinach/Greens', 'Mushrooms', 'Bell Peppers',
  'Onion/Garlic', 'Broccoli', 'Zucchini', 'Eggplant', 'Carrot',
  'Corn', 'Peas', 'Cucumber', 'Asparagus', 'Sweet Potato',
  'Cauliflower', 'Brussels Sprouts', 'Celery', 'Cabbage',
]

export const FRUIT_OPTIONS = [
  'Avocado', 'Lemon/Lime', 'Orange', 'Apple', 'Mango',
  'Pineapple', 'Berries', 'Banana', 'Coconut', 'Peach',
  'Pomegranate', 'Grapes',
]

/**
 * Build the JSON-shape block appended to the analyze-recipe AI prompt.
 * Both api-server.mjs (local Express proxy) and api/analyze-recipe.js
 * (Vercel serverless mirror) call this so the prompt always reflects
 * the latest enum values.
 */
export function buildAnalyzeRecipePromptBlock() {
  return `{
  "cuisine_type": one of [${CUISINE_OPTIONS.join(', ')}] or null,
  "flavor_profile": one of [${FLAVOR_OPTIONS.join(', ')}] or null,
  "proteins": array from [${PROTEIN_OPTIONS.join(', ')}],
  "cooking_method": one of [${COOKING_METHOD_OPTIONS.join(', ')}] or null,
  "main_carb": one of [${CARB_OPTIONS.join(', ')}] or null,
  "dietary_tags": array from [${DIETARY_OPTIONS.join(', ')}],
  "dairy_components": array from [${DAIRY_OPTIONS.join(', ')}],
  "vegetables": array from [${VEGETABLE_OPTIONS.join(', ')}],
  "fruits": array from [${FRUIT_OPTIONS.join(', ')}],
  "prep_time_minutes": positive integer estimate of total prep + cook time in minutes, or null if you cannot reasonably estimate
}`
}
