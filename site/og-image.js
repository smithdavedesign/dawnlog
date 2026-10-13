// The 1200×630 share image (og:image, twitter:image), drawn with code at build time: no image file is copied in,
// and nothing is installed. A few rectangles, a circle and a 5×7 pixel font on an RGB canvas, encoded as a PNG with
// node:zlib. The look is the site's: the terminal colours from style.css and the favicon's sun on the horizon.
import zlib from 'node:zlib';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLORS = {
  bg: '#15171b',
  panel: '#1f2329',
  ink: '#e6e3dc',
  muted: '#8b929c',
  accent: '#b4461f',
  failed: '#f08a64',
  unverified: '#e3b553',
  passed: '#86c38a',
};

// 5 columns × 7 rows, '#' on; lowercase descenders take two more rows. Only what the image says is needed, and an
// unknown character throws, so a text change can't silently draw a gap.
const GLYPHS = {
  ' ': '..... ..... ..... ..... ..... ..... .....',
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  a: '..... ..... .###. ....# .#### #...# .####',
  b: '#.... #.... #.##. ##..# #...# #...# ####.',
  c: '..... ..... .###. #.... #.... #...# .###.',
  d: '....# ....# .##.# #..## #...# #...# .####',
  e: '..... ..... .###. #...# ##### #.... .###.',
  f: '..##. .#..# .#... ###.. .#... .#... .#...',
  g: '..... ..... .#### #...# #...# #...# .#### ....# .###.',
  h: '#.... #.... #.##. ##..# #...# #...# #...#',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  j: '...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#.',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#',
  n: '..... ..... #.##. ##..# #...# #...# #...#',
  o: '..... ..... .###. #...# #...# #...# .###.',
  p: '..... ..... ####. #...# #...# #...# ####. #.... #....',
  q: '..... ..... .#### #...# #...# #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #....',
  s: '..... ..... .#### #.... .###. ....# ####.',
  t: '.#... .#... ###.. .#... .#... .#..# ..##.',
  u: '..... ..... #...# #...# #...# #..## .##.#',
  v: '..... ..... #...# #...# #...# .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  y: '..... ..... #...# #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '##### ...#. ..#.. ...#. ....# #...# .###.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '..##. .#... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ...#. .##..',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '·': '..... ..... ..... .##.. .##.. ..... .....',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
};
const FONT = Object.fromEntries(Object.entries(GLYPHS).map(([ch, rows]) => [ch, rows.split(' ')]));
const ADVANCE = 6; // 5 columns plus 1 of spacing

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** An RGB canvas with the three primitives the image needs. Everything is clipped to the canvas. */
export function createCanvas(width, height, background) {
  const pixels = Buffer.alloc(width * height * 3);
  const set = (x, y, [r, g, b], alpha = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    pixels[i] = Math.round(pixels[i] * (1 - alpha) + r * alpha);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - alpha) + g * alpha);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - alpha) + b * alpha);
  };
  const rect = (x, y, w, h, color) => {
    const c = rgb(color);
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx += 1) set(xx, yy, c);
    }
  };
  /** A filled circle, its edge smoothed by 4×4 supersampling. */
  const circle = (cx, cy, r, color) => {
    const c = rgb(color);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        let inside = 0;
        for (let sy = 0; sy < 4; sy += 1) {
          for (let sx = 0; sx < 4; sx += 1) {
            const dx = x + (sx + 0.5) / 4 - cx;
            const dy = y + (sy + 0.5) / 4 - cy;
            if (dx * dx + dy * dy <= r * r) inside += 1;
          }
        }
        if (inside) set(x, y, c, inside / 16);
      }
    }
  };
  /** Draws `str` with its top-left at (x, y), each font pixel `scale` px square; returns the x after the last glyph. */
  const text = (str, x, y, scale, color) => {
    for (const ch of str) {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`og-image: no glyph for ${JSON.stringify(ch)}`);
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) if (row[rx] === '#') rect(x + rx * scale, y + ry * scale, scale, scale, color);
      });
      x += ADVANCE * scale;
    }
    return x;
  };
  rect(0, 0, width, height, background);
  return { width, height, pixels, rect, circle, text };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit RGB PNG (no filtering; flat colours deflate well anyway). */
export function encodePng({ width, height, pixels }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height); // each row: filter type 0, then its pixels
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type 2 (RGB), deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The share image: the name and the question beside the favicon's sun, a ranked sample run like the landing page's,
 * and one line with what's free and what Pro costs.
 * @param {{ name: string, tagline: string, price: string }} words
 */
export function ogImage({ name, tagline, price }) {
  const c = createCanvas(OG_WIDTH, OG_HEIGHT, COLORS.bg);
  c.rect(0, 0, OG_WIDTH, 8, COLORS.accent);

  // The favicon (a 32-unit square) at 3 px per unit: a sun half under the horizon, with a light line below.
  const ox = 80;
  const oy = 76;
  const u = 3;
  c.circle(ox + 16 * u, oy + 22 * u, 8 * u, COLORS.accent);
  c.rect(ox + 4 * u, oy + 22 * u, 24 * u, 6 * u, COLORS.bg);
  c.rect(ox + 6 * u, oy + 24 * u, 20 * u, 2 * u, COLORS.ink);

  c.text(name, 196, 100, 8, COLORS.ink);
  c.text(tagline, 80, 212, 5, COLORS.ink);

  // The sample run, in a panel with an accent edge: the command, then three receipts ranked worst first.
  c.rect(80, 288, 1040, 238, COLORS.panel);
  c.rect(80, 288, 6, 238, COLORS.accent);
  const col = (n) => 116 + n * 24;
  c.text('$ overnight-receipts --since 12h', col(0), 312, 4, COLORS.muted);
  const rows = [
    ['[1] fix-login', 'FAILED', COLORS.failed, 'fix'],
    ['[2] db-users', 'UNVERIFIED', COLORS.unverified, 'fix'],
    ['[3] add-search', 'PASSED', COLORS.passed, 'merge'],
  ];
  rows.forEach(([branch, status, color, suggest], i) => {
    const y = 370 + i * 50;
    c.text(branch, col(0), y, 4, COLORS.ink);
    c.text(status, col(16), y, 4, color);
    c.text(suggest, col(28), y, 4, COLORS.muted);
  });

  const x = c.text('Free and MIT · local, read-only, offline · ', 80, 566, 3, COLORS.muted);
  c.text(`Pro ${price} once`, x, 566, 3, COLORS.failed);
  return encodePng(c);
}
