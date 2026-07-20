import { describe, it, expect } from 'vitest';

function convertToRGBA(buffer: Buffer, width: number, height: number, pixelFormat: any, colorMap?: { r: number; g: number; b: number }[]): Buffer {
  const pixelCount = width * height;
  const sourceBytesPerPixel = buffer.length / pixelCount;
  const targetBuffer = Buffer.alloc(pixelCount * 4);

  if (sourceBytesPerPixel === 3) {
    for (let i = 0; i < pixelCount; i++) {
      const srcOffset = i * 3;
      const dstOffset = i * 4;
      targetBuffer[dstOffset] = buffer[srcOffset];
      targetBuffer[dstOffset + 1] = buffer[srcOffset + 1];
      targetBuffer[dstOffset + 2] = buffer[srcOffset + 2];
      targetBuffer[dstOffset + 3] = 255;
    }
    return targetBuffer;
  }

  if (sourceBytesPerPixel === 2) {
    for (let i = 0; i < pixelCount; i++) {
      const srcOffset = i * 2;
      const dstOffset = i * 4;
      const pixel16 = buffer[srcOffset] | (buffer[srcOffset + 1] << 8);
      const r5 = (pixel16 >> 11) & 0x1F;
      const g6 = (pixel16 >> 5) & 0x3F;
      const b5 = pixel16 & 0x1F;
      targetBuffer[dstOffset] = Math.round((r5 * 255) / 31);
      targetBuffer[dstOffset + 1] = Math.round((g6 * 255) / 63);
      targetBuffer[dstOffset + 2] = Math.round((b5 * 255) / 31);
      targetBuffer[dstOffset + 3] = 255;
    }
    return targetBuffer;
  }

  if (sourceBytesPerPixel === 1) {
    const palette = colorMap && colorMap.length > 0 ? colorMap : null;
    for (let i = 0; i < pixelCount; i++) {
      const dstOffset = i * 4;
      const colorIndex = buffer[i];
      if (palette && colorIndex < palette.length) {
        const color = palette[colorIndex];
        targetBuffer[dstOffset] = color.r || 0;
        targetBuffer[dstOffset + 1] = color.g || 0;
        targetBuffer[dstOffset + 2] = color.b || 0;
      } else {
        targetBuffer[dstOffset] = colorIndex;
        targetBuffer[dstOffset + 1] = colorIndex;
        targetBuffer[dstOffset + 2] = colorIndex;
      }
      targetBuffer[dstOffset + 3] = 255;
    }
    return targetBuffer;
  }

  throw new Error(`Unsupported pixel format: ${sourceBytesPerPixel} bytes per pixel`);
}

function needsPixelFormatConversion(pixelFormat: any): boolean {
  if (pixelFormat.bigEndianFlag) return true;
  return !(
    pixelFormat.redShift === 0 &&
    pixelFormat.greenShift === 8 &&
    pixelFormat.blueShift === 16 &&
    pixelFormat.redMax === 255 &&
    pixelFormat.greenMax === 255 &&
    pixelFormat.blueMax === 255
  );
}

function convertNonStandardRGBA(buffer: Buffer, width: number, height: number, pixelFormat: any): Buffer {
  const pixelCount = width * height;
  const targetBuffer = Buffer.alloc(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const srcOffset = i * 4;
    const dstOffset = i * 4;

    const pixel32 = pixelFormat.bigEndianFlag
      ? buffer.readUInt32BE(srcOffset)
      : buffer.readUInt32LE(srcOffset);

    let r, g, b;

    if (pixelFormat.redMax === 65280) {
      r = (pixel32 >> (pixelFormat.redShift + 8)) & 0xFF;
      g = (pixel32 >> (pixelFormat.greenShift + 8)) & 0xFF;
      b = (pixel32 >> (pixelFormat.blueShift + 8)) & 0xFF;
    } else {
      r = (pixel32 >> pixelFormat.redShift) & 0xFF;
      g = (pixel32 >> pixelFormat.greenShift) & 0xFF;
      b = (pixel32 >> pixelFormat.blueShift) & 0xFF;
    }

    targetBuffer[dstOffset] = r;
    targetBuffer[dstOffset + 1] = g;
    targetBuffer[dstOffset + 2] = b;
    targetBuffer[dstOffset + 3] = 255;
  }

  return targetBuffer;
}

