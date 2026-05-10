#!/usr/bin/env node
// Generates PWA icons from public/logo-source.svg using sharp.
// Outputs: public/icons/{pwa-192x192,pwa-512x512,pwa-512x512-maskable,apple-touch-icon}.png
//
// Usage: npm run icons
//   sharp is installed as a devDependency; if somehow missing the script will
//   install it on the fly before continuing.

import { execSync } from 'child_process'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir   = path.join(__dirname, '..')
const publicDir = path.join(rootDir, 'public')
const iconsDir  = path.join(publicDir, 'icons')
const sourceSvg = path.join(publicDir, 'logo-source.svg')

// Load sharp, installing it as a devDependency if it isn't present.
async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch {
    console.log('sharp not found — installing as devDependency...')
    execSync('npm install --save-dev sharp', { cwd: rootDir, stdio: 'inherit' })
    return (await import('sharp')).default
  }
}

// Build a standalone SVG string with a colored background at the target size.
// For maskable icons we increase the padding (safe zone) so the heart stays
// well within the inner 80% that all launchers guarantee to show.
function buildSvg(size, maskable = false) {
  const BRAND = '#D74520'
  const paddingFraction = maskable ? 0.18 : 0.10
  const padding  = Math.round(size * paddingFraction)
  const inner    = size - padding * 2
  const scale    = inner / 24          // lucide heart viewBox is 24×24
  const rx       = maskable ? 0 : Math.round(size * 0.20)  // no radius on maskable

  const heartPath =
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78' +
    'l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${BRAND}"/>
  <g transform="translate(${padding},${padding}) scale(${scale})">
    <path fill="white" d="${heartPath}"/>
  </g>
</svg>`
}

async function run() {
  const sharp = await loadSharp()

  await mkdir(iconsDir, { recursive: true })

  const icons = [
    { name: 'pwa-192x192.png',          size: 192, maskable: false },
    { name: 'pwa-512x512.png',          size: 512, maskable: false },
    { name: 'pwa-512x512-maskable.png', size: 512, maskable: true  },
    { name: 'apple-touch-icon.png',     size: 180, maskable: false },
  ]

  for (const { name, size, maskable } of icons) {
    const svg = buildSvg(size, maskable)
    const outPath = path.join(iconsDir, name)
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    console.log(`  ✓  ${name}  (${size}×${size}${maskable ? ', maskable' : ''})`)
  }

  console.log(`\nIcons written to public/icons/`)
}

run().catch(err => { console.error(err); process.exit(1) })
