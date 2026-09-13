# Dock safe-area browser regression

Requires a running development site with OpenStation enabled for the test user,
Google Chrome, and `playwright` available to Node (`NODE_PATH` may point at an
external installation). Run:

```sh
node tests/e2e/dock-safe-area/regression.cjs
```

Defaults to `http://localhost:8889` and `admin` / `password`. Override with
`WP_BASE_URL`, `WP_USER`, and `WP_PASSWORD`. Set `SCREENSHOT` to save the final view.

Checks real window and dock rectangles after maximize, dock-size and viewport
changes, both snap directions, and Static/Dynamic transitions. Settings and
session POSTs are intercepted so the test does not save its layout or windows.
The browser uses a fresh context and closes it on success or failure.
