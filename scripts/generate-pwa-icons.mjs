import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= diagonalDistance) return left;
  return aboveDistance <= diagonalDistance ? above : upperLeft;
}

// Deliberately support only non-interlaced, 8-bit RGB/RGBA PNGs.
function decodePng(png) {
  if (!png.subarray(0, 8).equals(pngSignature)) throw new Error("Invalid PNG signature");
  let header;
  let ended = false;
  const compressedChunks = [];
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error("Truncated PNG chunk");
    const length = png.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > png.length) throw new Error("Truncated PNG chunk payload");
    const type = png.toString("ascii", offset + 4, offset + 8);
    const payload = png.subarray(offset + 8, end);
    if (crc32(png.subarray(offset + 4, end)) !== png.readUInt32BE(end)) {
      throw new Error(`Invalid PNG CRC in ${type}`);
    }
    if (!header && type !== "IHDR") throw new Error("PNG must start with IHDR");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("Invalid PNG IHDR");
      header = payload;
    } else if (type === "IDAT") {
      compressedChunks.push(payload);
    } else if (type === "IEND") {
      if (length !== 0 || end + 4 !== png.length) throw new Error("Invalid PNG IEND");
      ended = true;
      break;
    } else if (type === "tRNS" || type === "acTL" || (png[offset + 4] & 32) === 0) {
      throw new Error(`Unsupported PNG chunk: ${type}`);
    }
    offset = end + 4;
  }
  if (!header || !ended || compressedChunks.length === 0) throw new Error("Incomplete PNG");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || header[10] || header[11] || header[12]) {
    throw new Error("Unsupported PNG format: expected non-interlaced 8-bit RGB or RGBA");
  }
  if (width !== 2048 || height !== 2048) throw new Error("Expected a 2048x2048 branding PNG");
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const expectedLength = (stride + 1) * height;
  const filtered = inflateSync(Buffer.concat(compressedChunks), { maxOutputLength: expectedLength });
  if (filtered.length !== expectedLength) throw new Error("Invalid PNG scanline length");
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    if (filter > 4) throw new Error(`Unsupported PNG filter: ${filter}`);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? pixels[index - channels] : 0;
      const above = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[index - stride - channels] : 0;
      const predictors = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)];
      pixels[index] = (filtered[y * (stride + 1) + x + 1] + predictors[filter]) & 255;
    }
  }
  return { width, height, channels, pixels };
}

function resizeArea(source, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scaleX = source.width / size;
  const scaleY = source.height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = x * scaleX;
      const right = (x + 1) * scaleX;
      const top = y * scaleY;
      const bottom = (y + 1) * scaleY;
      const colorSums = [0, 0, 0];
      let alphaSum = 0;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        const overlapY = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const weight = overlapY * (Math.min(right, sx + 1) - Math.max(left, sx));
          const index = (sy * source.width + sx) * source.channels;
          const alpha = source.channels === 4 ? source.pixels[index + 3] : 255;
          const weightedAlpha = weight * alpha;
          alphaSum += weightedAlpha;
          for (let channel = 0; channel < 3; channel++) {
            colorSums[channel] += source.pixels[index + channel] * weightedAlpha;
          }
        }
      }
      const index = (y * size + x) * 4;
      // Average premultiplied colors to avoid dark edges around transparent pixels.
      for (let channel = 0; channel < 3; channel++) {
        pixels[index + channel] = alphaSum === 0 ? 0 : Math.round(colorSums[channel] / alphaSum);
      }
      pixels[index + 3] = Math.round(alphaSum / (scaleX * scaleY));
    }
  }
  return pixels;
}

function pngChunk(type, payload) {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const sourceUrl = new URL("../assets/branding/Kairos_icon.png", import.meta.url);
const outputDirectory = new URL("../apps/web/public/icons/", import.meta.url);
const source = decodePng(readFileSync(sourceUrl));
mkdirSync(outputDirectory, { recursive: true });
for (const size of [192, 512]) {
  const outputUrl = new URL(`icon-${size}.png`, outputDirectory);
  writeFileSync(outputUrl, encodePng(resizeArea(source, size), size));
  console.log(`Generated ${outputUrl.pathname} (${size}x${size})`);
}
