// src/tools/screenshot.ts
import sharp from 'sharp';
import { VncConnectionManager } from '../vnc/client.js';

function hasCorruptionPatterns(framebuffer: Buffer, width: number, height: number): boolean {
  // Check for common corruption patterns that indicate pixel format issues
  
  // 1. Check for excessive number of fully black or fully white pixels (may indicate bit shift issues)
  let blackPixels = 0;
  let whitePixels = 0;
  const sampleSize = Math.min(1000, width * height); // Sample first 1000 pixels
  
  for (let i = 0; i < sampleSize * 4; i += 4) {
    const r = framebuffer[i];
    const g = framebuffer[i + 1];
    const b = framebuffer[i + 2];
    
    if (r === 0 && g === 0 && b === 0) blackPixels++;
    if (r === 255 && g === 255 && b === 255) whitePixels++;
  }
  
  const blackRatio = blackPixels / sampleSize;
  const whiteRatio = whitePixels / sampleSize;
  
  // If >90% black or white pixels, likely corruption (unless it's actually a blank screen)
  if (blackRatio > 0.9 || whiteRatio > 0.9) {
    console.error(`Potential corruption detected: ${(blackRatio * 100).toFixed(1)}% black, ${(whiteRatio * 100).toFixed(1)}% white pixels`);
    return true;
  }
  
  // 2. Check for repeating byte patterns that suggest format mismatch
  const pattern = framebuffer.slice(0, 16); // First 16 bytes
  let patternRepeats = 0;
  
  for (let i = 16; i < Math.min(framebuffer.length, 1000); i += 16) {
    if (framebuffer.slice(i, i + 16).equals(pattern)) {
      patternRepeats++;
    }
  }
  
  // If pattern repeats too often, likely corruption (but be less strict)
  if (patternRepeats > 50) {
    console.error(`Potential corruption detected: 16-byte pattern repeats ${patternRepeats} times`);
    return true;
  } else if (patternRepeats > 10) {
    console.warn(`Suspicious pattern detected: 16-byte pattern repeats ${patternRepeats} times`);
  }
  
  return false;
}

function convertToRGBA(buffer: Buffer, width: number, height: number, pixelFormat: any): Buffer {
  const pixelCount = width * height;
  const sourceBytesPerPixel = buffer.length / pixelCount;
  const targetBuffer = Buffer.alloc(pixelCount * 4); // RGBA output
  
  console.error(`Converting ${sourceBytesPerPixel} bytes/pixel to RGBA format...`);
  
  if (sourceBytesPerPixel === 3) {
    // RGB24 to RGBA32 conversion
    console.error('Converting RGB24 to RGBA32...');
    for (let i = 0; i < pixelCount; i++) {
      const srcOffset = i * 3;
      const dstOffset = i * 4;
      
      targetBuffer[dstOffset] = buffer[srcOffset];     // R
      targetBuffer[dstOffset + 1] = buffer[srcOffset + 1]; // G  
      targetBuffer[dstOffset + 2] = buffer[srcOffset + 2]; // B
      targetBuffer[dstOffset + 3] = 255; // A (fully opaque)
    }
    return targetBuffer;
  }
  
  if (sourceBytesPerPixel === 2) {
    // RGB565 to RGBA32 conversion
    console.error('Converting RGB565 to RGBA32...');
    for (let i = 0; i < pixelCount; i++) {
      const srcOffset = i * 2;
      const dstOffset = i * 4;
      
      // Read 16-bit value (little-endian)
      const pixel16 = buffer[srcOffset] | (buffer[srcOffset + 1] << 8);
      
      // Extract RGB565 components
      const r5 = (pixel16 >> 11) & 0x1F;
      const g6 = (pixel16 >> 5) & 0x3F;
      const b5 = pixel16 & 0x1F;
      
      // Convert to 8-bit values
      targetBuffer[dstOffset] = (r5 * 255) / 31;     // R
      targetBuffer[dstOffset + 1] = (g6 * 255) / 63; // G
      targetBuffer[dstOffset + 2] = (b5 * 255) / 31; // B
      targetBuffer[dstOffset + 3] = 255; // A
    }
    return targetBuffer;
  }
  
  if (sourceBytesPerPixel === 1) {
    // 8-bit color to RGBA32 (palette-based)
    console.error('Converting 8-bit palette to RGBA32...');
    for (let i = 0; i < pixelCount; i++) {
      const dstOffset = i * 4;
      const colorIndex = buffer[i];
      
      // Simple grayscale conversion for now
      // In a real implementation, you'd use the VNC color map
      targetBuffer[dstOffset] = colorIndex;     // R
      targetBuffer[dstOffset + 1] = colorIndex; // G
      targetBuffer[dstOffset + 2] = colorIndex; // B
      targetBuffer[dstOffset + 3] = 255; // A
    }
    return targetBuffer;
  }
  
  throw new Error(`Unsupported pixel format: ${sourceBytesPerPixel} bytes per pixel`);
}

