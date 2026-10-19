export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

export interface ExtractStylesOptions {
  /**
   * Whether inline style extraction is enabled.
   * Extracts both inline `style="..."` attributes and `<style>...</style>` tags.
   * @default true
   */
  enabled?: boolean;

  /**
   * Extract inline `style="..."` attributes (e.g. from Shiki code blocks, UI components,
   * layout wrappers, or injected SVGs) into hashed CSS utility classes.
   * @default true
   */
  extractAttributes?: boolean;

  /**
   * Extract `<style>` tags with inline CSS into external stylesheet files.
   * @default true
   */
  extractStyleTags?: boolean;

  /**
   * The file name for the extracted CSS file, emitted into the assets directory (e.g. dist/_astro).
   * @default "inline-styles.css"
   */
  outputFileName?: string;

  /**
   * Prefix for generated CSS classes when replacing `style="..."` attributes.
   * @default "is-"
   */
  classPrefix?: string;

  /**
   * If true, only injects the stylesheet `<link>` tag into HTML pages that actually contain
   * extracted styles.
   * @default true
   */
  injectOnlyWhenUsed?: boolean;
}

export interface ExtractScriptsOptions {
  /**
   * Whether inline script extraction is enabled.
   * Extracts inline `<script>` tags (analytics, hydration, third-party widgets, inline snippets)
   * into external JavaScript files.
   * @default true
   */
  enabled?: boolean;

  /**
   * File prefix for extracted scripts (e.g. `inline-`).
   * Emitted into the assets directory (e.g. dist/_astro).
   * @default "inline-"
   */
  filePrefix?: string;

  /**
   * Script types to ignore and keep inline (e.g. JSON-LD structured data).
   * @default ['application/ld+json', 'application/json']
   */
  ignoreTypes?: string[];

  /**
   * Whether extracted scripts should be emitted with `type="module"` if no type was specified.
   * If false, preserves the original script's attributes (e.g. for classic synchronous scripts).
   * @default false
   */
  asModule?: boolean;
}

export interface ExtractEventsOptions {
  /**
   * Whether inline event handler extraction is enabled.
   * Automatically extracts `onclick`, `onsubmit`, `onchange`, etc., into an external delegated dispatcher script.
   * @default true
   */
  enabled?: boolean;

  /**
   * File prefix for generated event dispatcher bundles (e.g. `events-`).
   * Emitted into the assets directory (e.g. `dist/_astro`).
   * @default "events-"
   */
  filePrefix?: string;

  /**
   * Prefix for data attributes placed on elements (e.g. `data-csp-on-`).
   * @default "data-csp-on-"
   */
  dataAttributePrefix?: string;

  /**
   * If true, only injects the dispatcher script tag into HTML pages that actually contain
   * extracted event handlers.
   * @default true
   */
  injectOnlyWhenUsed?: boolean;
}

export interface SriOptions {
  /**
   * Whether Subresource Integrity (SRI) hash injection is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * The cryptographic hashing algorithm to use for SRI.
   * @default "sha384"
   */
  algorithm?: HashAlgorithm;

  /**
   * Compute integrity for local `<script src="...">` tags.
   * @default true
   */
  includeScripts?: boolean;

  /**
   * Compute integrity for local `<link rel="stylesheet">` tags.
   * @default true
   */
  includeStylesheets?: boolean;

  /**
   * `crossorigin` attribute to set on elements with SRI hashes.
   * @default "anonymous"
   */
  crossorigin?: 'anonymous' | 'use-credentials' | false;
}

export interface CspDirectives {
  'default-src'?: string | string[];
  'script-src'?: string | string[];
  'style-src'?: string | string[];
  'img-src'?: string | string[];
  'font-src'?: string | string[];
  'connect-src'?: string | string[];
  'media-src'?: string | string[];
  'object-src'?: string | string[];
  'frame-src'?: string | string[];
  'frame-ancestors'?: string | string[];
  'base-uri'?: string | string[];
  'form-action'?: string | string[];
  'upgrade-insecure-requests'?: boolean | string;
  [directive: string]: string | string[] | boolean | undefined;
}

export interface CspOptions {
  /**
   * Whether CSP generation and enforcement is enabled.
   * @default false
   */
  enabled?: boolean;

  /**
   * Inject `<meta http-equiv="Content-Security-Policy" content="...">` tag into `<head>` of HTML files.
   * @default true
   */
  generateMetaTag?: boolean;

  /**
   * Generate or append CSP to a hosting provider `_headers` file (e.g. for Cloudflare Pages, Netlify).
   * If a string is provided, it is treated as the relative path to the headers file.
   * @default false
   */
  generateHeadersFile?: boolean | string;

  /**
   * Custom CSP directives to enforce. By default, generates a strict policy without 'unsafe-inline'.
   */
  directives?: CspDirectives;
}

export interface StrictCspOptions {
  /**
   * Configuration for extracting inline styles (style attributes and <style> tags).
   * Set to `false` to disable.
   */
  extractStyles?: boolean | ExtractStylesOptions;

  /**
   * Configuration for extracting inline scripts (<script> tags).
   * Set to `false` to disable.
   */
  extractScripts?: boolean | ExtractScriptsOptions;

  /**
   * Configuration for extracting inline event handlers (onclick, onsubmit, etc.).
   * Set to `false` to disable.
   */
  extractEvents?: boolean | ExtractEventsOptions;

  /**
   * Configuration for Subresource Integrity (SRI) hashing.
   * Set to `false` to disable.
   */
  sri?: boolean | SriOptions;

  /**
   * Configuration for Content Security Policy (CSP) header / meta tag generation.
   * Set to `false` to disable.
   */
  csp?: boolean | CspOptions;

  /**
   * Subdirectory under `dist/` where extracted assets will be stored.
   * @default "_astro"
   */
  assetsDir?: string;
}
