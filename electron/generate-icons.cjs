const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const publicDir = path.join(rootDir, 'public');

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(path.join(buildDir, 'Codeyo.iconset'), { recursive: true, force: true });

const baseSize = 1024;
const desktopIconSizes = [16, 32, 48, 64, 128, 256, 512, 1024];

const crcTable = createCrcTable();
const iconPngs = new Map();
for (const size of desktopIconSizes) {
  iconPngs.set(size, encodePng(size, size, drawIcon(size)));
}

fs.writeFileSync(path.join(buildDir, 'icon.png'), iconPngs.get(baseSize));
const favicon = encodeIco([16, 32, 48, 256]);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), favicon);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);
fs.writeFileSync(path.join(buildDir, 'icon.icns'), encodeIcns([16, 32, 64, 128, 256, 512, 1024]));
console.log('Generated Codeyo desktop icons in build/.');

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / baseSize;
  const v = (value) => value * scale;

  drawRoundedRectGradient(pixels, size, v(64), v(64), v(896), v(896), v(220));
  drawRoundedRect(pixels, size, v(182), v(206), v(660), v(612), v(86), [7, 26, 37, 0.28]);
  drawCircle(pixels, size, v(292), v(288), v(18), [253, 215, 84, 0.9]);
  drawCircle(pixels, size, v(352), v(288), v(18), [51, 195, 158, 0.9]);
  drawCircle(pixels, size, v(412), v(288), v(18), [255, 112, 108, 0.9]);

  const white = [244, 250, 247, 0.96];
  const mint = [83, 232, 197, 0.98];
  const coral = [255, 111, 103, 0.95];
  const gold = [248, 215, 92, 0.98];

  drawSegment(pixels, size, v(406), v(360), v(274), v(512), v(406), v(664), v(58), white);
  drawSegment(pixels, size, v(618), v(360), v(750), v(512), v(618), v(664), v(58), white);
  drawSegment(pixels, size, v(550), v(356), v(480), v(668), v(0), v(0), v(52), gold, true);
  drawSegment(pixels, size, v(512), v(704), v(604), v(704), v(0), v(0), v(54), mint, true);
  drawCircle(pixels, size, v(742), v(298), v(56), coral);
  drawCircle(pixels, size, v(742), v(298), v(22), [255, 255, 255, 0.82]);

  return pixels;
}

function drawRoundedRectGradient(pixels, size, x, y, width, height, radius) {
  const top = [14, 35, 58];
  const bottom = [13, 132, 126];
  const accent = [67, 203, 172];
  for (let py = Math.floor(y - 2); py < Math.ceil(y + height + 2); py += 1) {
    for (let px = Math.floor(x - 2); px < Math.ceil(x + width + 2); px += 1) {
      if (!inside(pixels, size, px, py)) continue;
      const distance = roundedRectDistance(px + 0.5, py + 0.5, x, y, width, height, radius);
      const alpha = clamp(0.5 - distance, 0, 1);
      if (alpha <= 0) continue;
      const t = clamp((py - y) / height, 0, 1);
      const d = clamp((px - x + py - y) / (width + height), 0, 1);
      const color = mixColor(mixColor(top, bottom, t), accent, d * 0.28);
      blendPixel(pixels, size, px, py, [color[0], color[1], color[2], alpha]);
    }
  }
}