function needsPixelFormatConversion(pixelFormat: any): boolean {
  // Check if pixel format needs conversion even though it's 4 bytes per pixel
  // Standard RGBA should have: R=0, G=8, B=16 shifts and max=255
  
  const isStandardRGBA = 
    pixelFormat.redShift === 0 && 
    pixelFormat.greenShift === 8 && 
    pixelFormat.blueShift === 16 &&
    pixelFormat.redMax === 255 &&
    pixelFormat.greenMax === 255 &&
    pixelFormat.blueMax === 255;
    
  return !isStandardRGBA;
}

function convertBGRXToRGBA(buffer: Buffer, width: number, height: number, pixelFormat: any): Buffer {
  const pixelCount = width * height;
  const targetBuffer = Buffer.alloc(pixelCount * 4);
  
  console.error(`Converting with shifts R=${pixelFormat.redShift}, G=${pixelFormat.greenShift}, B=${pixelFormat.blueShift}`);
  console.error(`Color max values R=${pixelFormat.redMax}, G=${pixelFormat.greenMax}, B=${pixelFormat.blueMax}`);
  
  for (let i = 0; i < pixelCount; i++) {
    const srcOffset = i * 4;
    const dstOffset = i * 4;
    
    // Read 32-bit pixel value (little-endian)
    const pixel32 = buffer.readUInt32LE(srcOffset);
    
    // Extract color components based on shifts and max values
    let r, g, b;
    
    if (pixelFormat.redMax === 65280) { // 0xFF00 - high byte only
      r = (pixel32 >> (pixelFormat.redShift + 8)) & 0xFF;
      g = (pixel32 >> (pixelFormat.greenShift + 8)) & 0xFF;
      b = (pixel32 >> (pixelFormat.blueShift + 8)) & 0xFF;
    } else {
      // Standard extraction
      r = (pixel32 >> pixelFormat.redShift) & 0xFF;
      g = (pixel32 >> pixelFormat.greenShift) & 0xFF;
      b = (pixel32 >> pixelFormat.blueShift) & 0xFF;
    }
    
    // Write as RGBA
    targetBuffer[dstOffset] = r;     // R
    targetBuffer[dstOffset + 1] = g; // G
    targetBuffer[dstOffset + 2] = b; // B
    targetBuffer[dstOffset + 3] = 255; // A (fully opaque)
  }
  
  return targetBuffer;
}

