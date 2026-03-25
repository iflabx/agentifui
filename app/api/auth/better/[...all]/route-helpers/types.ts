export type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

export interface BetterAuthRouteHandler {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
}
