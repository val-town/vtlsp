# @valtown/ls-ws-server

## 0.0.27

### Patch Changes

- f0a1709: Remove extraneous `package-lock.json` files

  This repo uses workspaces, so the lockfile is managed centrally in `./`.
  Subdirectories had lockfiles which were extraneous and causing the dependabot
  alerts to give false reports.

- b137a31: Switch from ESLint to Biome and update to TypeScript 7

  This is mostly a security issue: biome is a much simpler dependency, and we don't
  have to deal with transitive security problems caused by ESLint's dependency chain.

## 0.0.26

### Patch Changes

- e0fef62: Adopt OIDC for publishing

## 0.0.25

### Patch Changes

- 9b75f2a: Remove unused pino and pino-pretty dependencies
- b242ac1: Remove unused es-toolkit dependency
- 6d70aac: Only use p-timeout and p-queue dependencies when necessary

## 0.0.24

### Patch Changes

- b371642: Switch to changesets
