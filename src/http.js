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
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function applySecurityHeaders(response, { strictTransport = false } = {}) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (strictTransport) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return response;
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function shouldUseStrictTransport(request, siteUrl) {
  const incoming = new URL(request.url);
  return (
    !isLocalHostname(incoming.hostname) &&
    (incoming.protocol === 'https:' || String(siteUrl).startsWith('https://'))
  );
}

export async function canonicalOriginResponse(request, siteUrl) {
  const incoming = new URL(request.url);
  let configured;
  try {
    configured = new URL(siteUrl);
  } catch {
    if (isLocalHostname(incoming.hostname)) return null;
    await request.body?.cancel();
    return new Response('The production site origin is not configured.', { status: 503 });
  }

  if (isLocalHostname(configured.hostname)) {
    if (isLocalHostname(incoming.hostname)) return null;
    await request.body?.cancel();
    return new Response('The production site origin is not configured.', { status: 503 });
  }
  if (configured.protocol !== 'https:') {
    await request.body?.cancel();
    return new Response('The production site origin must use HTTPS.', { status: 503 });
  }
  if (incoming.origin === configured.origin) return null;

  await request.body?.cancel();
  if (request.method === 'GET' || request.method === 'HEAD') {
    const target = new URL(configured.origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    return new Response(null, { status: 308, headers: { Location: target.toString() } });
  }
  return new Response('Use the canonical HTTPS origin for this request.', { status: 421 });
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

function isLocalRequest(request) {
  return isLocalHostname(new URL(request.url).hostname);
}

export async function requireRateLimit(request, limiter, scope) {
  if (!limiter?.limit) {
    if (isLocalRequest(request)) return;
    await request.body?.cancel();
    const error = new Error('Request protection is not configured.');
    error.status = 503;
    throw error;
  }

  const clientAddress = (request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
  const { success } = await limiter.limit({ key: `${scope}:${clientAddress}` });
  if (!success) {
    await request.body?.cancel();
    const error = new Error('Too many requests. Please wait a minute and try again.');
    error.status = 429;
    throw error;
  }
}

function bodyTooLarge() {
  const error = new Error('That submission is too large.');
  error.status = 413;
  return error;
}

export async function readBodyWithinLimit(request, maximumBytes) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    await request.body?.cancel();
    throw bodyTooLarge();
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  let body = new Uint8Array();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const requiredBytes = totalBytes + chunk.byteLength;
      if (requiredBytes > maximumBytes) {
        await reader.cancel();
        throw bodyTooLarge();
      }
      if (body.byteLength < requiredBytes) {
        const nextSize = Math.min(
          maximumBytes,
          Math.max(requiredBytes, body.byteLength ? body.byteLength * 2 : 1024),
        );
        const expanded = new Uint8Array(nextSize);
        expanded.set(body);
        body = expanded;
      }
      body.set(chunk, totalBytes);
      totalBytes = requiredBytes;
    }
  } finally {
    reader.releaseLock();
  }

  return body.subarray(0, totalBytes);
}

export async function readFormDataWithinLimit(request, maximumBytes) {
  const body = await readBodyWithinLimit(request, maximumBytes);
  const contentType = request.headers.get('Content-Type') || '';
  return new Response(body, { headers: { 'Content-Type': contentType } }).formData();
}

export async function readTextWithinLimit(request, maximumBytes) {
  return new TextDecoder().decode(await readBodyWithinLimit(request, maximumBytes));
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

export function publicAssetCacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  return new Request(url.toString(), { method: 'GET' });
}

export async function invalidatePublicHomepage(request) {
  if (!globalThis.caches?.default) return false;
  return globalThis.caches.default.delete(publicCacheKey(request));
}
