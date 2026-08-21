const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function applySecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    const error = new Error('This form must be submitted from Outcharity.');
    error.status = 403;
    throw error;
  }
}

export function requireReasonableBodySize(request, maximumBytes = 700 * 1024) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > maximumBytes) {
    const error = new Error('That submission is too large.');
    error.status = 413;
    throw error;
  }
}

export async function htmlResponse(context, document, status = 200, cacheControl = 'no-store') {
  const response = await context.html(document, status);
  response.headers.set('Cache-Control', cacheControl);
  return applySecurityHeaders(response);
}

export function publicCacheKey(request) {
  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

export async function invalidatePublicHomepage(request) {
  if (!globalThis.caches?.default) return false;
  return globalThis.caches.default.delete(publicCacheKey(request));
}
