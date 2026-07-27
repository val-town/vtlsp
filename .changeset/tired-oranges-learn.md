---
"@valtown/codemirror-ls": patch
"@valtown/ls-ws-server": patch
---

Switch from ESLint to Biome and update to TypeScript 7

This is mostly a security issue: biome is a much simpler dependency, and we don't
have to deal with transitive security problems caused by ESLint's dependency chain.
