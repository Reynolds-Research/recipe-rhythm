import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.{js,jsx,ts,tsx}',
        '**/*.config.{js,ts}',
        'dist/',
        'node_modules/',
        'coverage/',
      ],
      // Target thresholds (warn-only while exploring; not enforced yet):
      //   lines: 70, statements: 70, functions: 60, branches: 60
      // To enforce, move these into a `thresholds: { ... }` block.
    },
  },
})
