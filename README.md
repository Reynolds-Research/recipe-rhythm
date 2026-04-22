# Recipe Rhythm

Recipe Rhythm is a mobile-first, single-user meal-tracking and weekly meal-planning web application. Built to function as a personal digital cookbook and meal log, it leverages AI to easily categorize your meals and suggest future plans based on your eating habits.

## Core Features
1. **Log**: Low-friction "what did you eat tonight?" capture. Saves to a local meal history table, and an optional "Save to Cookbook" prompt uses AI to classify and store the meal with rich details.
2. **Prep Table (Brainstorm)**: The planning surface. Select your days, automatically generate suggestions based on your Vault history and recommendations engine, and finalize your meal plan. Share via native share sheet or export a categorized grocery list.
3. **Cookbook (Vault)**: Your personal recipe library. Each recipe has component metadata (cuisine, flavor, proteins, cooking method, etc.) auto-filled using the Anthropic API.

## Tech Stack
- **Frontend**: React 19, Vite 8, Tailwind CSS 3
- **Backend & Auth**: Supabase (Postgres, Auth, Storage)
- **AI Integration**: Anthropic API (`claude-sonnet` and `claude-haiku`)
- **UI Components**: `lucide-react` for icons, `@dnd-kit` for drag-and-drop sortable lists.

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and fill in your values.
   - `VITE_SUPABASE_URL`: Your Supabase project URL.
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous API key. (Ensure Row-Level Security is enabled on all tables!)
   - `ANTHROPIC_API_KEY`: Your Anthropic API key, used by the backend proxy.

3. **Start Development Server**
   Runs both the Vite client and the Express API server proxy concurrently.
   ```bash
   npm run dev
   ```
   Client will run on `http://localhost:5173`. API proxy will run on `http://localhost:3001`.

## Database Schema (Supabase)
To fully run this project, ensure you have the following configured in Supabase:
- **`meals` table**: `id`, `user_id`, `name`, `notes`, `vault_id`, `eaten_on`
- **`vault` table**: `id`, `user_id`, `name`, `image_url`, `cuisine_type`, `flavor_profile`, `proteins`, `cooking_method`, `main_carb`, `dietary_tags`, `dairy_components`, `vegetables`, `fruits`, `auto_completed`, `is_wildcard`, `notes`, `recipe_url`, `created_at`
- **`meal_plans` table**: `id`, `user_id`, `served_at`, `finalized_at`
- **`meal_plan_items` table**: `id`, `meal_plan_id`, `scheduled_date`, `name`, `item_id` (foreign key to vault), `is_wildcard`, `source_url`, `cooked`, `period_start`, `period_end`
- **Storage Bucket**: Create a public bucket named `recipe_images` with a permissive authenticated INSERT policy.

## Testing
- Unit tests: `npm run test:unit`
- E2E tests: `npm run test:e2e` (Playwright)

## Deployment
For production, the client can be hosted on platforms like Vercel or Netlify. Ensure the API proxy is either hosted via a Serverless Edge Function (e.g., using `vercel.json` and `/api/` directories) or as a standalone Node.js service. The Anthropic API key must remain out of the client bundle.
