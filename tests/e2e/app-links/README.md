# App-link browser regression

Start the clean WordPress test host with `npm run env:start:tests`, activate
`desktop-mode`, and enable OpenStation for the test user. With Playwright and
Google Chrome available, run:

```sh
node tests/e2e/app-links/app-links-regression.mjs
```

`PLAYWRIGHT_MODULE` may name an absolute Playwright `index.mjs` path.
`OPENSTATION_TEST_URL` defaults to `http://localhost:8891`; `WP_TEST_USER` and
`WP_TEST_PASSWORD` default to `admin` and `password`. Use a disposable test
account: the test opens windows and preserves only its original app-link setting.

Exercises the actual Preferences checkbox, the selectable status bar along the
bottom of native and iframe windows and its copy icon, canonical addresses (a plain admin URL for
an iframe window, `admin.php?page=openstation&app=<id>` for a native app),
iframe navigation, a cold shared-link boot, following a link from a loaded
desktop, one-shot URL cleanup, and hiding every status bar immediately.
Screenshots are written to `/tmp/os-app-links-native.png` and
`/tmp/os-app-links-iframe.png`.
