import tls from 'tls';
import net from 'net';
import logger from '../config/logger.ts';
import { handleRequest } from '../handlers/request.ts';
import { validateRequestBuffer } from '../utils/validation.ts';
import { parseProxyV1Header, parseProxyV2Header } from './proxy.ts';
import { TLS_OPTIONS } from './tls.ts';
import {
  MAX_PROXY_V1_SIZE,
  MAX_PROXY_V2_SIZE,
  MAX_REQUEST_SIZE,
  MIN_VALID_REQUEST_LENGTH,
  PROXY_V1_PREFIX,
  PROXY_V2_SIGNATURE,
  REQUEST_TIMEOUT,
  StatusCode,
} from '../constants.ts';
import type { ProxyInfo } from '../types.ts';

/**
 * Reads a Gemini request from a TLS socket, validating it incrementally, then
 * dispatches the completed request line to the request handler.
 */
export function handleTLSSocket(socket: tls.TLSSocket, clientAddress: string): void {
  let buffer = Buffer.alloc(0);
  let requestComplete = false;
  let validationFailed = false;

  const cleanup = () => socket.removeAllListeners();

  const rejectRequest = (message: string) => {
    if (validationFailed || requestComplete) return;
    validationFailed = true;

    logger.warn(`${message} from ${clientAddress}`);

    try {
      if (socket.writable) {
        socket.write(`${StatusCode.BAD_REQUEST} Bad Request: ${message}\r\n`);
      }
    } catch (error) {
      logger.debug(`Could not write error response: ${error}`);
    }

    try {
      if (!socket.destroyed) socket.destroy();
    } catch (error) {
      logger.debug(`Could not destroy socket: ${error}`);
    }

    cleanup();
  };

  socket.on('secureConnect', () => {
    logger.info(`✓ TLS established for ${clientAddress}`);
  });

  socket.on('data', (chunk: Buffer) => {
    if (requestComplete || validationFailed) return;

    buffer = Buffer.concat([buffer, chunk]);

    if (buffer.length > MAX_REQUEST_SIZE) {
      rejectRequest('Request too long');
      return;
    }

    const validationError = validateRequestBuffer(buffer);
    if (validationError) {
      rejectRequest(validationError);
      return;
    }

    // A request is complete once it ends with CRLF.
    const requestStr = buffer.toString('utf-8');
    if (!requestStr.includes('\r\n')) return;

    requestComplete = true;
    cleanup();

    const requestLine = requestStr.split('\r\n')[0];
    if (requestLine.length < MIN_VALID_REQUEST_LENGTH) {
      rejectRequest('Invalid URL format');
      return;
    }

    handleRequest(socket, requestLine, clientAddress);
  });

  socket.on('end', () => {
    if (!requestComplete && !validationFailed && buffer.length > 0) {
      logger.warn(`Client closed connection with incomplete request from ${clientAddress}`);
    }
    cleanup();
  });

  socket.on('close', cleanup);

  socket.setTimeout(REQUEST_TIMEOUT, () => {
    if (!requestComplete && !validationFailed) {
      rejectRequest('Timeout');
    }
  });

  socket.on('error', (error) => {
    if (!validationFailed && !requestComplete) {
      logger.error(`Socket error from ${clientAddress}: ${error.message}`);
    }
    cleanup();
  });
}

/**
 * Handles a raw TCP connection prefixed with a PROXY protocol header.
 * Parses the header to recover the real client address, then upgrades the
 * connection to TLS and hands it to {@link handleTLSSocket}.
 */
