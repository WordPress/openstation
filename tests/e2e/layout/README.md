# Layout container browser regression

Run `node tests/e2e/layout/layout-regression.mjs` from the repo root with
Playwright installed and Google Chrome available. If Playwright is supplied by
an external runtime, set `PLAYWRIGHT_MODULE` to its absolute `index.mjs` path.
The script starts and stops its own Vite server and isolated headless browser;
no WordPress database or credentials are required.

Exercises actual CSS geometry and native input: grid spans and shrinking,
scrolling with a fixed footer, bounded panes, pointer resize and Escape cancel,
keyboard limits/direction, RTL, narrow pane selection, vertical layout and
phone overflow, repeated drags during container reflow, and dragging across an actual iframe.
Release tests intercept `pointerup` before it reaches the separator and verify
that native capture loss preserves the dragged position and emits one commit.
The actual Comments client view and production stylesheet also run with deterministic data: the composer stays visible, and narrow list/detail navigation preserves the divider position. Unit tests cover property lifecycle and app integration.
`fixture.html` doubles as a small visual layout gallery. A full-page phone
screenshot is written to `/tmp/os-layout-mobile.png`.
