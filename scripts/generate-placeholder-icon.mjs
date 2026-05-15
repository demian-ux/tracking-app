// Generates a 1024x1024 PNG icon placeholder using only Node built-ins.
// Background: #222222  •  Accent circle: #c6b193  •  "O" initial in the center
// Run: node scripts/generate-placeholder-icon.mjs

import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../src-tauri/app-icon.png')

const W = 1024
const H = 1024

// ── pixel generator ──────────────────────────────────────────────────────────
function pixel(x, y) {
  const cx = W / 2, cy = H / 2
  const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)

  // outer background
  const bg = [0x22, 0x22, 0x22]
  // accent circle ring  (radius 420–460)
  if (r >= 380 && r <= 430) return [0xc6, 0xb1, 0x93]
  // inner disc (radius < 360) — same background
  if (r < 380) {
    // letter "O" stroke: two concentric arcs approximated as ring 160-260
    if (r >= 160 && r <= 260) return [0xc6, 0xb1, 0x93]
    return bg
  }
  return bg
}

// ── build raw scanlines ───────────────────────────────────────────────────────
const raw = Buffer.allocUnsafe(H * (1 + W * 3))
let pos = 0
for (let y = 0; y < H; y++) {
  raw[pos++] = 0 // filter: None
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y)
    raw[pos++] = r
    raw[pos++] = g
    raw[pos++] = b
  }
}

// ── PNG chunk helpers ─────────────────────────────────────────────────────────
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.concat([typeBytes, data])
  const crcVal = Buffer.allocUnsafe(4)
  crcVal.writeUInt32BE(crc32(crcBuf))
  return Buffer.concat([len, typeBytes, data, crcVal])
}

// ── assemble PNG ──────────────────────────────────────────────────────────────
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const ihdr = Buffer.allocUnsafe(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 2   // color type: RGB
ihdr[10] = 0  // compression
ihdr[11] = 0  // filter
ihdr[12] = 0  // interlace

const idat = deflateSync(raw, { level: 6 })
const iend = Buffer.alloc(0)

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', iend),
])

writeFileSync(OUT, png)
console.log(`Icon written to ${OUT} (${(png.length / 1024).toFixed(0)} KB)`)
