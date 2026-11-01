/**
 * Absolute Google sign-in URL. Members always authenticate with Google (the
 * consent grants only the Drive file scope), so
 * notifications link straight into that flow rather than a tokenless page.
 */
export function signInUrlFor(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}/auth/google`;
}

/**
 * Build the absolute invite URL using the request's origin. The `/invite/:token`
 * route handles acceptance.
 */
export function inviteUrlFor(request: Request, token: string): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}/invite/${encodeURIComponent(token)}`;
}
