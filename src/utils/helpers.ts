import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  strikethrough: '\x1b[9m',
};

// Generate Unicode character maps using offsets
const createUnicodeMap = (startCode: number) => {
  const map: Record<string, string> = {};
  for (let i = 0; i < 26; i++) {
    map[String.fromCharCode(65 + i)] = String.fromCodePoint(startCode + i);
    map[String.fromCharCode(97 + i)] = String.fromCodePoint(startCode + 26 + i);
  }
  for (let i = 0; i < 10; i++) {
    map[String.fromCharCode(48 + i)] = String.fromCodePoint(startCode + 52 + i);
  }
  return map;
};

const UNICODE_MAPS = {
  bold: createUnicodeMap(0x1D400),           // Mathematical Bold
  italic: createUnicodeMap(0x1D434),         // Mathematical Italic
  'bold-italic': createUnicodeMap(0x1D468),  // Mathematical Bold Italic
  script: createUnicodeMap(0x1D49C),         // Mathematical Script
  'bold-script': createUnicodeMap(0x1D4D0),  // Mathematical Bold Script
  fraktur: createUnicodeMap(0x1D504),        // Mathematical Fraktur
  'bold-fraktur': createUnicodeMap(0x1D56C), // Mathematical Bold Fraktur
  doublestruck: createUnicodeMap(0x1D538),   // Mathematical Double-Struck
  sans: createUnicodeMap(0x1D5A0),           // Mathematical Sans-Serif
  'sans-bold': createUnicodeMap(0x1D5D4),    // Mathematical Sans-Serif Bold
  'sans-italic': createUnicodeMap(0x1D608),  // Mathematical Sans-Serif Italic
  'sans-bold-italic': createUnicodeMap(0x1D63C), // Mathematical Sans-Serif Bold Italic
  monospace: createUnicodeMap(0x1D670),      // Mathematical Monospace
};

function transformUnicode(text: string, styles: string[]): string {
  let result = text;
  for (const style of styles) {
    if (style in UNICODE_MAPS) {
      const map = UNICODE_MAPS[style as keyof typeof UNICODE_MAPS];
      result = result.split('').map(c => map[c] || c).join('');
    }
    if (style === 'underline') {
      result = result.split('').map(c => c + '\u0332').join('');
    }
    if (style === 'strikethrough') {
      result = result.split('').map(c => c + '\u0336').join('');
    }
  }
  return result;
}

function parseAnsiStyles(styles: string[]): string {
  let codes = '';
  for (const style of styles) {
    if (style in ANSI) {
      codes += ANSI[style as keyof typeof ANSI];
    } else if (style.startsWith('f') && style.length > 1) {
      const color = style.slice(1);
      if (color.startsWith('#') && color.length === 7) {
        // Truecolor foreground: f#RRGGBB
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        codes += `\x1b[38;2;${r};${g};${b}m`;
      } else if (/^\d+$/.test(color)) {
        // 256 color foreground: f0-f255
        codes += `\x1b[38;5;${color}m`;
      }
    } else if (style.startsWith('b') && style.length > 1) {
      const color = style.slice(1);
      if (color.startsWith('#') && color.length === 7) {
        // Truecolor background: b#RRGGBB
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        codes += `\x1b[48;2;${r};${g};${b}m`;
      } else if (/^\d+$/.test(color)) {
        // 256 color background: b0-b255
        codes += `\x1b[48;5;${color}m`;
      }
    }
  }
  return codes;
}

