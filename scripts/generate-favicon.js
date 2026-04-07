const sharp = require('sharp')
const path = require('path')

const input = path.join(__dirname, '..', 'public', 'omuwan-logo.png')
const outDir = path.join(__dirname, '..', 'public')

async function generate() {
  await sharp(input).resize(32, 32).png().toFile(path.join(outDir, 'favicon-32x32.png'))
  console.log('✓ favicon-32x32.png')

  await sharp(input).resize(16, 16).png().toFile(path.join(outDir, 'favicon-16x16.png'))
  console.log('✓ favicon-16x16.png')

  await sharp(input).resize(180, 180).png().toFile(path.join(outDir, 'apple-touch-icon.png'))
  console.log('✓ apple-touch-icon.png')

  // favicon.ico — use 32x32 PNG as ICO (browsers accept PNG favicons)
  await sharp(input).resize(32, 32).png().toFile(path.join(outDir, 'favicon.ico'))
  console.log('✓ favicon.ico')
}

generate().catch(console.error)
