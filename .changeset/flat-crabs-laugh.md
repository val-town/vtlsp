---
"@valtown/codemirror-ls": patch
"@valtown/ls-ws-server": patch
---

Remove extraneous `package-lock.json` files

This repo uses workspaces, so the lockfile is managed centrally in `./`.
Subdirectories had lockfiles which were extraneous and causing the dependabot
alerts to give false reports.