export function registerHandlebarsHelpers(): void {
  /**
   * ANSI styling helper
   * Usage: {{#ansi "bold f#ff0000"}}text{{/ansi}}
   */
  Handlebars.registerHelper('ansi', function(this: any, styles: string, options) {
    const styleArray = styles.split(' ').map(s => s.trim());
    const codes = parseAnsiStyles(styleArray);
    return new Handlebars.SafeString(codes + options.fn(this) + ANSI.reset);
  });

  /**
   * Unicode styling helper
   * Usage: {{#unicode "bold"}}text{{/unicode}}
   */
  Handlebars.registerHelper('unicode', function(this: any, styles: string, options) {
    const styleArray = styles.split(' ').map(s => s.trim());
    const transformed = transformUnicode(options.fn(this), styleArray);
    return new Handlebars.SafeString(transformed);
  });

  /**
   * Sort links by creation time and render as Gemini links
   * 
   * Supports multiple input formats:
   * 1. Individual files: {{{sortLinks "/doc.gmi,Doc" "/page.gmi,Page"}}}
   * 2. Directory: {{{sortLinks "posts/"}}}
   * 3. Directory with custom names: {{{sortLinks "posts/" "/about.gmi,About"}}}
   * 4. Legacy format: {{{sortLinks "/doc.gmi,Doc/page.gmi,Page"}}}
   * 
   * @param args - Variable arguments, each can be:
   *               - "path/" for directory (trailing slash)
   *               - "url,name" for individual file
   *               - Legacy: "url1,name1/url2,name2" (single string)
   */
  Handlebars.registerHelper('sortLinks', function(...args: any[]) {
    // Remove Handlebars options object (last argument)
    const inputs = args.slice(0, -1);
    
    if (inputs.length === 0) {
      return '';
    }

    try {
      const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public');
      const links: Array<{ url: string; name: string; ctime: Date }> = [];

      for (const pair of inputs) {
        const [url, name] = pair.split(',').map(s => s.trim());
        if (!url || !name) continue;
        let ctime = new Date(0);
        const filePath = path.resolve(baseDir, url.startsWith('/') ? url.slice(1) : url);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          ctime = stats.mtime;
        }
        links.push({ url, name, ctime });
      }

      // Sort by creation time (newest first)
      links.sort((a, b) => b.ctime.getTime() - a.ctime.getTime());

      // Generate Gemini links
      const result = links.map(link => `=> ${link.url} ${link.name}`).join('\n');
      
      return new Handlebars.SafeString(result);
    } catch (error) {
      console.error('Error in sortLinks helper:', error);
      return '';
    }
  });

  /**
   * List and sort .gmi files from a directory as Gemini links
   * Usage: {{{listGmiFiles "posts" "posts/index.gmi"}}}
   * 
   * @param directory - Directory path relative to public/
   * @param currentFile - Current file to exclude from listing (optional)
   */
  Handlebars.registerHelper('listGmiFiles', function(directory: string, currentFile?: string) {
    try {
      // Resolve directory path relative to public/
      const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public');
      const dirPath = path.resolve(baseDir, directory);

      // Check if directory exists
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return '';
      }

      // Read directory and filter .gmi files
      const files = fs.readdirSync(dirPath)
        .filter(file => {
          // Only .gmi files
          if (!file.endsWith('.gmi')) return false;
          
          // Exclude current file if provided
          if (currentFile) {
            const filePath = path.join(directory, file);
            if (filePath === currentFile || file === currentFile) return false;
          }
          
          // Exclude index.gmi
          if (file === 'index.gmi') return false;
          
          return true;
        })
        .map(file => {
          const fullPath = path.join(dirPath, file);
          const stats = fs.statSync(fullPath);
          const url = '/' + path.join(directory, file).replace(/\\/g, '/');
          
          // Use filename without extension as name
          const name = file.replace(/\.gmi$/, '');
          
          return {
            url,
            name,
            ctime: stats.birthtime
          };
        })
        .sort((a, b) => {
          // Sort by creation time (newest first)
          return b.ctime.getTime() - a.ctime.getTime();
        });

      // Generate Gemini links
      const result = files.map(file => `=> ${file.url} ${file.name}`).join('\n');
      
      return new Handlebars.SafeString(result);
    } catch (error) {
      console.error(`Error listing .gmi files from ${directory}:`, error);
      return '';
    }
  });
}

export default {
  date: new Date().toISOString(),
  year: new Date().getFullYear(),
};
