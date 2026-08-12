# Editor-preview browser regression

A Puppeteer regression for one bug class that the jsdom suite structurally
cannot catch: **the shell refreshing the preview companion when nothing was
saved.**

## Why this exists outside `tests/vitest/`

The jsdom tests stub `wp.autosave`, TinyMCE and the heartbeat. Those stubs
encode an *assumption* about how WordPress behaves — and when the assumption is
wrong the tests pass while the bug ships. That happened twice on this bug:

1. A fix gated on core's own compare string. Inert: core already bails on the
   same comparison, so the gate could never fire.
2. A fix gated on a content fingerprint. Correct as far as it went, but aimed at
   the live watch, which turned out not to be the path involved at all.

The actual cause was in the *autosave-request* path: core's `save()` returns
early when `compareString === lastCompareString`, so no request goes out and
`after-autosave` never fires — and the 5 s backstop answered `'saved'` anyway.
The shell believed it and refreshed the companion ~5.4 s after the eye click,
late enough to look like it was caused by whatever the user clicked next.

Only a real browser, with real WordPress JS, surfaces that.

## What it asserts

Both directions, because a fix that just stops refreshing would pass the first
and fail the second:

| Case | Setup | Expected |
|---|---|---|
| **A** | Eye clicked with nothing to save | Companion is **not** refreshed |
| **B** | Eye clicked after a real TinyMCE edit | Companion **is** refreshed |

Each case also performs the reported gesture — click into the preview, click
back into the editor — on the real timeline, since the symptom was a refresh
landing *between* those two clicks.

Case B fails its own setup loudly if TinyMCE never went dirty, so a green run
can't be a run where the mechanism stayed asleep.

## Running it

Needs the dev site at `:8889` up, the plugin active, desktop mode on for
`admin`, and a viewable product.

```bash
cd /path/to/wordpress-alcazaba && docker compose up -d

npm i puppeteer          # not a repo dependency — install where you run it
node tests/e2e/editor-preview/preview-regression.mjs
```

Environment:

- `PRODUCT_ID` — post to edit (default `2087`).

Exit code is 0 only when both cases behave.

## Verifying the test itself

A regression test that has never failed is a guess. To confirm it still catches
the bug, revert the backstop in `src/iframe-bridge-standalone.ts` to
`respond( 'saved' )`, `npm run build`, and re-run: case A must fail with a
refresh at roughly `T+5.4s`.
