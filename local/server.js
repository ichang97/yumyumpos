import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { app as workerApp } from '../worker/index.js';
import { createMemoryRateLimiter } from './rateLimiter.js';
import { createSqliteD1Database } from './sqliteD1Adapter.js';

const STATIC_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function buildApiRequest(request, remoteAddr, trustProxy) {
  if (!remoteAddr) {
    return request;
  }

  const hasClientIpHeader =
    request.headers.has('cf-connecting-ip') || request.headers.has('x-forwarded-for');
  if (trustProxy && hasClientIpHeader) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('x-forwarded-for', remoteAddr);
  return new Request(request, { headers });
}

function serveFile(filePath, method, cacheControl) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    ...STATIC_SECURITY_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
  };
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  const body = fs.readFileSync(filePath);
  return new Response(body, { status: 200, headers });
}

export function createLocalApp(options = {}) {
  const sourceEnv = { ...process.env, ...(options.env || {}) };
  const db = createSqliteD1Database({
    dbPath: options.dbPath ?? sourceEnv.DB_PATH,
    migrationsDir: options.migrationsDir,
  });

  const env = {
    DB: db,
    PUBLIC_ORDER_LIMITER:
      options.rateLimiter ?? createMemoryRateLimiter({ limit: 20, periodSeconds: 60 }),
    LOCAL_AUTH_MODE: sourceEnv.LOCAL_AUTH_MODE ?? 'off',
    LOCAL_USER_EMAIL: sourceEnv.LOCAL_USER_EMAIL ?? 'local@yumyum.pos',
    LOCAL_USER_ADMIN: sourceEnv.LOCAL_USER_ADMIN ?? 'true',
    ADMIN_EMAILS: sourceEnv.ADMIN_EMAILS ?? '',
    DEV_BYPASS_EMAIL: sourceEnv.DEV_BYPASS_EMAIL ?? '',
    ACCESS_TEAM_DOMAIN: sourceEnv.ACCESS_TEAM_DOMAIN ?? '',
    ACCESS_AUD: sourceEnv.ACCESS_AUD ?? '',
    TRUST_PROXY: sourceEnv.TRUST_PROXY ?? 'false',
  };

  const distDir = path.resolve(
    options.distDir || sourceEnv.DIST_DIR || path.resolve(process.cwd(), 'dist/client')
  );
  const serveStaticFiles =
    options.serveStatic ?? String(sourceEnv.SERVE_STATIC ?? 'true').toLowerCase() !== 'false';
  const trustProxy = String(env.TRUST_PROXY).toLowerCase() === 'true';

  async function fetchHandler(request, info) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const remoteAddr = info?.incoming?.socket?.remoteAddress || '';
      const apiRequest = buildApiRequest(request, remoteAddr, trustProxy);
      return workerApp.fetch(apiRequest, env);
    }

    if (!serveStaticFiles) {
      return new Response('Not Found', { status: 404, headers: STATIC_SECURITY_HEADERS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: STATIC_SECURITY_HEADERS });
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400, headers: STATIC_SECURITY_HEADERS });
    }

    const segments = decodedPath.split('/').filter(Boolean);
    if (
      segments.some(
        (segment) => segment === '.' || segment === '..' || segment.startsWith('.') || segment === '_headers'
      )
    ) {
      return new Response('Not Found', { status: 404, headers: STATIC_SECURITY_HEADERS });
    }

    const relPath = decodedPath.replace(/^\/+/, '');
    if (relPath) {
      const resolved = path.resolve(distDir, relPath);
      if (
        resolved.startsWith(distDir + path.sep) &&
        fs.existsSync(resolved) &&
        fs.statSync(resolved).isFile()
      ) {
        const cacheControl = decodedPath.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';
        return serveFile(resolved, request.method, cacheControl);
      }
    }

    if (path.extname(decodedPath) === '') {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        return serveFile(indexPath, request.method, 'no-cache');
      }
    }

    return new Response('Not Found', { status: 404, headers: STATIC_SECURITY_HEADERS });
  }

  return {
    fetch: fetchHandler,
    db,
    env,
    close() {
      db.close();
    },
  };
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const localApp = createLocalApp();

  const server = serve(
    {
      fetch: localApp.fetch,
      port,
      hostname: host,
    },
    () => {
      console.log(`YumYum POS local server listening on http://${host}:${port}`);
    }
  );

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    server.close(() => {
      localApp.close();
      process.exit(0);
    });
    setTimeout(() => {
      localApp.close();
      process.exit(0);
    }, 3000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
