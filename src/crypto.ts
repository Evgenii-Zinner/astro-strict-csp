import crypto from 'node:crypto';
import type { HashAlgorithm } from './types.js';

/**
 * Computes a W3C Subresource Integrity (SRI) compliant digest string.
 *
 * @param content - Buffer or raw string content of the asset to hash.
 * @param algorithm - Cryptographic hashing algorithm ('sha256' | 'sha384' | 'sha512'). Defaults to 'sha384'.
 * @returns Base64-encoded digest prefixed with the algorithm name (e.g. `sha384-H8c2juWy...`).
 *
 * @sideeffects None (pure function, does not perform disk I/O).
 */
export function computeSriHash(
  content: Buffer | string,
  algorithm: HashAlgorithm = 'sha384',
): string {
  const hash = crypto
    .createHash(algorithm)
    .update(typeof content === 'string' ? Buffer.from(content, 'utf-8') : content)
    .digest('base64');
  return `${algorithm}-${hash}`;
}

/**
 * Computes a deterministic short CSS class name from an inline CSS style declaration.
 * Normalizes leading/trailing semicolons and whitespace to ensure duplicate style
 * declarations map to the exact same utility class across the entire build.
 *
 * @param styleRule - Raw CSS declaration string (e.g. `color: #ff0000; font-weight: bold;`).
 * @param prefix - Class name prefix. Defaults to `'is-'`.
 * @returns Deterministic class name (e.g. `is-a1b2c3`).
 *
 * @sideeffects None (pure function).
 */
export function computeCssClass(styleRule: string, prefix = 'is-'): string {
  const trimmed = styleRule.trim().replace(/^;+/, '').replace(/;+$/, '');
  const hash = crypto.createHash('md5').update(trimmed).digest('hex').slice(0, 6);
  return `${prefix}${hash}`;
}

/**
 * Computes a deterministic content hash for naming extracted external assets (e.g. scripts).
 *
 * @param content - Script source code or binary content.
 * @param length - Length of hex hash prefix to slice. Defaults to 8.
 * @returns Sliced hex hash (e.g. `d41d8cd9`).
 *
 * @sideeffects None (pure function).
 */
export function computeContentHash(content: string | Buffer, length = 8): string {
  return crypto
    .createHash('sha256')
    .update(typeof content === 'string' ? Buffer.from(content, 'utf-8') : content)
    .digest('hex')
    .slice(0, length);
}
