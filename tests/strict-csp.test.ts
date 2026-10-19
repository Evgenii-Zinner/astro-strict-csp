import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import strictCsp, {
  computeContentHash,
  computeCssClass,
  computeSriHash,
  createEventExtractionState,
  createStyleExtractionState,
  decodeHtmlEntities,
  extractInlineEventsFromHtml,
  extractInlineScriptsFromHtml,
  extractInlineStylesFromHtml,
  formatCspDirectives,
  generateEventDispatcherScript,
  injectCspMetaTag,
  injectSriIntoHtml,
  isExecutableScriptType,
  maskHtmlRegions,
  writeHeadersFile,
} from '../src/index.js';

describe('astro-strict-csp Comprehensive Test Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-csp-comprehensive-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. CRYPTO UTILITIES
  // =========================================================================
  describe('Crypto Utilities', () => {
    it('computes SRI hash from string and Buffer with various algorithms', () => {
      const text = 'console.log("hello");';
      const buffer = Buffer.from(text, 'utf-8');

      const hash384Str = computeSriHash(text, 'sha384');
      const hash384Buf = computeSriHash(buffer, 'sha384');
      expect(hash384Str).toBe(hash384Buf);
      expect(hash384Str).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);

      const hash256 = computeSriHash(buffer, 'sha256');
      expect(hash256).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);

      const hash512 = computeSriHash(buffer, 'sha512');
      expect(hash512).toMatch(/^sha512-[A-Za-z0-9+/=]+$/);
    });

    it('computes CSS classes with default and custom prefixes', () => {
      const rule = 'color: #ff0000;';
      const classDefault = computeCssClass(rule);
      expect(classDefault).toMatch(/^is-[0-9a-f]{6}$/);

      const classCustom = computeCssClass(rule, 'my-prefix-');
      expect(classCustom).toMatch(/^my-prefix-[0-9a-f]{6}$/);

      // Leading, trailing semicolons and whitespace normalization
      expect(computeCssClass('color: #ff0000')).toBe(computeCssClass('  ;;;color: #ff0000;;;  '));
    });

    it('computes content hashes from string and Buffer with custom lengths', () => {
      const code = 'function init() {}';
      const hash8 = computeContentHash(code, 8);
      expect(hash8).toHaveLength(8);

      const hash16 = computeContentHash(Buffer.from(code), 16);
      expect(hash16).toHaveLength(16);
    });
  });

  // =========================================================================
  // 2. HTML UTILITIES & ENTITIES
  // =========================================================================
  describe('HTML Utilities', () => {
    it('decodes all standard HTML entities accurately', () => {
      const encoded =
        '&quot;hello&quot; &apos;world&apos; &#39;test&#39; &#x27;foo&#x27; &#34;bar&#34; &#x22;baz&#x22; &lt;div&gt; &amp; more';
      const decoded = decodeHtmlEntities(encoded);
      expect(decoded).toBe('"hello" \'world\' \'test\' \'foo\' "bar" "baz" <div> & more');
    });

    it('masks and unmasks HTML comments, CDATA, and textarea blocks', () => {
      const input = `
        <!-- Comment: <div style="color:red"></div> -->
        <![CDATA[ <span style="color:blue">raw</span> ]]>
        <textarea><p style="color:green">text</p></textarea>
        <div>Normal content</div>
      `;

      const { masked, unmask } = maskHtmlRegions(input, { maskScripts: false });
      expect(masked).not.toContain('Comment:');
      expect(masked).not.toContain('<![CDATA[');
      expect(masked).not.toContain('<p style=');
      expect(masked).toContain('<div>Normal content</div>');

      const restored = unmask(masked);
      expect(restored).toBe(input);
    });

    it('handles unclosed comments and CDATA sections gracefully', () => {
      const unclosedComment = '<div><!-- unclosed comment content';
      const resultComment = maskHtmlRegions(unclosedComment);
      expect(resultComment.masked).toBe(unclosedComment);
      expect(resultComment.unmask(resultComment.masked)).toBe(unclosedComment);

      const unclosedCdata = '<div><![CDATA[ unclosed CDATA content';
      const resultCdata = maskHtmlRegions(unclosedCdata);
      expect(resultCdata.masked).toBe(unclosedCdata);
      expect(resultCdata.unmask(resultCdata.masked)).toBe(unclosedCdata);
    });

    it('masks scripts when maskScripts: true', () => {
      const input = `<script>const html = '<div style="color:red"></div>';</script><div>Test</div>`;
      const { masked, unmask } = maskHtmlRegions(input, { maskScripts: true });

      expect(masked).not.toContain('<script>');
      expect(masked).toContain('<!--__CSP_MASK_0__-->');
      expect(unmask(masked)).toBe(input);
    });

    it('returns content untouched when unmasking without placeholders', () => {
      const { unmask } = maskHtmlRegions('plain text');
      expect(unmask('plain text')).toBe('plain text');
    });

    it('accurately identifies executable script types', () => {
      expect(isExecutableScriptType(undefined)).toBe(true);
      expect(isExecutableScriptType('')).toBe(true);
      expect(isExecutableScriptType('module')).toBe(true);
      expect(isExecutableScriptType('text/javascript')).toBe(true);
      expect(isExecutableScriptType('application/javascript')).toBe(true);
      expect(isExecutableScriptType('text/ecmascript')).toBe(true);

      // Non-executable
      expect(isExecutableScriptType('application/ld+json')).toBe(false);
      expect(isExecutableScriptType('importmap')).toBe(false);
      expect(isExecutableScriptType('text/template')).toBe(false);
      expect(isExecutableScriptType('text/x-template')).toBe(false);
      expect(isExecutableScriptType('text/plain')).toBe(false);

      // Custom ignored types
      expect(isExecutableScriptType('module', ['module'])).toBe(false);
    });
  });

  // =========================================================================
  // 3. INLINE STYLE EXTRACTION
  // =========================================================================
  describe('Inline Style Extraction', () => {
    it('extracts style attributes and updates classes with cache hits', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `
        <div style=";;color: red;;">First</div>
        <div style="color: red;">Second identical</div>
        <span class="badge" style="color: blue;">Third with class</span>
        <button class='btn' style='color: green;'>Fourth single quote</button>
      `;

      const result = extractInlineStylesFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);
      expect(result.hasExtractedStyles).toBe(true);
      expect(result.html).not.toContain('style=');

      // Deduplication: 2 red divs share the same class
      const redClass = computeCssClass('color: red', 'is-');
      expect(result.html.match(new RegExp(`class="${redClass}"`, 'g'))).toHaveLength(2);
      expect(result.html).toContain('class="badge is-');
      expect(result.html).toContain("class='btn is-");

      expect(state.classToRule.size).toBe(3);
      expect(state.extractedTokenCount).toBe(4);
    });

    it('extracts <style> tags and handles media queries and ignore tags', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `
        <style>body { background: white; }</style>
        <style media="print">@page { margin: 1in; }</style>
        <style data-preserve>code { color: red; }</style>
        <style data-csp-ignore>pre { color: blue; }</style>
      `;

      const result = extractInlineStylesFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);

      // Preserved styles remain in HTML
      expect(result.html).toContain('<style data-preserve>code { color: red; }</style>');
      expect(result.html).toContain('<style data-csp-ignore>pre { color: blue; }</style>');

      // Extracted styles
      expect(state.rawStyles.size).toBe(2);
      expect(Array.from(state.rawStyles)).toContain('body { background: white; }');
      expect(Array.from(state.rawStyles)).toContain('@media print {\n@page { margin: 1in; }\n}');
    });

    it('respects extractAttributes: false and extractStyleTags: false', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `<div style="color: red;"></div><style>h1 { font-size: 20px; }</style>`;

      // Disable attributes extraction
      const res1 = extractInlineStylesFromHtml(inputHtml, state, { extractAttributes: false });
      expect(res1.html).toContain('style="color: red;"');
      expect(res1.html).not.toContain('<style>');

      // Disable style tags extraction
      const state2 = createStyleExtractionState('is-');
      const res2 = extractInlineStylesFromHtml(inputHtml, state2, { extractStyleTags: false });
      expect(res2.html).not.toContain('style="color: red;"');
      expect(res2.html).toContain('<style>h1 { font-size: 20px; }</style>');
    });

    it('handles empty styles and whitespace-only styles gracefully', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `<div style="">Empty</div><span style="   ">Spaces</span><p style=";;;">Semis</p>`;

      const result = extractInlineStylesFromHtml(inputHtml, state);
      expect(result.html).toBe('<div>Empty</div><span>Spaces</span><p>Semis</p>');
      expect(state.classToRule.size).toBe(0);
      expect(state.extractedTokenCount).toBe(0);
    });

    it('handles quotes, escaped characters, and > inside attribute values', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `
        <div aria-label="Step 1 > Step 2" style="background: url(\\"bg.png\\"); font-family: 'Open Sans', sans-serif;">
          <span style="content: &quot;hello&quot;;">Text</span>
        </div>
      `;

      const result = extractInlineStylesFromHtml(inputHtml, state);
      expect(result.html).toContain('aria-label="Step 1 > Step 2"');
      expect(result.html).not.toContain('style=');
      expect(state.classToRule.size).toBe(2);

      const rules = Array.from(state.classToRule.values()).join('\n');
      expect(rules).toContain('content: "hello"');
    });

    it('preserves internal whitespace in attributes without style', () => {
      const state = createStyleExtractionState('is-');
      const inputHtml = `<div data-title="Foo   Bar" style="color: red;" aria-label="One   Two">Text</div>`;

      const result = extractInlineStylesFromHtml(inputHtml, state);
      expect(result.html).toContain('data-title="Foo   Bar"');
      expect(result.html).toContain('aria-label="One   Two"');
    });
  });

  // =========================================================================
  // 4. INLINE SCRIPT EXTRACTION
  // =========================================================================
  describe('Inline Script Extraction', () => {
    it('extracts executable inline scripts and preserves classic vs module execution', () => {
      const inputHtml = `
        <script>const syncInit = 1;</script>
        <script type="module">import { app } from './app.js';</script>
        <script type="text/javascript">var legacy = 2;</script>
        <script data-preserve>const keep = true;</script>
        <script data-csp-ignore>const ignore = true;</script>
        <script type="application/ld+json">{"@type": "Person"}</script>
        <script type="importmap">{"imports": {}}</script>
        <script></script>
      `;

      const result = extractInlineScriptsFromHtml(inputHtml, { asModule: false });
      expect(result.modified).toBe(true);
      expect(result.scripts.length).toBe(3);

      // Preserved inline scripts
      expect(result.html).toContain('<script data-preserve>const keep = true;</script>');
      expect(result.html).toContain('<script data-csp-ignore>const ignore = true;</script>');
      expect(result.html).toContain('type="application/ld+json"');
      expect(result.html).toContain('type="importmap"');

      // Classic sync script preserves non-module behavior
      expect(result.html).toMatch(/<script src="\/_astro\/inline-[0-9a-f]{8}\.js"><\/script>/);
      // Module script preserves type="module"
      expect(result.html).toMatch(
        /<script src="\/_astro\/inline-[0-9a-f]{8}\.js" type="module"><\/script>/,
      );

      // Empty script tag was stripped
      expect(result.html).not.toContain('<script></script>');
    });

    it('supports asModule: true override for all extracted scripts', () => {
      const inputHtml = `<script>console.log("force module");</script>`;
      const result = extractInlineScriptsFromHtml(inputHtml, { asModule: true });

      expect(result.html).toMatch(
        /<script src="\/_astro\/inline-[0-9a-f]{8}\.js" type="module"><\/script>/,
      );
    });

    it('leaves scripts with existing src untouched', () => {
      const inputHtml = `<script src="/_astro/existing.js"></script>`;
      const result = extractInlineScriptsFromHtml(inputHtml);
      expect(result.modified).toBe(false);
      expect(result.scripts.length).toBe(0);
    });
  });

  // =========================================================================
  // 4.5. INLINE EVENT HANDLER EXTRACTION
  // =========================================================================
  describe('Inline Event Handler Extraction', () => {
    it('extracts inline event handlers and deduplicates identical code across elements', () => {
      const state = createEventExtractionState();
      const inputHtml = `
        <div class="container">
          <button onclick="window.print()" class="btn">Print 1</button>
          <button onclick="window.print()">Print 2</button>
          <a href="#" onclick="doSomething(event)">Link</a>
        </div>
      `;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);
      expect(result.hasExtractedEvents).toBe(true);
      expect(result.html).toContain('<div class="container">');
      expect(result.html).not.toContain('onclick=');

      // Deduplication: 2 identical print buttons share the exact same handler ID
      const printId = state.codeToId.get('window.print()') ?? '';
      expect(printId).toMatch(/^evt-[0-9a-f]{6}$/);
      expect(result.html.match(new RegExp(`data-csp-on-click="${printId}"`, 'g'))).toHaveLength(2);

      // Distinct handler for link
      const linkId = state.codeToId.get('doSomething(event)') ?? '';
      expect(result.html).toContain(`data-csp-on-click="${linkId}"`);

      expect(state.idToCode.size).toBe(2);
      expect(state.extractedEventCount).toBe(3);
      expect(state.activeEvents.has('click')).toBe(true);
    });

    it('handles multiple different event handlers on the same element', () => {
      const state = createEventExtractionState();
      const inputHtml = `<input type="text" oninput="updateVal()" onchange="saveVal()">`;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);
      expect(result.hasExtractedEvents).toBe(true);
      expect(result.html).not.toContain('oninput=');
      expect(result.html).not.toContain('onchange=');

      expect(result.html).toMatch(/data-csp-on-input="evt-[0-9a-f]{6}"/);
      expect(result.html).toMatch(/data-csp-on-change="evt-[0-9a-f]{6}"/);

      expect(state.activeEvents.has('input')).toBe(true);
      expect(state.activeEvents.has('change')).toBe(true);
    });

    it('decodes HTML entities in event handler attributes', () => {
      const state = createEventExtractionState();
      const inputHtml = `<button onclick="alert(&quot;hello &amp; world&quot;);">&#39;Click&#39;</button>`;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);

      const code = state.idToCode.get(Array.from(state.idToCode.keys())[0]);
      expect(code).toBe('alert("hello & world");');
    });

    it('supports single quotes and removes empty handlers', () => {
      const state = createEventExtractionState();
      const inputHtml = `
        <button onclick='doSingle()'>Single</button>
        <form onsubmit="" onreset="   ">Form</form>
      `;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);
      expect(result.html).toContain('data-csp-on-click="evt-');
      expect(result.html).not.toContain('onsubmit');
      expect(result.html).not.toContain('onreset');
    });

    it('respects data-preserve and data-csp-ignore on elements', () => {
      const state = createEventExtractionState();
      const inputHtml = `
        <button onclick="keep()" data-preserve>Preserve</button>
        <button onclick="ignore()" data-csp-ignore>Ignore</button>
      `;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(false);
      expect(result.html).toBe(inputHtml);
      expect(state.idToCode.size).toBe(0);
    });

    it('masks comments, CDATA, textareas, and script blocks during event extraction', () => {
      const state = createEventExtractionState();
      const inputHtml = `
        <!-- <button onclick="window.print()">In comment</button> -->
        <![CDATA[ <button onclick="window.print()">In CDATA</button> ]]>
        <textarea><button onclick="window.print()">In textarea</button></textarea>
        <script>const html = '<button onclick="window.print()">In script</button>';</script>
        <button onclick="window.print()">Real button</button>
      `;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(true);
      expect(state.extractedEventCount).toBe(1);

      // Masked regions are untouched
      expect(result.html).toContain(
        '<!-- <button onclick="window.print()">In comment</button> -->',
      );
      expect(result.html).toContain(
        '<![CDATA[ <button onclick="window.print()">In CDATA</button> ]]>',
      );
      expect(result.html).toContain(
        '<textarea><button onclick="window.print()">In textarea</button></textarea>',
      );
      expect(result.html).toContain(
        '<script>const html = \'<button onclick="window.print()">In script</button>\';</script>',
      );
      expect(result.html).toContain('data-csp-on-click="evt-');
    });

    it('returns unchanged HTML when no on* attributes exist', () => {
      const state = createEventExtractionState();
      const inputHtml = `<div><span class="badge">Only text</span></div>`;

      const result = extractInlineEventsFromHtml(inputHtml, state);
      expect(result.modified).toBe(false);
      expect(result.hasExtractedEvents).toBe(false);
      expect(result.html).toBe(inputHtml);
    });

    it('generates a valid, capturing runtime dispatcher script', () => {
      const state = createEventExtractionState();
      state.idToCode.set('evt-123456', 'window.print();');
      state.idToCode.set('evt-abcdef', 'return false;');
      state.activeEvents.add('click');
      state.activeEvents.add('submit');

      const script = generateEventDispatcherScript(state);
      expect(script).toContain('"evt-123456": function(event) {');
      expect(script).toContain('window.print();');
      expect(script).toContain('"evt-abcdef": function(event) {');
      expect(script).toContain('return false;');
      expect(script).toContain('["click","submit"]');
      expect(script).toContain('document.addEventListener(eventName, function(e) {');
      expect(script).toContain('fn.call(el, e)');
      expect(script).toContain('e.preventDefault();');
      expect(script).toContain('}, true);');
    });
  });

  // =========================================================================
  // 5. SUBRESOURCE INTEGRITY (SRI)
  // =========================================================================
  describe('Subresource Integrity (SRI)', () => {
    it('computes and injects SRI into local scripts and link tags, including self-closing tags', () => {
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });

      const jsContent = 'console.log("test-sri");';
      const cssContent = 'body { color: blue; }';
      fs.writeFileSync(path.join(astroDir, 'app.js'), jsContent);
      fs.writeFileSync(path.join(astroDir, 'main.css'), cssContent);

      const expectedJsSri = computeSriHash(jsContent, 'sha384');
      const expectedCssSri = computeSriHash(cssContent, 'sha384');

      const inputHtml = `
        <script src="/_astro/app.js"></script>
        <link rel="stylesheet" href="/_astro/main.css" />
        <link rel="stylesheet" href="/_astro/main.css">
        <link rel="icon" href="/favicon.ico">
        <script src="https://cdn.example.com/lib.js"></script>
        <script src="/_astro/missing.js"></script>
      `;

      const result = injectSriIntoHtml(inputHtml, tempDir, {
        algorithm: 'sha384',
        crossorigin: 'anonymous',
      });

      expect(result.modified).toBe(true);
      expect(result.patchedCount).toBe(3);

      // Verified integrity attributes
      expect(result.html).toContain(`integrity="${expectedJsSri}"`);
      expect(result.html).toContain(`integrity="${expectedCssSri}"`);

      // Verified self-closing tag preserved without stray slash
      expect(result.html).not.toContain('/ integrity=');
      expect(result.html).toMatch(
        /href="\/_astro\/main\.css" integrity="[^"]+" crossorigin="anonymous" \/>/,
      );

      // Remote, missing, and non-stylesheet resources skipped
      expect(result.html).toContain('<script src="https://cdn.example.com/lib.js"></script>');
      expect(result.html).toContain('<script src="/_astro/missing.js"></script>');
      expect(result.html).toContain('<link rel="icon" href="/favicon.ico">');
    });

    it('skips tags that already have integrity attributes', () => {
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(path.join(astroDir, 'existing.js'), 'var a = 1;');

      const inputHtml = `<script src="/_astro/existing.js" integrity="sha384-alreadyThere"></script>`;
      const result = injectSriIntoHtml(inputHtml, tempDir);
      expect(result.modified).toBe(false);
      expect(result.html).toContain('sha384-alreadyThere');
    });

    it('supports custom algorithm (sha256/sha512) and custom crossorigin', () => {
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(path.join(astroDir, 'test.js'), 'let x = 1;');

      const inputHtml = `<script src="/_astro/test.js"></script>`;
      const result = injectSriIntoHtml(inputHtml, tempDir, {
        algorithm: 'sha256',
        crossorigin: 'use-credentials',
      });

      expect(result.html).toContain('integrity="sha256-');
      expect(result.html).toContain('crossorigin="use-credentials"');
    });

    it('supports disabling crossorigin attribute', () => {
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(path.join(astroDir, 'test.js'), 'let x = 1;');

      const inputHtml = `<script src="/_astro/test.js"></script>`;
      const result = injectSriIntoHtml(inputHtml, tempDir, {
        crossorigin: false,
      });

      expect(result.html).toContain('integrity="sha384-');
      expect(result.html).not.toContain('crossorigin=');
    });

    it('resolves relative paths and blocks directory traversal outside outDir', () => {
      const blogDir = path.join(tempDir, 'blog');
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(blogDir, { recursive: true });
      fs.mkdirSync(astroDir, { recursive: true });

      fs.writeFileSync(path.join(astroDir, 'local.js'), 'const local = true;');

      // Valid relative path from blog/index.html
      const htmlFile = path.join(blogDir, 'index.html');
      const validHtml = `<script src="../_astro/local.js"></script>`;
      const resValid = injectSriIntoHtml(validHtml, tempDir, {}, htmlFile);
      expect(resValid.modified).toBe(true);
      expect(resValid.html).toContain('integrity="sha384-');

      // Traversal attempt outside tempDir
      const traversalHtml = `<script src="../../../etc/passwd"></script>`;
      const resTraversal = injectSriIntoHtml(traversalHtml, tempDir, {}, htmlFile);
      expect(resTraversal.modified).toBe(false);
      expect(resTraversal.html).not.toContain('integrity=');
    });

    it('supports includeScripts: false and includeStylesheets: false', () => {
      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(path.join(astroDir, 'a.js'), 'a');
      fs.writeFileSync(path.join(astroDir, 'a.css'), 'a');

      const inputHtml = `<script src="/_astro/a.js"></script><link rel="stylesheet" href="/_astro/a.css">`;

      const resNoScripts = injectSriIntoHtml(inputHtml, tempDir, { includeScripts: false });
      expect(resNoScripts.html).not.toContain('a.js" integrity=');
      expect(resNoScripts.html).toContain('a.css" integrity=');

      const resNoStyles = injectSriIntoHtml(inputHtml, tempDir, { includeStylesheets: false });
      expect(resNoStyles.html).toContain('a.js" integrity=');
      expect(resNoStyles.html).not.toContain('a.css" integrity=');
    });
  });

  // =========================================================================
  // 6. CONTENT SECURITY POLICY (CSP)
  // =========================================================================
  describe('Content Security Policy (CSP)', () => {
    it('formats CSP directives with booleans, strings, and arrays', () => {
      const directives = {
        'default-src': ["'none'"],
        'script-src': "'self' https://trusted.com",
        'style-src': ["'self'"],
        'disabled-directive': false,
        'null-directive': undefined,
        'upgrade-insecure-requests': true,
      };

      const policy = formatCspDirectives(directives);
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self' https://trusted.com");
      expect(policy).toContain("style-src 'self'");
      expect(policy).toContain('upgrade-insecure-requests');
      expect(policy).not.toContain('disabled-directive');
      expect(policy).not.toContain('null-directive');
    });

    it('strips meta-unsupported directives (frame-ancestors, report-uri, sandbox) when isMetaTag: true', () => {
      const directives = {
        'default-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'report-uri': '/csp-report',
        sandbox: 'allow-scripts',
      };

      const metaPolicy = formatCspDirectives(directives, true);
      expect(metaPolicy).not.toContain('frame-ancestors');
      expect(metaPolicy).not.toContain('report-uri');
      expect(metaPolicy).not.toContain('sandbox');
      expect(metaPolicy).toContain("default-src 'self'");

      const headerPolicy = formatCspDirectives(directives, false);
      expect(headerPolicy).toContain("frame-ancestors 'none'");
      expect(headerPolicy).toContain('report-uri /csp-report');
      expect(headerPolicy).toContain('sandbox allow-scripts');
    });

    it('injects CSP meta tag and updates existing CSP meta tag', () => {
      const freshHtml = '<html><head><title>Test</title></head><body></body></html>';
      const resFresh = injectCspMetaTag(freshHtml, "default-src 'self'");
      expect(resFresh.modified).toBe(true);
      expect(resFresh.html).toContain(
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
      );

      // Updating existing CSP meta tag
      const existingHtml =
        '<html><head><meta http-equiv="Content-Security-Policy" content="old-policy"></head></html>';
      const resUpdate = injectCspMetaTag(existingHtml, "default-src 'none'");
      expect(resUpdate.modified).toBe(true);
      expect(resUpdate.html).toContain('content="default-src \'none\'"');
      expect(resUpdate.html).not.toContain('old-policy');

      // Without head tag
      const noHead = '<div>Fragment</div>';
      const resNoHead = injectCspMetaTag(noHead, "default-src 'self'");
      expect(resNoHead.modified).toBe(false);
      expect(resNoHead.html).toBe(noHead);
    });

    it('writes and updates _headers file with custom target file', () => {
      const customFile = 'custom_headers';
      writeHeadersFile(tempDir, "default-src 'self'", customFile);

      const filePath = path.join(tempDir, customFile);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("Content-Security-Policy: default-src 'self'");

      // Overwriting existing policy in headers
      writeHeadersFile(tempDir, "default-src 'none'", customFile);
      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      expect(updatedContent).toContain("Content-Security-Policy: default-src 'none'");
      expect(updatedContent).not.toContain("default-src 'self'");
    });
  });

  // =========================================================================
  // 7. ASTRO INTEGRATION LIFECYCLE & HOOKS
  // =========================================================================
  describe('Astro Integration Lifecycle Hooks', () => {
    function getHook(
      integration: ReturnType<typeof strictCsp>,
      hookName: 'astro:config:setup' | 'astro:build:done',
    ) {
      const hook = integration.hooks[hookName];
      if (!hook) throw new Error(`Hook ${hookName} not found`);
      return hook as (args: {
        config?: { build?: { inlineStylesheets?: 'always' | 'never' | 'auto' } };
        dir?: URL;
        logger?: {
          info?: (msg: string) => void;
          warn?: (msg: string) => void;
          error?: (msg: string) => void;
        };
      }) => Promise<void> | void;
    }

    it('warns in astro:config:setup if build.inlineStylesheets is "always"', () => {
      const integration = strictCsp();
      const loggerWarn = vi.fn();

      const setupHook = getHook(integration, 'astro:config:setup');
      setupHook({
        config: { build: { inlineStylesheets: 'always' } },
        logger: { warn: loggerWarn },
      });

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('inlineStylesheets` is set to "always"'),
      );
    });

    it('does not warn if build.inlineStylesheets is not "always"', () => {
      const integration = strictCsp();
      const loggerWarn = vi.fn();

      const setupHook = getHook(integration, 'astro:config:setup');
      setupHook({
        config: { build: { inlineStylesheets: 'never' } },
        logger: { warn: loggerWarn },
      });

      expect(loggerWarn).not.toHaveBeenCalled();
    });

    it('returns early in astro:build:done if output directory does not exist', async () => {
      const integration = strictCsp();
      const doneHook = getHook(integration, 'astro:build:done');

      const nonExistentDir = new URL(`file://${tempDir}/non-existent/`);
      await expect(
        doneHook({ dir: nonExistentDir, logger: { info: vi.fn() } }),
      ).resolves.toBeUndefined();
    });

    it('returns early in astro:build:done if no HTML files are found', async () => {
      const integration = strictCsp();
      const doneHook = getHook(integration, 'astro:build:done');

      const emptyDir = new URL(`file://${tempDir}/`);
      await expect(doneHook({ dir: emptyDir, logger: { info: vi.fn() } })).resolves.toBeUndefined();
    });

    it('supports injectOnlyWhenUsed: false to inject stylesheet link on all pages', async () => {
      const integration = strictCsp({
        extractStyles: { injectOnlyWhenUsed: false },
        extractScripts: false,
        sri: false,
        csp: false,
      });

      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });

      // Page 1 has styles
      const p1Path = path.join(tempDir, 'p1.html');
      fs.writeFileSync(
        p1Path,
        '<html><head></head><body><div style="color: red;">P1</div></body></html>',
      );

      // Page 2 has NO styles
      const p2Path = path.join(tempDir, 'p2.html');
      fs.writeFileSync(p2Path, '<html><head></head><body><div>P2 Plain</div></body></html>');

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn() },
      });

      // Both pages must receive the stylesheet link
      const p1Processed = fs.readFileSync(p1Path, 'utf-8');
      const p2Processed = fs.readFileSync(p2Path, 'utf-8');
      expect(p1Processed).toContain('href="/_astro/inline-styles.css"');
      expect(p2Processed).toContain('href="/_astro/inline-styles.css"');
    });

    it('injects stylesheet link even when HTML body text contains the stylesheet path string', async () => {
      const integration = strictCsp({
        extractScripts: false,
        sri: false,
        csp: false,
      });

      const pPath = path.join(tempDir, 'article.html');
      fs.writeFileSync(
        pPath,
        '<html><head><title>Test</title></head><body><div style="color: blue;">Blue</div><p>We output /_astro/inline-styles.css here</p></body></html>',
      );

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn() },
      });

      const processed = fs.readFileSync(pPath, 'utf-8');
      expect(processed).toContain('<link rel="stylesheet" href="/_astro/inline-styles.css">');
    });

    it('executes full pipeline with all modules enabled (end-to-end integration)', async () => {
      const integration = strictCsp({
        csp: { enabled: true, generateMetaTag: true, generateHeadersFile: true },
      });

      const astroDir = path.join(tempDir, '_astro');
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(path.join(astroDir, 'bundle.js'), 'console.log("bundle");');

      const page1Html = `<!DOCTYPE html>
<html>
<head><title>Page 1</title></head>
<body>
  <div style="background: red;">Alert</div>
  <style>h2 { color: gray; }</style>
  <script>console.log("init-1");</script>
  <script src="/_astro/bundle.js"></script>
</body>
</html>`;

      const page2Html = `<!DOCTYPE html>
<html>
<head><title>Page 2</title></head>
<body>
  <div style="background: red;">Same Alert</div>
  <style>h2 { color: gray; }</style>
</body>
</html>`;

      const p1Path = path.join(tempDir, 'page1.html');
      const p2Path = path.join(tempDir, 'page2.html');
      fs.writeFileSync(p1Path, page1Html, 'utf-8');
      fs.writeFileSync(p2Path, page2Html, 'utf-8');

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const processedP1 = fs.readFileSync(p1Path, 'utf-8');
      const processedP2 = fs.readFileSync(p2Path, 'utf-8');

      // Styles extracted into inline-styles.css
      expect(processedP1).not.toContain('style="background: red;"');
      expect(processedP1).toContain('class="is-');
      expect(processedP1).toContain('href="/_astro/inline-styles.css"');
      expect(processedP2).toContain('class="is-');

      // Shared styles deduplicated
      const cssContent = fs.readFileSync(path.join(astroDir, 'inline-styles.css'), 'utf-8');
      const occurrences = (cssContent.match(/h2 \{ color: gray; \}/g) || []).length;
      expect(occurrences).toBe(1);

      // Scripts extracted
      expect(processedP1).not.toContain('<script>console.log("init-1");</script>');
      expect(processedP1).toMatch(/<script src="\/_astro\/inline-[0-9a-f]{8}\.js"/);

      // SRI integrity hashes injected
      expect(processedP1).toMatch(/<script src="\/_astro\/bundle\.js" integrity="sha384-[^"]+"/);
      expect(processedP1).toMatch(/href="\/_astro\/inline-styles\.css" integrity="sha384-[^"]+"/);

      // CSP meta and _headers
      expect(processedP1).toContain('<meta http-equiv="Content-Security-Policy" content="');
      expect(fs.existsSync(path.join(tempDir, '_headers'))).toBe(true);
    });

    it('supports completely disabling modules via boolean false', async () => {
      const integration = strictCsp({
        extractStyles: false,
        extractScripts: false,
        extractEvents: false,
        sri: false,
        csp: false,
      });

      const pageHtml =
        '<html><head></head><body><div style="color: red;">Text</div><script>var x = 1;</script><button onclick="window.print()">Print</button></body></html>';
      const pagePath = path.join(tempDir, 'index.html');
      fs.writeFileSync(pagePath, pageHtml);

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn() },
      });

      const processed = fs.readFileSync(pagePath, 'utf-8');
      expect(processed).toContain('style="color: red;"');
      expect(processed).toContain('<script>var x = 1;</script>');
      expect(processed).toContain('onclick="window.print()"');
      expect(fs.existsSync(path.join(tempDir, '_headers'))).toBe(false);
    });

    it('extracts inline event handlers and emits dispatcher bundle with SRI in astro:build:done', async () => {
      const integration = strictCsp({
        extractStyles: false,
        extractScripts: false,
        extractEvents: true,
        sri: true,
        csp: false,
      });

      const p1Html =
        '<html><head></head><body><button onclick="window.print()">Print</button></body></html>';
      const p2Html = '<html><head></head><body><div>No Events</div></body></html>';
      const p1Path = path.join(tempDir, 'p1.html');
      const p2Path = path.join(tempDir, 'p2.html');
      fs.writeFileSync(p1Path, p1Html);
      fs.writeFileSync(p2Path, p2Html);

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const processedP1 = fs.readFileSync(p1Path, 'utf-8');
      const processedP2 = fs.readFileSync(p2Path, 'utf-8');

      // p1 has onclick replaced with data-csp-on-click
      expect(processedP1).not.toContain('onclick=');
      expect(processedP1).toMatch(/data-csp-on-click="evt-[0-9a-f]{6}"/);

      // p1 gets the dispatcher script with SRI integrity hash
      expect(processedP1).toMatch(
        /<script src="\/_astro\/events-[0-9a-f]{8}\.js"[^>]*integrity="sha384-[^"]+"[^>]*crossorigin="anonymous"[^>]*><\/script>/,
      );
      expect(processedP1).toContain('defer');

      // p2 had no events and injectOnlyWhenUsed: true, so it does not get the script tag
      expect(processedP2).not.toContain('/_astro/events-');
    });

    it('injects event dispatcher into all pages when injectOnlyWhenUsed is false', async () => {
      const integration = strictCsp({
        extractStyles: false,
        extractScripts: false,
        extractEvents: {
          injectOnlyWhenUsed: false,
        },
        sri: false,
        csp: false,
      });

      const p1Html =
        '<html><head></head><body><button onclick="alert(1)">Alert</button></body></html>';
      const p2Html = '<html><body><div>No head, body only</div></body></html>';
      const p1Path = path.join(tempDir, 'p1.html');
      const p2Path = path.join(tempDir, 'p2.html');
      fs.writeFileSync(p1Path, p1Html);
      fs.writeFileSync(p2Path, p2Html);

      const doneHook = getHook(integration, 'astro:build:done');
      await doneHook({
        dir: new URL(`file://${tempDir}/`),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const processedP1 = fs.readFileSync(p1Path, 'utf-8');
      const processedP2 = fs.readFileSync(p2Path, 'utf-8');

      expect(processedP1).toMatch(
        /<script src="\/_astro\/events-[0-9a-f]{8}\.js" defer><\/script>/,
      );
      expect(processedP2).toMatch(
        /<script src="\/_astro\/events-[0-9a-f]{8}\.js" defer><\/script>\s*<\/body>/,
      );
    });

    it('exports strictCsp and astroStrictCsp as named exports identical to default export', async () => {
      const { strictCsp: namedCsp, astroStrictCsp } = await import('../src/index.js');
      expect(namedCsp).toBe(strictCsp);
      expect(astroStrictCsp).toBe(strictCsp);
      const instance = astroStrictCsp();
      expect(instance.name).toBe('astro-strict-csp');
    });
  });
});
