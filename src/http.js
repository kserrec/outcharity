const ANALYTICS_SCRIPT_SOURCE = 'https://static.cloudflareinsights.com';
const TURNSTILE_SOURCE = 'https://challenges.cloudflare.com';

function contentSecurityPolicy({ allowAnalytics = true } = {}) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    `frame-src ${TURNSTILE_SOURCE}`,
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self'${allowAnalytics ? ` ${ANALYTICS_SCRIPT_SOURCE}` : ''} ${TURNSTILE_SOURCE}`,
    "style-src 'self'",
  ].join('; ');
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': contentSecurityPolicy(),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function applySecurityHeaders(
  response,
  { strictTransport = false, privateResponse = false } = {},
) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (privateResponse) {
    response.headers.set('Content-Security-Policy', contentSecurityPolicy({ allowAnalytics: false }));
    response.headers.set('Referrer-Policy', 'origin');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const cacheControl = response.headers.get('Cache-Control');
    response.headers.set(
      'Cache-Control',
      cacheControl?.includes('no-transform')
        ? cacheControl
        : cacheControl
          ? `${cacheControl}, no-transform`
          : 'no-store, no-transform',
    );
  }
  if (strictTransport) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return response;
}

export function isPrivatePath(pathname) {
  return pathname === '/success' || pathname === '/manage-return' || pathname.startsWith('/manage/');
}

export function isLocalHostname(hostname) {
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

// IPv6 networks hand each customer a whole /64 block, so a single client must share one bucket
// across that block rather than getting a fresh limit per address.
export function rateLimitClientKey(address) {
  const source = String(address || '').trim().toLowerCase();
  if (!source) return 'unknown';
  if (!source.includes(':')) return source.slice(0, 64);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(source);
  if (mapped) return mapped[1];
  const parts = source.split('::');
  if (parts.length > 2) return 'invalid';
  const [head, tail = ''] = parts;
  const groups = head ? head.split(':') : [];
  if (tail !== '' || source.endsWith('::')) {
    const tailGroups = tail ? tail.split(':') : [];
    while (groups.length + tailGroups.length < 8) groups.push('0');
    groups.push(...tailGroups);
  }
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return 'invalid';
  }
  return `${groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':')}::/64`;
}

async function requireRateLimitKey(request, limiter, key) {
  if (!limiter?.limit) {
    if (isLocalRequest(request)) return;
    await request.body?.cancel();
    const error = new Error('Request protection is not configured.');
    error.status = 503;
    throw error;
  }

  const { success } = await limiter.limit({ key });
  if (!success) {
    await request.body?.cancel();
    const error = new Error('Too many requests. Please wait a minute and try again.');
    error.status = 429;
    throw error;
  }
}

export function requireRateLimit(request, limiter, scope) {
  const clientAddress = rateLimitClientKey(request.headers.get('CF-Connecting-IP'));
  return requireRateLimitKey(request, limiter, `${scope}:${clientAddress}`);
}

// A shared key caps aggregate work within one Cloudflare location even when requests come from
// many client addresses. Cloudflare's counters are intentionally permissive and eventually
// consistent, so this is a cost brake rather than exact accounting.
export function requireSharedRateLimit(request, limiter, scope) {
  return requireRateLimitKey(request, limiter, `${scope}:all`);
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

function unreadableForm() {
  const error = new Error('That submission could not be read. Please use the form on this site.');
  error.status = 400;
  return error;
}

export async function readFormDataWithinLimit(request, maximumBytes) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^(?:multipart\/form-data|application\/x-www-form-urlencoded)\s*(?:;|$)/i.test(contentType)) {
    await request.body?.cancel();
    throw unreadableForm();
  }
  const body = await readBodyWithinLimit(request, maximumBytes);
  try {
    return await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw unreadableForm();
  }
}

export async function readTextWithinLimit(request, maximumBytes) {
  return new TextDecoder().decode(await readBodyWithinLimit(request, maximumBytes));
}

export async function htmlResponse(context, document, status = 200, cacheControl = 'no-store') {
  const response = await context.html(document, status);
  response.headers.set(
    'Cache-Control',
    isPrivatePath(new URL(context.req.url).pathname) ? `${cacheControl}, no-transform` : cacheControl,
  );
  return response;
}

// Public-data pages stay in the Worker's five-second Cache API entry, while browsers and social
// crawlers must revalidate their stored HTML before reusing its social-card metadata.
export function revalidatingPublicResponse(response) {
  const revalidatingResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
  revalidatingResponse.headers.set(
    'Cache-Control',
    'public, no-cache, max-age=0, must-revalidate',
  );
  return revalidatingResponse;
}

function cacheKeyFor(request, pathname = new URL(request.url).pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return new Request(url.toString(), { method: 'GET' });
}

export function publicCacheKey(request) {
  return cacheKeyFor(request, '/');
}

export function publicStatsCacheKey(request) {
  return cacheKeyFor(request, '/stats');
}

export function publicAssetCacheKey(request) {
  return cacheKeyFor(request);
}

async function invalidateCacheKey(key) {
  if (!globalThis.caches?.default) return false;
  return globalThis.caches.default.delete(key);
}

export function invalidatePublicHomepage(request) {
  return invalidateCacheKey(publicCacheKey(request));
}

export function invalidatePublicPages(request) {
  return Promise.all([
    invalidatePublicHomepage(request),
    invalidateCacheKey(publicStatsCacheKey(request)),
  ]);
}

export function invalidatePublicLogo(request, logoKey) {
  return invalidateCacheKey(cacheKeyFor(request, `/${logoKey}`));
}
