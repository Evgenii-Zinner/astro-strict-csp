import { DEFAULT_STRICT_CSP_DIRECTIVES } from './csp.js';
import type { CspDirectives, SsrCspOptions } from './types.js';

export * from './types.js';

/**
 * Default fallback directives for SSR responses, extending strict defaults with safe data/https resources.
 */
const DEFAULT_SSR_DIRECTIVES: CspDirectives = {
  ...DEFAULT_STRICT_CSP_DIRECTIVES,
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'form-action': ["'self'"],
};

/**
 * Formats a `CspDirectives` map with dynamic per-request nonces.
 *
 * @param directives - CSP directives map.
 * @param nonce - Cryptographic nonce string for the request.
 * @param options - Configuration options controlling nonce and strict-dynamic injection.
 * @returns Serialized CSP header string.
 *
 * @sideeffects None (pure function).
 */
export function formatSsrCspDirectives(
  directives: CspDirectives,
  nonce: string,
  options: SsrCspOptions = {},
): string {
  const parts: string[] = [];
  const nonceDirective = `'nonce-${nonce}'`;
  const strictDynamic = options.strictDynamic ?? false;

  for (const [key, value] of Object.entries(directives)) {
    if (value === false || value === undefined || value === null) {
      continue;
    }

    if (value === true) {
      parts.push(key);
      continue;
    }

    let items: string[] = [];
    if (Array.isArray(value)) {
      items = [...value];
    } else if (typeof value === 'string' && value.trim()) {
      items = value.trim().split(/\s+/);
    }

    // Automatically inject nonce into script-src and/or style-src if requested
    if (key === 'script-src' && (options.injectScriptNonce ?? true)) {
      if (!items.includes(nonceDirective)) {
        items.push(nonceDirective);
      }
      if (strictDynamic && !items.includes("'strict-dynamic'")) {
        items.push("'strict-dynamic'");
      }
    } else if (key === 'style-src' && (options.injectStyleNonce ?? false)) {
      if (!items.includes(nonceDirective)) {
        items.push(nonceDirective);
      }
    }

    if (items.length > 0) {
      parts.push(`${key} ${items.join(' ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Creates an Astro SSR middleware handler that enforces strict CSP via HTTP response headers
 * and generates a unique cryptographic nonce on every request.
 *
 * @param options - SSR CSP middleware configuration options.
 * @returns Astro middleware function.
 *
 * @example
 * ```typescript
 * import { createSsrCspMiddleware } from 'astro-strict-csp/middleware';
 * export const onRequest = createSsrCspMiddleware({ exclude: ['/admin'] });
 * ```
 */
export function createSsrCspMiddleware(options: SsrCspOptions = {}) {
  const headerName = options.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  const directives = options.directives ?? DEFAULT_SSR_DIRECTIVES;

  return async (
    context: {
      url: URL;
      locals: Record<string, unknown>;
    },
    next: () => Promise<Response>,
  ): Promise<Response> => {
    // Check path exclusions
    const pathname = context.url.pathname;
    if (options.exclude && options.exclude.length > 0) {
      for (const pattern of options.exclude) {
        if (typeof pattern === 'string' && pathname.startsWith(pattern)) {
          return next();
        }
        if (pattern instanceof RegExp && pattern.test(pathname)) {
          return next();
        }
      }
    }

    // Generate cryptographic nonce using Web Crypto API (native in Cloudflare, Node, Bun)
    const nonce =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).substring(2, 18);

    // Expose nonce in context.locals for Astro templates / layouts
    context.locals.nonce = nonce;

    const response = await next();

    // Only inject CSP into HTML responses
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const cspHeaderValue = formatSsrCspDirectives(directives, nonce, options);
      response.headers.set(headerName, cspHeaderValue);
    }

    return response;
  };
}

/**
 * Standard Astro middleware entrypoint used by `addMiddleware()`.
 * Resolves user options lazily from the virtual module injected by the Astro integration.
 */
let resolvedMiddleware: ReturnType<typeof createSsrCspMiddleware> | null = null;

export const onRequest = async (
  context: {
    url: URL;
    locals: Record<string, unknown>;
  },
  next: () => Promise<Response>,
): Promise<Response> => {
  if (!resolvedMiddleware) {
    let virtualSsrOptions: SsrCspOptions = {};
    try {
      // @ts-expect-error Virtual module resolved by Astro/Vite
      const virtualModule = await import('virtual:astro-strict-csp/config');
      virtualSsrOptions = virtualModule.ssrOptions ?? {};
    } catch {
      // Virtual module not available (e.g. unit tests)
    }
    resolvedMiddleware = createSsrCspMiddleware(virtualSsrOptions);
  }

  return resolvedMiddleware(context, next);
};
