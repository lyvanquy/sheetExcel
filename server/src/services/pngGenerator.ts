import zlib from "zlib";

// CRC32 table cache
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

/**
 * Calculates standard CRC32 checksum for PNG chunks
 */
function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Creates a PNG chunk with the given 4-character type and data buffer
 */
function createChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  
  const crcVal = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

/**
 * Parses Hex color to RGB object
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleaned = hex.replace("#", "").trim();
  if (cleaned.length === 3) {
    cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
  }
  if (cleaned.length !== 6) {
    return { r: 27, g: 54, b: 93 }; // Default nice navy blue (#1B365D)
  }
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Draws a single pixel into the raw RGBA buffer
 */
function drawPixel(
  pixels: Buffer,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  // Account for the 1-byte filter prefix at the start of each row
  const rowOffset = y * (1 + w * 4);
  const colOffset = 1 + x * 4;
  const idx = rowOffset + colOffset;
  
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

/**
 * Draws a solid circular brush to support thick lines
 */
function drawBrush(
  pixels: Buffer,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        drawPixel(pixels, w, h, cx + dx, cy + dy, r, g, b, a);
      }
    }
  }
}

/**
 * Bresenham's line drawing algorithm with support for thickness
 */
export function drawLine(
  pixels: Buffer,
  w: number,
  h: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  let x = x1;
  let y = y1;
  const brushRadius = Math.max(0, Math.floor((thickness - 1) / 2));

  // Loop drawing lines
  const stepsLimit = Math.max(w, h) * 4; // safety break
  let steps = 0;
  while (steps++ < stepsLimit) {
    if (brushRadius === 0) {
      drawPixel(pixels, w, h, x, y, r, g, b, a);
    } else {
      drawBrush(pixels, w, h, x, y, brushRadius, r, g, b, a);
    }
    
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Main function to generate PNG image buffer for various cross styles
 */
export function generateCrossImage(
  style: "single_diagonal_up" | "single_diagonal_down" | "greater_than",
  colorHex: string,
  thickness: number = 4,
  width: number = 1000,
  height: number = 1000
): Buffer {
  const { r, g, b } = hexToRgb(colorHex);
  const a = 255; // Fully opaque color on transparent background
  
  // Allocate raw RGBA scanline buffer: height * (1 + width * 4)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  // By default, buffer is filled with 0s (fully transparent: 0, 0, 0, 0)
  // The first byte of each scanline is the filter type, initialized to 0 (None)

  const padding = 0;

  if (style === "single_diagonal_down") {
    // Top-left to bottom-right: \
    drawLine(rawData, width, height, 0, 0, width - 1, height - 1, thickness, r, g, b, a);
  } else if (style === "single_diagonal_up") {
    // Bottom-left to top-right: /
    drawLine(rawData, width, height, 0, height - 1, width - 1, 0, thickness, r, g, b, a);
  } else if (style === "greater_than") {
    // Greater Than: >
    const centerX = width - 1;
    const centerY = Math.floor(height / 2);
    drawLine(rawData, width, height, 0, 0, centerX, centerY, thickness, r, g, b, a);
    drawLine(rawData, width, height, centerX, centerY, 0, height - 1, thickness, r, g, b, a);
  }

  // Compress the pixel data using zlib deflate
  const compressed = zlib.deflateSync(rawData);

  // PNG structures
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type: 6 = RGBA
  ihdrData[10] = 0; // Compression method: 0 = zlib deflate
  ihdrData[11] = 0; // Filter method: 0 = standard PNG filters
  ihdrData[12] = 0; // Interlace method: 0 = no interlace

  const ihdrChunk = createChunk("IHDR", ihdrData);
  const idatChunk = createChunk("IDAT", compressed);
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
