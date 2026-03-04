export type RouteHandler = () => string;
export type Routes = Record<string, RouteHandler>;

export interface ServerConfig {
  allowedDomains: string[];
  publicDir: string;
  port: number;
  lang: string;
}
