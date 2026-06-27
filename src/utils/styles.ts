/**
 * Pure text-styling helpers: ANSI escape codes and Unicode "font" transforms.
 * These are runtime-agnostic and have no dependency on Handlebars.
 */

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  strikethrough: '\x1b[9m',
} as const;

/** Builds a letter/digit -> styled-codepoint map from a Unicode block start. */
const createUnicodeMap = (startCode: number): Record<string, string> => {
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

export const UNICODE_MAPS = {
  bold: createUnicodeMap(0x1d400), // Mathematical Bold
  italic: createUnicodeMap(0x1d434), // Mathematical Italic
  'bold-italic': createUnicodeMap(0x1d468), // Mathematical Bold Italic
  script: createUnicodeMap(0x1d49c), // Mathematical Script
  'bold-script': createUnicodeMap(0x1d4d0), // Mathematical Bold Script
  fraktur: createUnicodeMap(0x1d504), // Mathematical Fraktur
  'bold-fraktur': createUnicodeMap(0x1d56c), // Mathematical Bold Fraktur
  doublestruck: createUnicodeMap(0x1d538), // Mathematical Double-Struck
  sans: createUnicodeMap(0x1d5a0), // Mathematical Sans-Serif
  'sans-bold': createUnicodeMap(0x1d5d4), // Mathematical Sans-Serif Bold
  'sans-italic': createUnicodeMap(0x1d608), // Mathematical Sans-Serif Italic
  'sans-bold-italic': createUnicodeMap(0x1d63c), // Mathematical Sans-Serif Bold Italic
  monospace: createUnicodeMap(0x1d670), // Mathematical Monospace
} as const;

/** Applies one or more Unicode "font" / combining-mark styles to text. */
export function transformUnicode(text: string, styles: string[]): string {
  let result = text;
  for (const style of styles) {
    if (style in UNICODE_MAPS) {
      const map = UNICODE_MAPS[style as keyof typeof UNICODE_MAPS];
      result = [...result].map((c) => map[c] || c).join('');
    } else if (style === 'underline') {
      result = [...result].map((c) => c + '\u0332').join('');
    } else if (style === 'strikethrough') {
      result = [...result].map((c) => c + '\u0336').join('');
    }
  }
  return result;
}

/** Parses a hex color (`#RRGGBB`) into its RGB components. */
const parseHexColor = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Builds an ANSI color escape for a foreground (38) or background (48) layer. */
const ansiColor = (layer: 38 | 48, color: string): string => {
  if (color.startsWith('#') && color.length === 7) {
    const [r, g, b] = parseHexColor(color);
    return `\x1b[${layer};2;${r};${g};${b}m`;
  }
  if (/^\d+$/.test(color)) {
    return `\x1b[${layer};5;${color}m`;
  }
  return '';
};

/**
 * Translates a list of style tokens into ANSI escape codes.
 *
 * Supported tokens: named styles (bold, italic, ...), `f<color>` for
 * foreground and `b<color>` for background, where `<color>` is `#RRGGBB`
 * (truecolor) or a 0-255 index (256-color).
 */
export function parseAnsiStyles(styles: string[]): string {
  let codes = '';
  for (const style of styles) {
    if (style in ANSI) {
      codes += ANSI[style as keyof typeof ANSI];
    } else if (style.startsWith('f') && style.length > 1) {
      codes += ansiColor(38, style.slice(1));
    } else if (style.startsWith('b') && style.length > 1) {
      codes += ansiColor(48, style.slice(1));
    }
  }
  return codes;
}