function hasCorruptionPatterns(framebuffer: Buffer, width: number, height: number): boolean {
  let blackPixels = 0;
  let whitePixels = 0;
  const totalPixels = width * height;
  const targetSamples = Math.min(2000, totalPixels);
  const stride = Math.max(1, Math.floor(totalPixels / targetSamples));
  let samples = 0;

  for (let i = 0; i < totalPixels * 4 && samples < targetSamples; i += stride * 4) {
    const r = framebuffer[i];
    const g = framebuffer[i + 1];
    const b = framebuffer[i + 2];
    if (r === 0 && g === 0 && b === 0) blackPixels++;
    if (r === 255 && g === 255 && b === 255) whitePixels++;
    samples++;
  }

  const blackRatio = blackPixels / samples;
  const whiteRatio = whitePixels / samples;

  if (blackRatio > 0.9 || whiteRatio > 0.9) return true;

  const pattern = framebuffer.slice(0, 16);
  let patternRepeats = 0;
  for (let i = 16; i < Math.min(framebuffer.length, 1000); i += 16) {
    if (framebuffer.slice(i, i + 16).equals(pattern)) patternRepeats++;
  }
  if (patternRepeats > 50) return true;

  return false;
}

describe('convertToRGBA — pixel format conversion', () => {

  describe('RGB24 → RGBA (3 bpp)', () => {
    it('should convert 2 RGB24 pixels to RGBA (6→8 bytes)', () => {
      const buffer = Buffer.from([
        255, 128, 64,  // Pixel 1: R,G,B
        0, 255, 0,     // Pixel 2: R,G,B
      ]);
      const result = convertToRGBA(buffer, 2, 1, {}, undefined);

      expect(result.length).toBe(8);
      expect(result[0]).toBe(255);
      expect(result[1]).toBe(128);
      expect(result[2]).toBe(64);
      expect(result[3]).toBe(255);
      expect(result[4]).toBe(0);
      expect(result[5]).toBe(255);
      expect(result[6]).toBe(0);
      expect(result[7]).toBe(255);
    });

    it('should convert single RGB24 pixel (3 bytes)', () => {
      const buffer = Buffer.from([100, 150, 200]);
      const result = convertToRGBA(buffer, 1, 1, {}, undefined);

      expect(result.length).toBe(4);
      expect(result[0]).toBe(100);
      expect(result[1]).toBe(150);
      expect(result[2]).toBe(200);
      expect(result[3]).toBe(255);
    });

    it('should handle multi-row RGB24', () => {
      const w = 2, h = 2;
      const buffer = Buffer.alloc(w * h * 3);
      buffer.fill(0xAA);
      const result = convertToRGBA(buffer, w, h, {}, undefined);

      expect(result.length).toBe(w * h * 4);
      for (let i = 3; i < result.length; i += 4) {
        expect(result[i]).toBe(255); // alpha
      }
    });
  });

  describe('RGB565 → RGBA (2 bpp)', () => {
    it('should convert maximum white RGB565 to RGBA', () => {
      // 0xFFFF in RGB565: R=31, G=63, B=31 → should map to R=255, G=255, B=255
      const buffer = Buffer.from([0xFF, 0xFF]); // 0xFFFF in little-endian
      const result = convertToRGBA(buffer, 1, 1, {}, undefined);

      expect(result[0]).toBe(255);
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(255);
      expect(result[3]).toBe(255);
    });

    it('should convert pure black RGB565 to RGBA', () => {
      const buffer = Buffer.from([0x00, 0x00]);
      const result = convertToRGBA(buffer, 1, 1, {}, undefined);

      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    it('should convert pure red RGB565 to RGBA', () => {
      // R=31, G=0, B=0 → 0xF800 → little-endian [0x00, 0xF8]
      const buffer = Buffer.from([0x00, 0xF8]);
      const result = convertToRGBA(buffer, 1, 1, {}, undefined);

      expect(result[0]).toBe(255);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    it('should convert multiple RGB565 pixels', () => {
      const w = 3, h = 2;
      const buffer = Buffer.alloc(w * h * 2);
      buffer.fill(0xE0); // low byte (green + some blue)
      const result = convertToRGBA(buffer, w, h, {}, undefined);

      expect(result.length).toBe(w * h * 4);
      for (let i = 3; i < result.length; i += 4) {
        expect(result[i]).toBe(255);
      }
    });
  });

  describe('8-bit palette → RGBA (1 bpp)', () => {
    const palette = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
    ];

    it('should convert palette index 0 to red', () => {
      const buffer = Buffer.from([0]);
      const result = convertToRGBA(buffer, 1, 1, {}, palette);

      expect(result[0]).toBe(255);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(255);
    });

    it('should convert palette index 1 to green', () => {
      const buffer = Buffer.from([1]);
      const result = convertToRGBA(buffer, 1, 1, {}, palette);

      expect(result[0]).toBe(0);
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(0);
    });

    it('should convert palette index 2 to blue', () => {
      const buffer = Buffer.from([2]);
      const result = convertToRGBA(buffer, 1, 1, {}, palette);

      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(255);
    });

    it('should fall back to grayscale when no palette', () => {
      const buffer = Buffer.from([128, 200]);
      const result = convertToRGBA(buffer, 2, 1, {}, undefined);

      expect(result[0]).toBe(128);
      expect(result[1]).toBe(128);
      expect(result[2]).toBe(128);
      expect(result[4]).toBe(200);
      expect(result[5]).toBe(200);
      expect(result[6]).toBe(200);
    });

    it('should fall back to grayscale for index beyond palette', () => {
      const buffer = Buffer.from([99]);
      const result = convertToRGBA(buffer, 1, 1, {}, palette);

      expect(result[0]).toBe(99);
      expect(result[1]).toBe(99);
      expect(result[2]).toBe(99);
    });
  });

  describe('unsupported bpp', () => {
    it('should throw for non-integer bytes per pixel', () => {
      const buffer = Buffer.alloc(5);
      expect(() => convertToRGBA(buffer, 2, 2, {}, undefined)).toThrow('Unsupported pixel format');
    });

    it('should throw for 5 bytes per pixel', () => {
      const buffer = Buffer.alloc(5);
      expect(() => convertToRGBA(buffer, 1, 1, {}, undefined)).toThrow('Unsupported pixel format');
    });
  });
});

describe('needsPixelFormatConversion', () => {
  it('should return false for standard RGBA (0,8,16, max=255)', () => {
    const fmt = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    expect(needsPixelFormatConversion(fmt)).toBe(false);
  });

  it('should return true when bigEndianFlag is set', () => {
    const fmt = {
      bigEndianFlag: 1, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    expect(needsPixelFormatConversion(fmt)).toBe(true);
  });

  it('should return true for non-standard shifts (BGRX: R=16,G=8,B=0)', () => {
    const fmt = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 16, greenShift: 8, blueShift: 0,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    expect(needsPixelFormatConversion(fmt)).toBe(true);
  });

  it('should return true when redMax != 255', () => {
    const fmt = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 127, greenMax: 255, blueMax: 255,
    };
    expect(needsPixelFormatConversion(fmt)).toBe(true);
  });
});

describe('convertNonStandardRGBA — correctness', () => {
  it('should convert BGRX-like (R=16,G=8,B=0,LE) to RGBA', () => {
    const format = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 16, greenShift: 8, blueShift: 0,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    // Create pixel where B=0xFF (value 255), G=0x80, R=0x40 in LE
    // Pixel32 = R<<16 | G<<8 | B<<0 = 0x40<<16 | 0x80<<8 | 0xFF = 0x004080FF
    // Little-endian bytes: FF 80 40 00
    const buffer = Buffer.from([0xFF, 0x80, 0x40, 0x00]);
    const result = convertNonStandardRGBA(buffer, 1, 1, format);

    expect(result[0]).toBe(0x40); // R
    expect(result[1]).toBe(0x80); // G
    expect(result[2]).toBe(0xFF); // B
    expect(result[3]).toBe(255);
  });

  it('should handle high-byte color (redMax=65280)', () => {
    const format = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 65280, greenMax: 65280, blueMax: 65280,
    };
    // For high-byte: shift +8 means look at upper byte
    // R at byte 1, G at byte 2, B at byte 3
    const buffer = Buffer.from([0x00, 0xFF, 0x80, 0x40]);
    const result = convertNonStandardRGBA(buffer, 1, 1, format);

    expect(result[0]).toBe(0xFF); // R from byte[1]
    expect(result[1]).toBe(0x80); // G from byte[2]
    expect(result[2]).toBe(0x40); // B from byte[3]
  });

  it('should handle big-endian pixel data', () => {
    const format = {
      bigEndianFlag: 1, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    // BE: bytes [0x12, 0x34, 0x56, 0x78] → readUInt32BE = 0x12345678
    // With shifts R=0,G=8,B=16: R = byte[0]=0x12, G = byte[1]=0x34, B = byte[2]=0x56
    const buffer = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const result = convertNonStandardRGBA(buffer, 1, 1, format);

    // 0x78 = 120 for the high byte in 0x12345678 when shifted >> 0
    // readUInt32BE gives: 0x12*2^24 + 0x34*2^16 + 0x56*2^8 + 0x78 = 0x12345678
    // redShift=0: (0x12345678 >> 0) & 0xFF = 0x78 = 120
    // greenShift=8: (0x12345678 >> 8) & 0xFF = 0x56 = 86
    // blueShift=16: (0x12345678 >> 16) & 0xFF = 0x34 = 52
    expect(result[0]).toBe(0x78);
    expect(result[1]).toBe(0x56);
    expect(result[2]).toBe(0x34);
    expect(result[3]).toBe(255);
  });

  it('should handle multi-pixel conversion', () => {
    const format = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    const w = 2, h = 2;
    const buffer = Buffer.alloc(w * h * 4);
    buffer.fill(0xAA);

    const result = convertNonStandardRGBA(buffer, w, h, format);
    expect(result.length).toBe(16);
    for (let i = 3; i < result.length; i += 4) {
      expect(result[i]).toBe(255);
    }
  });

  it('should be a no-op pass-through for standard RGBA with non-standard detection', () => {
    // Even if flagged as non-standard, standard shifts should produce identity
    const format = {
      bigEndianFlag: 0, trueColorFlag: 1,
      redShift: 0, greenShift: 8, blueShift: 16,
      redMax: 255, greenMax: 255, blueMax: 255,
    };
    const buffer = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]);
    const result = convertNonStandardRGBA(buffer, 1, 1, format);

    expect(result[0]).toBe(0xAA);
    expect(result[1]).toBe(0xBB);
    expect(result[2]).toBe(0xCC);
    expect(result[3]).toBe(255);
  });
});

describe('hasCorruptionPatterns', () => {
  function makeDiverseFb(w: number, h: number): Buffer {
    const buf = Buffer.alloc(w * h * 4);
    let seed = 1;
    for (let i = 0; i < buf.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      buf[i] = (seed >> 16) & 0xFF;
      buf[i + 1] = (seed >> 8) & 0xFF;
      buf[i + 2] = seed & 0xFF;
      buf[i + 3] = 255;
    }
    return buf;
  }

  it('should return false for normal diverse framebuffer', () => {
    const fb = makeDiverseFb(64, 64);
    const result = hasCorruptionPatterns(fb, 64, 64);
    expect(result).toBe(false);
  });

  it('should return true when >90% pixels are black', () => {
    const fb = Buffer.alloc(64 * 64 * 4);
    const result = hasCorruptionPatterns(fb, 64, 64);
    expect(result).toBe(true);
  });

  it('should return true when >90% pixels are white', () => {
    const fb = Buffer.alloc(64 * 64 * 4);
    fb.fill(255);
    const result = hasCorruptionPatterns(fb, 64, 64);
    expect(result).toBe(true);
  });

  it('should return false for a varied but realistic screenshot (no corruption)', () => {
    const fb = makeDiverseFb(64, 64);
    // Add some pure black and pure white pixels (e.g., 10% combined) yet still realistic
    for (let i = 0; i < fb.length * 0.05; i += 4) {
      fb[i] = 0; fb[i + 1] = 0; fb[i + 2] = 0; fb[i + 3] = 255;
    }
    for (let i = Math.floor(fb.length * 0.95); i < fb.length; i += 4) {
      fb[i] = 255; fb[i + 1] = 255; fb[i + 2] = 255; fb[i + 3] = 255;
    }
    const result = hasCorruptionPatterns(fb, 64, 64);
    expect(result).toBe(false);
  });

  it('should return true when 16-byte pattern repeats >50 times', () => {
    const fb = Buffer.alloc(64 * 64 * 4);
    const pattern = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (let i = 0; i < fb.length; i += 16) {
      pattern.copy(fb, i);
    }
    const result = hasCorruptionPatterns(fb, 64, 64);
    expect(result).toBe(true);
  });

  it('should return true for all-black small framebuffer', () => {
    const fb = Buffer.alloc(8);
    const result = hasCorruptionPatterns(fb, 1, 2);
    expect(result).toBe(true);
  });
});
