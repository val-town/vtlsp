# @valtown/codemirror-ls

## 0.2.5

### Patch Changes

- f0a1709: Remove extraneous `package-lock.json` files

  This repo uses workspaces, so the lockfile is managed centrally in `./`.
  Subdirectories had lockfiles which were extraneous and causing the dependabot
  alerts to give false reports.

- b137a31: Switch from ESLint to Biome and update to TypeScript 7

  This is mostly a security issue: biome is a much simpler dependency, and we don't
  have to deal with transitive security problems caused by ESLint's dependency chain.

## 0.2.4

### Patch Changes

- e0fef62: Adopt OIDC for publishing

## 0.2.3

### Patch Changes

- 2adf7bc: Instantly apply diagnostics, then lazily query for code actions

## 0.2.2

### Patch Changes

- d9fa1c3: Add a global error handler callback (generally for showing error UIs)

## 0.2.1

### Patch Changes

- 6d70aac: Only use p-timeout and p-queue dependencies when necessary

## 0.2.0

### Minor Changes

- 6645eea: Add support for textDocument/inlayHints and fix concurrent diagnostic rendering with lazy textDocument/codeActions evaluation

### Patch Changes

- 3bed294: Fix rename showing up in context menu even if it is disabled

## 0.1.0

### Minor Changes

- fc7f221: Use a global callback for "external" changes

## 0.0.26

### Patch Changes

- b371642: Switch to changesets
