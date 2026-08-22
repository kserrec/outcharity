// Minimal image byte fixtures whose headers declare real pixel dimensions.

export function pngBytes(width = 1, height = 1) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export function jpegBytes(width = 1, height = 1) {
  // SOI, an APP0 segment to skip, then a baseline SOF0 frame header.
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 0, 0, 0, 0x01, 0x01, 0x11, 0x00,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, height);
  view.setUint16(15, width);
  return bytes;
}

export function webpBytes(width = 1, height = 1, variant = 'VP8 ') {
  const bytes = new Uint8Array(40);
  bytes.set([82, 73, 70, 70, 32, 0, 0, 0, 87, 69, 66, 80]);
  bytes.set(Array.from(variant, (c) => c.charCodeAt(0)), 12);
  const view = new DataView(bytes.buffer);
  if (variant === 'VP8 ') {
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else if (variant === 'VP8L') {
    bytes[20] = 0x2f;
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  } else if (variant === 'VP8X') {
    const w = width - 1;
    const h = height - 1;
    bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  }
  return bytes;
}
