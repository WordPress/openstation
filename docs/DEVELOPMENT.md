# Development guide

This file is for people working **on** `desktop-mode` — the plugin itself, not plugins that extend it. If you want to extend the shell, start with [`docs/getting-started.md`](./getting-started.md).

## Dev loop

```bash
npm install                # one-time
npm run dev                # watch: rebuilds assets/js/desktop.js on save
npm run lint               # ESLint — our CI runs this
npm run test:js            # Vitest — the full JS suite (jsdom)
npm run test:js:watch      # Vitest in watch mode
npm run build              # produces both assets/js/desktop{,.min}.js

# PHPUnit runs inside a wp-env container (requires Docker):
npm run env:start          # first run pulls WP + MariaDB images
npm run test:php:install   # composer install inside the tests-cli container (once)
npm run test:php           # the PHPUnit run itself
npm run env:stop           # when you're done
```

`npm run env:start` spins up a self-contained WordPress + MariaDB stack under `wp-content/plugins/desktop-mode` — it's scoped to automated tests. Manual QA is a separate concern and runs against the Dockerised environment in the parent Core-checkout repo (`env:start` / `env:install` there).

## Module layout

```
src/
├── public-api.ts            # Barrel: re-exports every plugin-author-facing
│                            #   type / enum / helper. New author-facing
│                            #   symbol? Add it here too.
├── desktop.ts               # Shell entry — boots the window manager,
│                            #   dock, widget layer, wallpaper layer, and
│                            #   exposes `window.wp.desktop`.
├── hooks.ts                 # @wordpress/hooks bridge + the typed HOOKS
│                            #   enum that names every event we fire.
├── types.ts                 # Window / session / config interfaces.
├── shared-store.ts          # Cross-bundle reactive state primitive
│                            #   (`wp.desktop.createSharedStore`).
├── tracked-fetch.ts         # Cross-bundle bridge to `wp.desktop.fetch`.
├── window/                  # Window class + its pointer / chrome / tabs
│                            #   / iframe-bridge / menu helpers.
├── window-manager/          # WindowManager + desktops + arrange + snap
│                            #   + overview helpers.
├── window-system/           # Lazy window-system bundle (entry + loader);
│                            #   `WindowManager.open()` awaits it before
│                            #   constructing any Window.
├── window-chrome/           # Window-chrome customization framework
│                            #   (themes, controls, slots).
├── shell-overlays/          # Lazy bundle for toasts, confirm dialogs,
│                            #   and context menus (entry + loader).
├── commands/                # Command registration: server-sync, shell
│                            #   harvester, iframe bridge.
├── presence/                # Presence store (`wp.desktop.presence`).
├── pwa/                     # PWA: install, notify, service worker.
├── desktop-files/           # Files/folders on the wallpaper
│                            #   (`wp.desktop.files`).
├── recycle-bin/             # Feature windows — one directory per
├── posts-window/            #   window, each compiled to its own
├── plugins-window/          #   lazy Vite bundle (see the `build:*`
├── comments-window/         #   scripts in package.json).
├── my-wordpress/
├── content-graph/
├── ai-assistant/
├── wallpapers/              # Registry, layer, built-ins, types, vendor
│                            #   script loader.
├── widgets/                 # Registry, layer, picker, frame
│                            #   (movable/resizable chrome), state.
├── settings/                # OS Settings panel: state, sections,
│                            #   media REST client.
├── ui/
│   ├── core/                # The tagged-template renderer + base
│   │                        #   Component class + css` helper.
│   └── components/          # <wpd-*> web components (one folder per
│                            #   tag, each with .ts / .styles.ts / .test.ts).
├── modules/                 # Vendor-script registry (PixiJS today,
│                            #   more later). Used by canvas wallpapers.
├── plugins/                 # Built-in plugins that use the public API —
│                            #   animated-logo-wallpaper is the reference
│                            #   example for third-party authors.
├── dock.ts                  # The left-edge dock (icons, tooltips,
│                            #   submenu popover, instance rail).
├── toast.ts                 # Toast queue (wraps <wpd-toast-container>).
├── utils.ts                 # urlMatchKey, deriveWindowId, sanitize*.
└── i18n.ts                  # Thin wrapper around window.wp.i18n.
```

The tree above is curated, not exhaustive — `src/` holds many more
single-purpose modules and feature directories (drag bridge, devtools,
sticky notes, …). Run `ls src/` for the full picture; the shipped
bundles (and the TS entry behind each) are the `build:*` scripts in
`package.json`, resolved via `DESKTOP_MODE_TARGET` in `vite.config.js`.

## Public vs internal

Anything **re-exported from `src/public-api.ts`** is public. We promise
backwards compatibility within a major version — renamed fields, tightened
types, and removed symbols need a deprecation path.

Anything **not** re-exported from `public-api.ts` is internal, even if
the file itself is tracked. In particular:

- `src/window/tabs.ts`, `menus.ts`, `pointer.ts`, `iframe-bridge.ts`,
  `dom.ts` — package-private helpers of the `Window` class.
- `src/window-manager/desktops.ts`, `arrange.ts`, `overview.ts`,
  `snap.ts`, `geometry.ts` — package-private helpers of the
  `WindowManager` class.
- `src/settings/sections/*` — OS Settings internals.
- `src/widgets/frame.ts`, `state.ts` — widget-layer internals.

Class fields prefixed with `_` (e.g. `_externalTabs`, `_activeDesktopId`)
are package-internal. They're public in TypeScript so sibling helper
modules can reach them, but a plugin author touching them is knowingly
off-road.

When adding a new internal symbol, mark it with a JSDoc `@internal` tag
so editors and typedoc can hide it from completion lists:

```ts
/** @internal */
public _privateField: Map< string, unknown > = new Map();
```

## Adding a new hook

1. **Name it.** Convention: `desktop-mode.<domain>.<event>` (JS) or
   `desktop_mode_<domain>_<event>` (PHP). Add the constant to the `HOOKS`
   enum in `src/hooks.ts` with a JSDoc describing payload + timing.
2. **Fire it.** `doAction( HOOKS.NEW_THING, payload )` for actions or
   `applyFilters( HOOKS.NEW_THING, value, context )` for filters.
3. **Document it.** Add a row to `docs/javascript-reference.md` (JS
   hooks) or a full section to `docs/hooks-reference.md` (PHP hooks),
   with status label (Stable / Experimental / Planned).
4. **Test it.** At minimum, a Vitest assertion that the action fires
   with the expected payload — see `tests/vitest/window-lifecycle-hooks.test.ts`
   for patterns.
5. **Example it.** If the hook is non-trivial, add a recipe to
   `docs/examples/` (see `arrange-action.md`, `window-lifecycle.md` as
   templates).

## Adding a new public API method

Everything on `window.wp.desktop` lives in the `WpDesktopPublicApi`
interface in `src/desktop.ts`. To add a method:

1. Add the field to the interface with a JSDoc.
2. Wire it up inside the `window.wp.desktop = { … }` assignment.
3. Re-export whatever types it uses from `src/public-api.ts`.
4. Document it in `docs/javascript-reference.md`.

## Coding conventions

- **TS**: strict mode, tabs, `snake_case` for PHP / `camelCase` for JS.
  Prefer `const` over `let`. No `any`; use `unknown` + type-narrow.
- **CSS**: custom properties for theming. BEM-ish
  `.desktop-mode-{component}__{element}--{modifier}`.
- **PHP**: WordPress standards (tabs, Yoda conditions, `snake_case`),
  `defined( 'ABSPATH' ) || exit;` at the top of every file.
- **Comments**: the "why", not the "what". If a workaround exists for
  a browser quirk or a subtle invariant, note it inline. Otherwise
  let the code speak.

## i18n

Strings flow through three files per locale in `languages/`:

- `desktop-mode.pot` — extracted from PHP and TS sources. Regenerate
  with `npm run extract:i18n` (wraps `wp i18n make-pot` and then
  `msgmerge`-es the refreshed POT into every existing
  `desktop-mode-{locale}.po`).
- `desktop-mode-{locale}.po` / `.mo` — translator output, one pair per
  shipped locale.
- `desktop-mode-{locale}-{handle}.json` — JS translation bundles.
  WordPress's `wp_set_script_translations()` looks up these files by
  the script handle, NOT by source-file hash, because we pass a path
  argument from `includes/assets.php`. Today three handles have
  populated bundles — `desktop-mode` (the main shell),
  `desktop-mode-posts-window`, and `desktop-mode-recycle-bin`; see
  `bin/build-i18n.sh` for the handle to source-prefix map.

The two-step pipeline is:

```bash
npm run extract:i18n   # source -> .pot, then msgmerge into every .po
# (translate the .po files)
npm run build:i18n     # .po -> per-handle JSON bundles
```

Re-run `extract:i18n` whenever a translatable string is added or
changed in PHP or TS source. Re-run `build:i18n` whenever a `.po`
file is updated. `build:i18n` invokes `wp i18n make-json
--extensions=ts` under the hood and merges the per-source JSONs into
one file per script handle.

`npm run i18n` is a convenience alias that runs both stages
back-to-back. Use it when you have just edited translatable strings
in source and want every artifact refreshed in one shot.

### Release-time refresh

`bin/release.sh` runs `npm run i18n` automatically as the first step
of a release (before `bump-version.sh`), so the version-bump commit
also carries the refreshed `.pot`, `.po`, and JSON bundles. The diff
prints to stdout — if the language-file changes look wrong, Ctrl-C
before the bump commits anything.

Pass `--skip-i18n` for hotfixes where you do not want translation-
file churn in the release commit:

```bash
./bin/release.sh 0.9.1 --skip-i18n
```

## Where things are tested

- **Vitest** — `tests/vitest/*.test.ts` + colocated
  `src/**/*.test.ts`. Runs in jsdom.
- **PHPUnit** — `tests/phpunit/tests/*.php`. Tagged `@group desktop-mode`.
  Runs inside wp-env's `tests-cli` container (PHPUnit 9.6 +
  phpunit-polyfills). Configured in `.wp-env.json` + `composer.json`.
- **E2E** — planned (Playwright). Nothing landed yet.

## What breaks most often

- **Circular imports** between `src/window/` helpers — fine at runtime
  with function exports but TypeScript's module ordering can complain.
  Keep side-effect-free type exports separate from function exports.
- **jsdom gaps** — `scrollIntoView`, `CSSStyleSheet.replaceSync`,
  `ResizeObserver` need mocks. Check `tests/vitest/helpers/` before
  adding a fresh one.
- **Vite IIFE** means dynamic `import()` flattens into the main
  bundle. Vendor scripts (PixiJS) ship separately and inject via
  `loadVendorScript` on first use — don't code-split inside `src/`.