export async function handleScreenshot(
  vncManager: VncConnectionManager,
  args: { delay?: number } = {}
) {
  const delay = args.delay || 0;
  if (delay > 0) {
    if (delay > 300000) { // Max 5 minutes
      throw new Error('Delay cannot exceed 300000ms (5 minutes)');
    }
    console.error(`Waiting ${delay}ms before taking screenshot...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return vncManager.executeWithConnection(async (client) => {
    const width = client.clientWidth || 0;
    const height = client.clientHeight || 0;
    
    if (!width || !height) {
      throw new Error(`Invalid screen dimensions: ${width}x${height}`);
    }
    
    // Try to get a fresh framebuffer, but fall back to existing one if event doesn't fire
    let framebuffer: Buffer | null = null;
    
    try {
      // Request full frame update first
      client.requestFrameUpdate(true, 0, 0, width, height);
      
      // Wait for frame update event with shorter timeout
      framebuffer = await new Promise<Buffer>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout | null = null;

        const frameUpdateHandler = (fb: Buffer) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(fb);
        };

        client.once('frameUpdated', frameUpdateHandler);

        timeoutId = setTimeout(() => {
          client.removeListener('frameUpdated', frameUpdateHandler);
          reject(new Error('Frame update timeout'));
        }, 2000); // Shorter timeout
      });
    } catch (error) {
      console.warn('Frame update failed, using existing framebuffer:', error);
      // Fall back to existing framebuffer
      framebuffer = client.fb;
    }
    
    if (!framebuffer) {
      throw new Error('No framebuffer available');
    }

    // Log pixel format for debugging
    const pixelFormat = client.pixelFormat;
    console.error(`VNC Pixel Format: bpp=${pixelFormat.bitsPerPixel}, depth=${pixelFormat.depth}, trueColor=${pixelFormat.trueColorFlag}, bigEndian=${pixelFormat.bigEndianFlag}`);
    console.error(`Color shifts: R=${pixelFormat.redShift}, G=${pixelFormat.greenShift}, B=${pixelFormat.blueShift}`);
    console.error(`Color max: R=${pixelFormat.redMax}, G=${pixelFormat.greenMax}, B=${pixelFormat.blueMax}`);

    // Handle different pixel formats if VNC client didn't convert properly
    const actualBytesPerPixel = framebuffer.length / (width * height);
    console.error(`Framebuffer analysis: ${framebuffer.length} bytes for ${width}x${height} = ${actualBytesPerPixel} bytes/pixel`);
    
    if (actualBytesPerPixel !== 4) {
      console.error(`Converting from ${actualBytesPerPixel * 8}-bit format to RGBA...`);
      framebuffer = convertToRGBA(framebuffer, width, height, pixelFormat);
    }

    // Validate final framebuffer size
    const expectedBufferSize = width * height * 4; // RGBA = 4 bytes per pixel
    if (framebuffer.length !== expectedBufferSize) {
      console.error(`CRITICAL: Framebuffer size mismatch after conversion. Expected: ${expectedBufferSize} for ${width}x${height}, Got: ${framebuffer.length}`);
      throw new Error(`Framebuffer size mismatch: expected ${expectedBufferSize}, got ${framebuffer.length}`);
    }

    return captureScreenshotWithDimensions(width, height, framebuffer, delay);
  });
}

export async function captureScreenshotWithDimensions(
  width: number, 
  height: number, 
  framebuffer: Buffer, 
  delay: number
) {
  // The framebuffer from VNC should be in RGBA format (4 bytes per pixel)
  // However, some VNC servers may have format conversion issues
  
  // Validate buffer is divisible by expected pixel size
  const pixelCount = width * height;
  const bytesPerPixel = framebuffer.length / pixelCount;
  
  if (bytesPerPixel !== 4) {
    throw new Error(`Invalid bytes per pixel: expected 4 (RGBA), got ${bytesPerPixel}. This indicates a VNC pixel format conversion problem.`);
  }
  
  // Additional validation: check for obviously corrupted data patterns
  if (hasCorruptionPatterns(framebuffer, width, height)) {
    console.warn('Warning: Framebuffer may contain corrupted data patterns, but proceeding with conversion...');
  }
  
  // Convert to compressed JPEG for smaller file size
  // For screenshots, JPEG compression is usually acceptable
  const imageBuffer = await sharp(framebuffer, {
    raw: {
      width: width,
      height: height,
      channels: 4 // RGBA
    }
  })
  .jpeg({
    quality: 80, // Good balance of quality vs size
    progressive: true
  })
  .toBuffer();

  // If still too large, resize down
  let finalBuffer = imageBuffer;
  let finalWidth = width;
  let finalHeight = height;
  
  if (imageBuffer.length > 800000) { // If > 800KB
    console.error(`Image too large (${imageBuffer.length} bytes), resizing...`);
    const scaleFactor = Math.sqrt(800000 / imageBuffer.length);
    finalWidth = Math.floor(width * scaleFactor);
    finalHeight = Math.floor(height * scaleFactor);
    
    finalBuffer = await sharp(framebuffer, {
      raw: {
        width: width,
        height: height,
        channels: 4
      }
    })
    .resize(finalWidth, finalHeight)
    .jpeg({
      quality: 75
    })
    .toBuffer();
  }

  const base64Data = finalBuffer.toString('base64');
  
  const delayText = delay > 0 ? ` (after ${delay}ms delay)` : '';
  const sizeInfo = finalWidth !== width ? ` (resized from ${width}x${height})` : '';
  
  console.error(`Final image: ${finalBuffer.length} bytes, ${finalWidth}x${finalHeight}`);
  
  return {
    content: [
      { 
        type: 'text', 
        text: `Screenshot captured (${finalWidth}x${finalHeight})${sizeInfo}${delayText}` 
      },
      {
        type: 'image',
        data: base64Data,
        mimeType: 'image/jpeg'
      }
    ]
  };
}
