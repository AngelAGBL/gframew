export type RouteHandler = () => string;
export type Routes = Record<string, RouteHandler>;