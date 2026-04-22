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
