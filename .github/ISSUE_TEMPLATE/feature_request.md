---
name: 💡 Feature Request
about: Propose a new feature, configuration option, or integration improvement
title: '[Feature]: '
labels: 'enhancement'
assignees: ''
---

### Problem or Opportunity
<!-- Is your feature request related to a problem or a new requirement? Please describe clearly. -->

### Concrete Real-World Use Case
<!-- Explain why this matters in production. For example: a specific Astro integration, markdown/MDX plugin, third-party script, or strict compliance standard (SOC2, HIPAA, PCI-DSS). -->

### Proposed Solution / API
<!-- How would you like this to work? (e.g. proposed configuration option in astro.config.mjs or CLI behavior) -->
```javascript
// Example proposed configuration in astro.config.mjs
import strictCsp from 'astro-strict-csp';

export default defineConfig({
  integrations: [
    strictCsp({
      // Your proposed option here
    })
  ]
});
```

### Security Considerations & Trade-offs
<!-- Does this change weaken or strengthen CSP security? Does it affect SRI hashing or asset bundling? -->

### Additional Context or Alternatives Considered
<!-- Any other context, references, or alternative solutions you have considered. -->
