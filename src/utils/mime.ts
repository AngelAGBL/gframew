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
    // Gemini & Text
    '.gmi': 'text/gemini',
    '.gemini': 'text/gemini',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',

    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.avif': 'image/avif',

    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.weba': 'audio/webm',

    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/mp4',

    // Code & Programming
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.ts': 'application/typescript',
    '.jsx': 'text/jsx',
    '.tsx': 'text/tsx',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.php': 'text/x-php',
    '.java': 'text/x-java',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.h': 'text/x-c',
    '.hpp': 'text/x-c++',
    '.rs': 'text/x-rust',
    '.go': 'text/x-go',
    '.sh': 'text/x-shellscript',
    '.bash': 'text/x-shellscript',
    '.sql': 'text/x-sql',

    // Documents & Data
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.toml': 'text/toml',
    '.csv': 'text/csv',

    // Archives
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.bz2': 'application/x-bzip2',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',

    // Fonts
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.fontpack': 'application/lagrange-fontpack+zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
