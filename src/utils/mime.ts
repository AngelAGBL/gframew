import path from 'path';

/**
 * Gets the MIME type for a file based on its extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  // Handle .hbs files by checking the sub-extension
  if (ext === '.hbs') {
    const nameWithoutHbs = filePath.slice(0, -4);
    return getMimeType(nameWithoutHbs);
  }
  
  const mimeTypes: Record<string, string> = {
    '.gmi': 'text/gemini',
    '.gemini': 'text/gemini',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.fontpack': 'application/lagrange-fontpack+zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
