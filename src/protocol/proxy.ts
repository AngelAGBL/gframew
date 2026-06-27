import { PROXY_V2_SIGNATURE } from '../constants.ts';
import type { ProxyInfo } from '../types.ts';

/**
 * Parses a PROXY protocol v1 header (text format).
 * @returns The connection info, or null if the line is malformed.
 */
export function parseProxyV1Header(line: string): ProxyInfo | null {
  const parts = line.split(' ');
  if (parts.length !== 6 || parts[0] !== 'PROXY') {
    return null;
  }

  return {
    srcAddress: parts[2],
    dstAddress: parts[3],
    srcPort: parseInt(parts[4]),
    dstPort: parseInt(parts[5]),
  };
}

/**
 * Parses a PROXY protocol v2 header (binary format).
 * @returns The parsed info (may be null for unsupported families) and the
 *          total header length (0 when more data is still needed).
 */
export function parseProxyV2Header(buffer: Buffer): {
  info: ProxyInfo | null;
  headerLength: number;
} {
  if (buffer.length < 16) {
    return { info: null, headerLength: 0 };
  }
  if (!buffer.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) {
    return { info: null, headerLength: 0 };
  }

  const verCmd = buffer[12];
  const famProto = buffer[13];
  const len = buffer.readUInt16BE(14);
  const headerLength = 16 + len;

  if (buffer.length < headerLength) {
    return { info: null, headerLength: 0 };
  }
  // Only the PROXY command (0x01) carries address info; LOCAL (0x00) does not.
  if ((verCmd & 0x0f) !== 0x01) {
    return { info: null, headerLength };
  }

  const family = (famProto & 0xf0) >> 4;
  let info: ProxyInfo | null = null;

  if (family === 0x01) {
    // IPv4
    info = {
      srcAddress: `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`,
      dstAddress: `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`,
      srcPort: buffer.readUInt16BE(24),
      dstPort: buffer.readUInt16BE(26),
    };
  } else if (family === 0x02) {
    // IPv6
    info = {
      srcAddress:
        buffer.subarray(16, 32).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      dstAddress:
        buffer.subarray(32, 48).toString('hex').match(/.{1,4}/g)?.join(':') || '',
      srcPort: buffer.readUInt16BE(48),
      dstPort: buffer.readUInt16BE(50),
    };
  }

  return { info, headerLength };
}
