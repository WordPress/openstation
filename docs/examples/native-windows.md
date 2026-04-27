# Native windows

**Status: Stable.** The native-window registration API has shipped. This page is a redirect — the worked examples live in dedicated docs.

Native windows are windows whose content renders directly in the parent DOM instead of inside a chromeless iframe. Use them for desktop-first UI — small tools, chat widgets, status HUDs — that would be awkward to wedge into a full admin-page iframe.

## Where to start

- **[Register a desktop icon (Jorvy)](./register-icon.md)** — the canonical end-to-end example: PHP `desktop_mode_register_window()` + `desktop_mode_register_icon()` + a JS render callback. Read this first.
- **[Native window with tabs](./native-window-with-tabs.md)** — multi-pane windows via `desktop_mode_register_window_tab()`, including the auto-swap rendering pattern other plugins can extend.
- **[Layout primitives](./layout-primitives.md)** — `<wpd-stack>` / `<wpd-section>` / `<wpd-row>` / etc. Compose these inside your template callback.

## The render-callback contract in one paragraph

The shell clones the registered `<template>` into the window body **before** invoking your render callback, so render is enhancement, not construction: query `body.querySelector( … )` for the mount points your template declared, light them up. The callback's return value is captured as a teardown (cleared on window close — interval cleanup, listener removal, the usual). To start from a blank canvas anyway, call `body.replaceChildren()` first; nothing the shell did is irreversible.

## Related

- [Dock badges](./dock-badge.md) — registering a regular iframe-backed dock item.
- [Architecture: two window types](../architecture.md) — iframe vs native distinction.
- [native-windows-proposal.md](../native-windows-proposal.md) — historical RFC; the shipped API differs in details, the docs above are authoritative.