export function handleConnectionWithProxy(rawSocket: net.Socket): void {
  let proxyBuffer = Buffer.alloc(0);
  let proxyParsed = false;
  let realClientAddress = rawSocket.remoteAddress || 'unknown';
  let connectionClosed = false;
  let proxyHeaderLength = 0;

  const closeConnection = (message?: string) => {
    if (connectionClosed) return;
    connectionClosed = true;

    if (message) logger.warn(`${message} from ${realClientAddress}`);

    try {
      rawSocket.destroy();
    } catch (error) {
      logger.debug(`Error closing connection: ${error}`);
    }
  };

  /** Attempts to parse a complete PROXY header from the accumulated buffer. */
  const tryParseProxy = (): boolean => {
    let proxyInfo: ProxyInfo | null = null;

    const looksLikeV2 =
      proxyBuffer.length >= PROXY_V2_SIGNATURE.length &&
      proxyBuffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE);
    const looksLikeV1 = proxyBuffer
      .toString('utf-8', 0, Math.min(6, proxyBuffer.length))
      .startsWith(PROXY_V1_PREFIX);

    if (looksLikeV2) {
      const result = parseProxyV2Header(proxyBuffer);
      if (result.headerLength === 0) {
        if (proxyBuffer.length > MAX_PROXY_V2_SIZE) {
          closeConnection('Invalid PROXY v2 header');
          return false;
        }
        return false; // Need more data.
      }
      proxyHeaderLength = result.headerLength;
      proxyInfo = result.info;
    } else if (looksLikeV1) {
      const bufferStr = proxyBuffer.toString('utf-8');
      const crlfIndex = bufferStr.indexOf('\r\n');
      if (crlfIndex === -1) {
        if (proxyBuffer.length > MAX_PROXY_V1_SIZE) {
          closeConnection('Invalid PROXY v1 header');
          return false;
        }
        return false; // Need more data.
      }
      proxyHeaderLength = crlfIndex + 2;
      proxyInfo = parseProxyV1Header(bufferStr.substring(0, crlfIndex));
    } else if (proxyBuffer.length >= 6) {
      closeConnection('Expected PROXY protocol header');
      return false;
    } else {
      return false; // Need more data.
    }

    if (proxyInfo) {
      realClientAddress = proxyInfo.srcAddress;
      // The real client is surfaced in the per-request log; keep this at debug.
      logger.debug(`PROXY: Real client ${realClientAddress}:${proxyInfo.srcPort}`);
    }

    return true;
  };

  const upgradeToTLS = () => {
    rawSocket.removeAllListeners('readable');
    rawSocket.removeAllListeners('timeout');
    rawSocket.removeAllListeners('error');
    rawSocket.setTimeout(0);

    // Any bytes after the PROXY header belong to the TLS handshake.
    const tlsData = proxyBuffer.subarray(proxyHeaderLength);
    logger.debug(`PROXY header: ${proxyHeaderLength} bytes, TLS data: ${tlsData.length} bytes`);

    if (tlsData.length > 0) {
      rawSocket.unshift(tlsData);
    }

    const tlsSocket = new tls.TLSSocket(rawSocket, {
      isServer: true,
      ...TLS_OPTIONS,
    });

    // Nudge TLS to consume the buffered handshake bytes.
    if (tlsData.length > 0) {
      setImmediate(() => rawSocket.emit('readable'));
    }

    handleTLSSocket(tlsSocket, realClientAddress);
  };

  const handleReadable = () => {
    if (connectionClosed || proxyParsed) return;

    let chunk: Buffer | null;
    while ((chunk = rawSocket.read()) !== null) {
      proxyBuffer = Buffer.concat([proxyBuffer, chunk]);

      if (tryParseProxy()) {
        proxyParsed = true;
        upgradeToTLS();
        return;
      }
    }
  };

  // 'readable' (manual reads) is required for unshift() to work correctly.
  rawSocket.on('readable', handleReadable);

  rawSocket.setTimeout(REQUEST_TIMEOUT, () => {
    if (!proxyParsed) closeConnection('Timeout waiting for PROXY header');
  });

  rawSocket.on('error', (error) => {
    if (!connectionClosed) {
      logger.error(`Socket error from ${realClientAddress}: ${error.message}`);
      closeConnection();
    }
  });
}
