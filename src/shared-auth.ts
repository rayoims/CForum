interface SharedAuthEnv {
  HOME_AUTH_SECRET?: string;
  CFORUM_SSO_CLIENT_SECRET?: string;
}

interface ForumUser {
  id: number;
  email: string;
  username: string;
  role: string;
}

interface HomeSession extends ForumUser {
  exp: number;
}

const FORUM_ORIGIN = 'https://forum.rayoims.com';
const SESSION_COOKIE = 'home_session';
const STATE_COOKIE = 'home_sso_state';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CALLBACK_PATH = '/auth/callback';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function randomValue(size = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(size)));
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createSessionCookie(user: ForumUser, secret: string): Promise<string> {
  const session: HomeSession = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(session)));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(payload)),
  );
  return `${payload}.${base64UrlEncode(signature)}`;
}

async function readSession(request: Request, secret: string): Promise<HomeSession | null> {
  const value = getCookie(request, SESSION_COOKIE);
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return null;

  try {
    const payload = value.slice(0, separator);
    const signature = base64UrlDecode(value.slice(separator + 1));
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      signature,
      new TextEncoder().encode(payload),
    );
    if (!valid) return null;

    const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as HomeSession;
    if (
      !Number.isSafeInteger(session.id) || session.id < 1 ||
      typeof session.email !== 'string' ||
      typeof session.username !== 'string' ||
      typeof session.role !== 'string' ||
      !Number.isSafeInteger(session.exp) ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return session;
  } catch {
    return null;
  }
}

function isHomeOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && !url.port &&
      (url.hostname === 'www.rayoims.com' || url.hostname === 'rayoims.com');
  } catch {
    return false;
  }
}

function plainResponse(body: string, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'text/plain; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(body, { status, headers: responseHeaders });
}

function redirectResponse(location: string, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', location);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(null, { status, headers: responseHeaders });
}

export async function handleSharedAuth(
  request: Request,
  env: SharedAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;

  if (url.pathname === '/auth/login' && method === 'GET') {
    if (!isHomeOrigin(url.origin)) return plainResponse('Not Found', 404);
    if (
      !env.HOME_AUTH_SECRET || env.HOME_AUTH_SECRET.length < 32 ||
      !env.CFORUM_SSO_CLIENT_SECRET || env.CFORUM_SSO_CLIENT_SECRET.length < 32
    ) return plainResponse('Single sign-on is not configured.', 503);

    const state = randomValue();
    const redirectUri = `${url.origin}${CALLBACK_PATH}`;
    const returnTo = new URL('/login', FORUM_ORIGIN);
    returnTo.searchParams.set('return_to', `${redirectUri}?state=${encodeURIComponent(state)}`);
    return redirectResponse(returnTo.toString(), 302, {
      'Set-Cookie': `${STATE_COOKIE}=${state}; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax`,
    });
  }

  if (url.pathname === CALLBACK_PATH && method === 'GET') {
    if (!isHomeOrigin(url.origin)) return plainResponse('Not Found', 404);

    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const savedState = getCookie(request, STATE_COOKIE);
    const clearState = `${STATE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

    if (!code || code.length > 256 || !state || state.length > 256 || !savedState || state !== savedState) {
      return redirectResponse(`${url.origin}/?auth_error=invalid_callback`, 303, { 'Set-Cookie': clearState });
    }
    if (
      !env.HOME_AUTH_SECRET || env.HOME_AUTH_SECRET.length < 32 ||
      !env.CFORUM_SSO_CLIENT_SECRET || env.CFORUM_SSO_CLIENT_SECRET.length < 32
    ) return plainResponse('Single sign-on is not configured.', 503, { 'Set-Cookie': clearState });

    try {
      const redirectUri = `${url.origin}${CALLBACK_PATH}`;
      const tokenResponse = await fetch(`${FORUM_ORIGIN}/api/sso/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SSO-Client-Secret': env.CFORUM_SSO_CLIENT_SECRET,
          'X-Timestamp': String(Math.floor(Date.now() / 1000)),
          'X-Nonce': crypto.randomUUID(),
        },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
      });

      if (!tokenResponse.ok) {
        return redirectResponse(`${url.origin}/?auth_error=login_failed`, 303, { 'Set-Cookie': clearState });
      }

      const data = await tokenResponse.json() as { user?: ForumUser };
      const user = data.user;
      if (
        !user || !Number.isSafeInteger(user.id) || user.id < 1 ||
        typeof user.email !== 'string' ||
        typeof user.username !== 'string' ||
        typeof user.role !== 'string'
      ) return redirectResponse(`${url.origin}/?auth_error=login_failed`, 303, { 'Set-Cookie': clearState });

      const cookie = await createSessionCookie(user, env.HOME_AUTH_SECRET);
      const headers = new Headers({
        Location: `${url.origin}/`,
        'Cache-Control': 'no-store',
        'Set-Cookie': `${SESSION_COOKIE}=${cookie}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      });
      headers.append('Set-Cookie', clearState);
      return new Response(null, { status: 303, headers });
    } catch {
      return redirectResponse(`${url.origin}/?auth_error=login_failed`, 303, { 'Set-Cookie': clearState });
    }
  }

  if (url.pathname === '/api/auth/me' && method === 'GET') {
    if (!env.HOME_AUTH_SECRET || env.HOME_AUTH_SECRET.length < 32) {
      return Response.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const session = await readSession(request, env.HOME_AUTH_SECRET);
    return Response.json({
      user: session
        ? { id: session.id, email: session.email, username: session.username, role: session.role }
        : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    const origin = request.headers.get('Origin');
    const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
    if (origin !== url.origin || contentType !== 'application/json') {
      return plainResponse('Forbidden', 403);
    }
    return Response.json({ success: true }, {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      },
    });
  }

  return null;
}
