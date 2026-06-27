import type { PeerCertificate } from 'tls';

/**
 * The minimal socket surface used to serve a Gemini response.
 *
 * Native `net.Socket` / `tls.TLSSocket` satisfy this structurally, letting
 * handlers stay agnostic of the underlying transport.
 */
export interface GeminiSocket {
  write(data: string | Uint8Array): boolean;
  end(): void;
  destroy(): void;
  readonly remoteAddress?: string;
  readonly writable: boolean;
  readonly destroyed: boolean;
  getPeerCertificate?(detailed?: boolean): PeerCertificate;
}

/** Connection details extracted from a PROXY protocol header. */
export interface ProxyInfo {
  srcAddress: string;
  srcPort: number;
  dstAddress: string;
  dstPort: number;
}

/** Context passed to a dynamic route handler. */
export interface DynamicRouteContext {
  socket: GeminiSocket;
  pathname: string;
  input: string;
  /** Parameters captured from `[param]` / `[...rest]` route segments. */
  params: Record<string, string>;
}

/** Structured response a dynamic route handler may return. */
export interface DynamicRouteResponse {
  content: string;
  mimeType?: string;
  statusCode?: number;
  meta?: string;
}

/** Signature of a dynamic route handler exported from a `+page.ts` file. */
export type DynamicRouteHandler = (
  context: DynamicRouteContext
) => string | DynamicRouteResponse | Promise<string | DynamicRouteResponse>;
