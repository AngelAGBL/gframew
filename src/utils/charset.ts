/**
 * Detects the charset of a buffer for text files.
 * Returns the detected charset or null for non-text.
 */
export function detectCharset(buffer: Buffer, mimeType: string): string | null {
  // Only detect charset for text types
  if (!mimeType.startsWith('text/')) {
    return null;
  }

  // Check for UTF-8 BOM
  if (buffer.length >= 3 && 
      buffer[0] === 0xEF && 
      buffer[1] === 0xBB && 
      buffer[2] === 0xBF) {
    return 'utf-8';
  }

  // Check for UTF-16 BE BOM
  if (buffer.length >= 2 && 
      buffer[0] === 0xFE && 
      buffer[1] === 0xFF) {
    return 'utf-16be';
  }

  // Check for UTF-16 LE BOM
  if (buffer.length >= 2 && 
      buffer[0] === 0xFF && 
      buffer[1] === 0xFE) {
    return 'utf-16le';
  }

  // Check for UTF-32 BE BOM
  if (buffer.length >= 4 && 
      buffer[0] === 0x00 && 
      buffer[1] === 0x00 && 
      buffer[2] === 0xFE && 
      buffer[3] === 0xFF) {
    return 'utf-32be';
  }

  // Check for UTF-32 LE BOM
  if (buffer.length >= 4 && 
      buffer[0] === 0xFF && 
      buffer[1] === 0xFE && 
      buffer[2] === 0x00 && 
      buffer[3] === 0x00) {
    return 'utf-32le';
  }

  // Check if it's pure ASCII (7-bit)
  let isAscii = true;
  for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
    const byte = buffer[i];
    if (byte !== undefined && byte > 127) {
      isAscii = false;
      break;
    }
  }

  if (isAscii) {
    return 'us-ascii';
  }

  // Try to validate UTF-8
  try {
    const decoded = buffer.toString('utf-8');
    // Check for replacement characters which indicate invalid UTF-8
    if (!decoded.includes('\uFFFD')) {
      return 'utf-8';
    }
  } catch {
    // Not valid UTF-8
  }

  // Check for ISO-8859-1 (Latin-1) characteristics
  // ISO-8859-1 uses bytes 0x80-0xFF for extended characters
  let hasExtendedChars = false;
  let hasInvalidIsoChars = false;
  
  for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
    const byte = buffer[i];
    if (byte !== undefined && byte >= 0x80 && byte <= 0xFF) {
      hasExtendedChars = true;
      // Check for C1 control characters (0x80-0x9F) which are rarely used in ISO-8859-1
      if (byte >= 0x80 && byte <= 0x9F) {
        hasInvalidIsoChars = true;
      }
    }
  }

  if (hasExtendedChars && !hasInvalidIsoChars) {
    return 'iso-8859-1';
  }

  // Default to UTF-8 for text files
  return '';
}
