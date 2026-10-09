# Form browser regression

From the repository root, run `node tests/e2e/forms/form-regression.mjs` with
Playwright installed and Chrome available. Set `PLAYWRIGHT_MODULE` to the absolute
path of Playwright's `index.mjs` when using an external installation.

The script serves a local Vite fixture and checks real switch/Enter/button input,
the busy interaction lock across shadow DOM and slots, retry after busy clears,
preservation of disabled fields, and repeated resets of mutable tag data. Pixel
checks verify date, datetime-local, month and week glyphs against the default and
Legacy palettes, a custom foreground override, and forced-colors mode. Set `FORM_SCREENSHOT` to save
the date-field comparison as a PNG. The test does
not require WordPress or write server data. Users profile save failures are covered
by `apps/users/profile/form.test.ts` with controlled HTTP and network responses.
