---
"@valtown/codemirror-ls": patch
---

Fix unhandled promise rejections from fire-and-forget notifications sent while the underlying WebSocket is closing or closed. These surfaced in error trackers as "WebSocket is not open" unhandled rejections; the messages were undeliverable anyway, so the transport now swallows the rejection (the message writer already routes write failures through `onError`).