function drawRoundedRect(pixels, size, x, y, width, height, radius, color) {
  for (let py = Math.floor(y - 2); py < Math.ceil(y + height + 2); py += 1) {
    for (let px = Math.floor(x - 2); px < Math.ceil(x + width + 2); px += 1) {
      if (!inside(pixels, size, px, py)) continue;
      const distance = roundedRectDistance(px + 0.5, py + 0.5, x, y, width, height, radius);
      const alpha = clamp(0.5 - distance, 0, 1) * color[3];
      if (alpha > 0) blendPixel(pixels, size, px, py, [color[0], color[1], color[2], alpha]);
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  for (let py = Math.floor(cy - radius - 2); py < Math.ceil(cy + radius + 2); py += 1) {
    for (let px = Math.floor(cx - radius - 2); px < Math.ceil(cx + radius + 2); px += 1) {
      if (!inside(pixels, size, px, py)) continue;
      const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - radius;
      const alpha = clamp(0.5 - distance, 0, 1) * color[3];
      if (alpha > 0) blendPixel(pixels, size, px, py, [color[0], color[1], color[2], alpha]);
    }
  }
}

function drawSegment(pixels, size, ax, ay, bx, by, cx, cy, stroke, color, single = false) {
  drawSingleSegment(pixels, size, ax, ay, bx, by, stroke, color);
  if (!single) {
    drawSingleSegment(pixels, size, bx, by, cx, cy, stroke, color);
  }
}

function drawSingleSegment(pixels, size, ax, ay, bx, by, stroke, color) {
  const radius = stroke / 2;
  const minX = Math.floor(Math.min(ax, bx) - radius - 2);
  const maxX = Math.ceil(Math.max(ax, bx) + radius + 2);
  const minY = Math.floor(Math.min(ay, by) - radius - 2);
  const maxY = Math.ceil(Math.max(ay, by) + radius + 2);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      if (!inside(pixels, size, px, py)) continue;
      const t = clamp(((px + 0.5 - ax) * dx + (py + 0.5 - ay) * dy) / lengthSq, 0, 1);
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const distance = Math.hypot(px + 0.5 - qx, py + 0.5 - qy) - radius;
      const alpha = clamp(0.5 - distance, 0, 1) * color[3];
      if (alpha > 0) blendPixel(pixels, size, px, py, [color[0], color[1], color[2], alpha]);
    }
  }
}

function roundedRectDistance(px, py, x, y, width, height, radius) {
  const qx = Math.abs(px - (x + width / 2)) - (width / 2 - radius);
  const qy = Math.abs(py - (y + height / 2)) - (height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function blendPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  const sourceAlpha = clamp(color[3], 0, 1);
  const targetAlpha = pixels[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  pixels[offset] = Math.round(((color[0] * sourceAlpha) + (pixels[offset] * targetAlpha * (1 - sourceAlpha))) / outAlpha);
  pixels[offset + 1] = Math.round(((color[1] * sourceAlpha) + (pixels[offset + 1] * targetAlpha * (1 - sourceAlpha))) / outAlpha);
  pixels[offset + 2] = Math.round(((color[2] * sourceAlpha) + (pixels[offset + 2] * targetAlpha * (1 - sourceAlpha))) / outAlpha);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (width * 4 + 1);
    raw[rawOffset] = 0;
    rgba.copy(raw, rawOffset + 1, row * width * 4, (row + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: iconPngs.get(size) ?? encodePng(size, size, drawIcon(size)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;
  images.forEach((image, index) => {
    const entryOffset = index * 16;
    entries[entryOffset] = image.size === 256 ? 0 : image.size;
    entries[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    entries[entryOffset + 2] = 0;
    entries[entryOffset + 3] = 0;
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(image.png.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, entries, ...images.map((image) => image.png)]);
}

function encodeIcns(sizes) {
  const typeBySize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ]);
  const chunks = sizes.map((size) => {
    const type = typeBySize.get(size);
    if (!type) throw new Error(`Unsupported ICNS size: ${size}`);
    const data = iconPngs.get(size) ?? encodePng(size, size, drawIcon(size));
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 8);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mixColor(left, right, t) {
  return [
    Math.round(left[0] + (right[0] - left[0]) * t),
    Math.round(left[1] + (right[1] - left[1]) * t),
    Math.round(left[2] + (right[2] - left[2]) * t),
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inside(_pixels, size, x, y) {
  return x >= 0 && y >= 0 && x < size && y < size;
}
