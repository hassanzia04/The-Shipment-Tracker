'use strict'
// Generates placeholder PNG icons for the PWA manifest.
// Run once: node generate-icons.cjs
// Replace public/icon-512.png with a proper branded icon later.
const zlib = require('zlib')
const fs   = require('fs')

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length)
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([l, t, data, cr])
}

// Draws a simple ship silhouette on a blue gradient background.
// Returns a Uint8Array row of RGB pixels for y in [0, size).
function pixelRow(y, size) {
  const row = Buffer.alloc(1 + size * 3)
  row[0] = 0 // filter none
  const cy = y / size
  // Background: deep blue gradient
  const bgR = Math.round(15  + cy * 20)
  const bgG = Math.round(55  + cy * 20)
  const bgB = Math.round(140 + cy * 30)

  for (let x = 0; x < size; x++) {
    const cx = x / size
    // Simple hull rectangle (bottom 30%, centered 20%-80% width)
    const inHull = cy > 0.62 && cy < 0.78 && cx > 0.15 && cx < 0.85
    // Superstructure box (45%-65% height, 35%-65% width)
    const inSuper = cy > 0.45 && cy < 0.63 && cx > 0.32 && cx < 0.68
    // Funnel (38%-46% height, 55%-62% width)
    const inFunnel = cy > 0.38 && cy < 0.46 && cx > 0.54 && cx < 0.62
    // Water line (78%-82%)
    const inWater = cy > 0.78 && cy < 0.82

    let r, g, b
    if (inHull || inSuper || inFunnel) {
      r = 230; g = 240; b = 255 // near-white ship
    } else if (inWater) {
      r = bgR + 30; g = bgG + 50; b = bgB + 60 // lighter water
    } else {
      r = bgR; g = bgG; b = bgB
    }
    row[1 + x * 3]     = Math.min(255, r)
    row[1 + x * 3 + 1] = Math.min(255, g)
    row[1 + x * 3 + 2] = Math.min(255, b)
  }
  return row
}

function createPNG(size) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  const rows = []
  for (let y = 0; y < size; y++) rows.push(pixelRow(y, size))
  const idat = zlib.deflateSync(Buffer.concat(rows))
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const dir = __dirname + '/public'
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(dir + '/icon-192.png',       createPNG(192))
fs.writeFileSync(dir + '/icon-512.png',       createPNG(512))
fs.writeFileSync(dir + '/apple-touch-icon.png', createPNG(180))
console.log('Icons written to public/')
