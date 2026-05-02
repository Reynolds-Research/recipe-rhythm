/**
 * Recipe-Rhythm design system — sanctioned scales (PRD-005 §7).
 *
 * Spacing scale (Tailwind units → px):
 *   1 → 4   (tight, icon padding)
 *   2 → 8   (default tight, chip internals)
 *   3 → 12  (inputs, buttons vertical)
 *   4 → 16  (card-internal default)
 *   6 → 24  (section gap, page horizontal padding)
 *   8 → 32  (major break)
 *  12 → 48  (hero / extra emphasis)
 *  + `safe` (env(safe-area-inset-bottom), defined below)
 *
 * Banned for new code: p-0.5, p-1.5, p-2.5, p-3.5, p-5, p-7, p-9, p-10, p-11,
 * and any arbitrary p-[Npx] value. The half-step values are a sign of visual
 * tweaking rather than a system. Existing pb-28 / pb-safe for the safe-area
 * bottom-nav clearance is allowed.
 *
 * Typography scale (size / line-height / use):
 *   text-xs   leading-4              12 / 16  metadata, tertiary tags ONLY (never body)
 *   text-sm   leading-5              14 / 20  secondary text, button labels, chips
 *   text-base leading-6              16 / 24  default for all body copy
 *   text-lg   leading-7   font-bold  18 / 28  section headings
 *   text-xl   leading-7   font-bold  20 / 28  page titles
 *   text-2xl  leading-8   font-serif italic   24 / 32  hero / page subtitle
 *
 * Banned: text-[11px] and any other text-[Npx] arbitrary value below 14px.
 *
 * See docs/architecture.md "Design system rules" for the full contrast and
 * touch-target rules. CI guardrail (PRD-005 P0.12) enforces the bans.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      spacing: {
        safe: 'env(safe-area-inset-bottom)',
      },
      colors: {
        brand: {
          50:  '#FEF6F4',
          100: '#FDE8E4',
          200: '#FBCDC3',
          400: '#F78E77',
          500: '#EF4D23',
          600: '#D74520',
          700: '#B33A1A',
          800: '#8F2E15',
          900: '#6B2310',
        },
        cream: {
          50:  '#FAF9F6',
          100: '#F2EFE9',
          200: '#E5DFD3',
        }
      }
    },
  },
  plugins: [],
}
