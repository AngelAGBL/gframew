import Handlebars from 'handlebars';

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
  bold: createUnicodeMap(0x1D400),
  italic: createUnicodeMap(0x1D434),
};

function transformUnicode(text: string, styles: string[]): string {
  let result = text;
  for (const style of styles) {
    if (style === 'bold' || style === 'italic') {
      const map = UNICODE_MAPS[style];
      result = result.split('').map(c => map[c] || c).join('');
    } else if (style === 'underline') {
      result = result.split('').map(c => c + '\u0332').join('');
    } else if (style === 'strikethrough') {
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
  Handlebars.registerHelper('ansi', function(this: any, styles: string, options) {
    const styleArray = styles.split(' ').map(s => s.trim());
    const codes = parseAnsiStyles(styleArray);
    return new Handlebars.SafeString(codes + options.fn(this) + ANSI.reset);
  });

  Handlebars.registerHelper('unicode', function(this: any, styles: string, options) {
    const styleArray = styles.split(' ').map(s => s.trim());
    const transformed = transformUnicode(options.fn(this), styleArray);
    return new Handlebars.SafeString(transformed);
  });
}

export default {
  date: new Date().toISOString(),
  year: new Date().getFullYear(),
};