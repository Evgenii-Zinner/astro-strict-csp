# Contributing to astro-strict-csp

Thank you for your interest in improving `astro-strict-csp`!

---

## 📢 Please Open Issues, Not Pull Requests (For Now)

If you have found a bug, identified an edge case, or want to suggest a new feature, **please open a GitHub Issue instead of submitting a Pull Request**.

### Why?
As a solo maintainer, I currently do not have the bandwidth to review, verify, and maintain external Pull Requests on a full-time basis. Unsolicited PRs take significant time to audit for zero-dependency guarantees, regex edge cases, cross-platform behavior, and performance overhead.

### How to Help (And What Gets Prioritized)
Opening well-documented issues is the most effective way to help! I actively review and work to resolve issues that provide:

1. **Clear Explanations**: A thorough description of the issue or feature and why it is needed.
2. **Concrete Real-World Use Cases**: Real-world examples (e.g. how a specific UI library, third-party analytics script, SVG generator, or Markdown plugin injects styles/scripts that break strict CSP).
3. **Minimal Reproductions**: Short HTML snippets or a minimal Astro reproduction repository demonstrating the behavior.
4. **Expected vs. Actual Output**: What the output looks like now vs. what strict CSP compliance requires it to look like.
5. **Environment Details**: Your Astro version, Node.js runtime version, and operating system.

Issues with clear explanations and practical use cases will be prioritized and resolved directly in core releases.

---

## 🐛 Bug Reports

When opening a bug report, please include:
- A clear summary of what happened.
- The input HTML before build and the resulting HTML in `dist/`.
- Your `astro.config.mjs` integration configuration.
- Any error messages or console logs.

---

## 💡 Feature & Directive Requests

When requesting new features or CSP directive defaults:
- Describe the security rationale (e.g., compatibility with a security standard or hosting platform).
- Explain whether it should be a default or an opt-in configuration option.

---

## 🤝 Code of Conduct

Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). Please read it to ensure a respectful and welcoming environment for everyone.
