# Development guide

This file is for people working **on** `openstation` — the plugin itself, not plugins that extend it. If you want to extend the shell, start with [`docs/getting-started.md`](./getting-started.md).

## Dev loop

```bash
npm install                # one-time
npm run dev                # watch: rebuilds assets/js/desktop.js on save
npm run lint               # ESLint — our CI runs this
npm run test:js            # Vitest — the full JS suite (jsdom)
npm run test:js:watch      # Vitest in watch mode
npm run build              # produces both assets/js/desktop{,.min}.js

# PHPUnit and PHPCS run inside a dedicated wp-env instance (requires Docker):
npm run env:start:tests    # first run pulls WP + MariaDB images
npm run test:php:install   # composer install inside the tests instance (once)
npm run test:php           # the PHPUnit run itself
npm run lint:php           # PHPCS, errors only — this is what CI gates on
npm run lint:php:all       # PHPCS including advisory warnings
npm run lint:php:fix       # PHPCBF — applies every auto-fixable rule
npm run env:stop:tests     # when you're done
```

`npm run env:start` spins up a self-contained WordPress + MariaDB stack with this checkout bind-mounted as the plugin: the manual QA environment on `http://localhost:8890/wp-admin/` (`admin` / `password`). PHPUnit runs in a second, independent instance defined by `.wp-env.tests.json` (port `8891`), started with `npm run env:start:tests`; the `test:php*` scripts target it via wp-env's `--config` flag, so QA state and test runs never share a database. See [Manual QA and per-worktree instances](#manual-qa-and-per-worktree-instances-wp-env) for how the mount works and how to run one instance per git worktree.

## Manual QA and per-worktree instances (wp-env)

### How the instance works

- The `"wp-content/plugins/desktop-mode": "."` mapping in `.wp-env.json` bind-mounts the directory you run `wp-env start` from straight into the container. PHP edits are live on the next request; JS changes appear after `npm run build`, because the site serves whatever is in `assets/js/` right now. The enqueued bundles' `?ver=` cache-buster is filemtime-based, so a normal browser reload picks up fresh builds.
- wp-env keys everything to the start directory plus the config file: it hashes them and gives each combination its own containers, database, and WordPress volume under `~/.wp-env/<hash>/`. Same directory + same config, same instance, every time. That's how `.wp-env.json` (QA) and `.wp-env.tests.json` (PHPUnit) run as two fully isolated stacks from one checkout.
- Ports: `8890` (QA instance, `.wp-env.json`) and `8891` (tests instance, `.wp-env.tests.json`). They are remapped from wp-env's defaults so the stacks coexist with a Core checkout's environment (see the PHPUnit section of `AGENTS.md`).
- `bin/sync-to-wp-develop.sh` does **not** feed this instance. It mirrors the tree into a wordpress-develop checkout, which is a different environment entirely. The wp-env instance always serves the start directory live through the mount; there is no copy step to forget.

### Testing several worktrees at once

Because the instance identity includes the start directory, every git worktree can run its own fully isolated stack in parallel. The only knob is ports, since each worktree inherits `8890`/`8891` from the tracked config files. `WP_ENV_PORT` applies to whichever instance the command starts:

```bash
cd <path-to-worktree>
npm install        # worktrees start bare
npm run build
WP_ENV_PORT=8894 npm run env:start          # QA instance
WP_ENV_PORT=8895 npm run env:start:tests    # PHPUnit instance (if needed)
```

`http://localhost:8894/wp-admin/` now serves that worktree's code while the main checkout's instance keeps serving `:8890`. Databases, uploads, and user state are all per-instance.

Notes:

- **Skipping the port override fails loudly, not subtly.** If another running instance already holds `8890`, Docker refuses to bind ("port is already allocated") and `wp-env start` aborts; nothing silently cross-connects to the other site. Instances only conflict while running, so a stopped main instance frees `8890` for a worktree.
- **Prefer override files for long-lived worktrees.** Drop `{ "port": 8894 }` in a git-ignored `.wp-env.override.json` (and `{ "port": 8895 }` in `.wp-env.tests.override.json` if you run PHPUnit there) and a plain `npm run env:start` / `env:start:tests` does the right thing from then on. The `WP_ENV_PORT` env var wins over the override file when both are set.
- **Run wp-env commands from the worktree's directory.** `env:start`, `env:stop`, `env:destroy`, their `:tests` variants, and `test:php` all resolve the instance from the current directory.
- **Cost.** Each instance is three containers (WordPress, CLI, database). `npm run env:stop` / `env:stop:tests` parks an instance and keeps its data; `npm run env:destroy` / `env:destroy:tests` deletes it.
- `npm run test:php` in a worktree runs inside that worktree's own tests instance, so PHPUnit is isolated per worktree too.

## Measuring boot cost

`bin/boot-cost.mjs` answers one question deterministically: what does the shell's boot document actually cost, and what changed between two builds. It logs into a local WordPress, fetches one document, then fetches every `<script src>` and `<link rel=stylesheet>` the **server** printed into it, and reports request count plus raw and gzipped bytes grouped by owner.

Measuring the server's output rather than the browser's behaviour is the whole point. DevTools' footer totals (`N requests / X MB transferred / Finish: Y`) move with cache state, with how long the tab sat there polling, and with how many windows you opened, so two recordings of the same build routinely disagree by more than the change being measured. Same code in, same numbers out.

It needs a running instance (see [Manual QA and per-worktree instances](#manual-qa-and-per-worktree-instances-wp-env)); it will not start one for you.

```bash
npm run perf:boot-cost -- --label trunk --out /tmp/trunk.json
npm run perf:boot-cost -- --diff /tmp/trunk.json /tmp/branch.json
```

Defaults are the QA instance (`http://localhost:8890`, `admin` / `password`) and the shell boot document (`/wp-admin/`, which redirects into the portal). `--base` points at another port, `--path` at another document, so `--path '/wp-admin/edit.php?openstation_chromeless=1'` measures what a page opened inside a window costs. `--out` writes the per-asset detail that `--diff` consumes, and `--diff` prints the delta table plus the list of files that left or joined the document.

### Comparing two branches

Use **one** instance and switch the code under it. The mount serves the start directory live, so a branch switch is enough for PHP, and `assets/js/` is committed, so the bundles switch with it:

```bash
git switch trunk
npm run perf:boot-cost -- --label trunk --out /tmp/trunk.json
git switch my-branch
npm run perf:boot-cost -- --label my-branch --out /tmp/branch.json
npm run perf:boot-cost -- --diff /tmp/trunk.json /tmp/branch.json
```

Running two wp-env instances instead is the obvious alternative and it is a trap: each keeps its own database, so they disagree about active plugins, theme and content, and the gap between the two sites will swamp the gap between the two branches.

Four things that will bite you:

- **`SCRIPT_DEBUG` decides whether you are measuring production.** It is on by default in wp-env, which serves unminified core assets and unminified plugin bundles; numbers taken that way have the right shape but run roughly 3x the production figure. For a number destined for a PR description, `wp config set SCRIPT_DEBUG false --raw` inside the instance first and set it back afterwards. Turning it off also switches core to concatenated `load-scripts.php` bundles, so request counts change shape as well as size.
- **What else is active can change the answer completely.** `bin/setup-wp-env.sh` installs and activates Gutenberg on every fresh instance, and Gutenberg's Dashboard page (`build/pages/dashboard/page-wp-admin.php`) enqueues the entire editor package chain on the Dashboard screen, which is the screen the shell boots on. Work that defers part of that same chain measures as approximately zero on such an instance and as several megabytes without it. When a boot-cost change looks far smaller than expected, find out what else on the page enqueues the same handles before concluding the change did nothing.
- **Deferral moves cost, it does not delete it.** Do not open windows during a run. A deferral is supposed to make the boot document cheaper and the first open more expensive, so measure the two separately or the second effect hides the first.
- **Only compare like with like.** Absolute totals from a Gutenberg-active instance and a Gutenberg-inactive one are not comparable to each other. Only the trunk-versus-branch delta *within* one configuration means anything.

## Coding standards (PHPCS)

`phpcs.xml.dist` inherits the full `WordPress` standard. It scans **PHP only** — the `extensions` arg is load-bearing, because without it PHPCS applies its CSS and JS sniffs to `assets/`, walks ~70 minified bundles and exhausts a 1GB memory limit on any checkout where `npm run build` has run.

The ruleset separates two things that the standard reports identically:

- **Errors gate CI.** `npm run lint:php` runs `phpcs -n` and must exit clean. Anything that fails here is a defect or a deviation nobody has argued for yet.
- **Warnings are advisory.** `npm run lint:php:all` reports them and they show up in review, but they never fail a build. Each downgrade has its reasoning inline in `phpcs.xml.dist` — the short version:
  - **`WordPress.DB.DirectDatabaseQuery`.** The plugin owns eight custom tables (see the frozen-values section of `AGENTS.md`); `$wpdb` is the only way to reach them. The caching advice still matters for the aggregate stats under `includes/my-wordpress/`, which do read core tables, so the sniff reports rather than being excluded.
  - **`WordPress.DB.PreparedSQL.InterpolatedNotPrepared`.** Table names cannot be placeholders below WordPress 6.2, which introduced `%i`. The plugin supports 6.0, so custom-table queries interpolate `{$tables['…']}` and pass values through `prepare()`. Revisit if the minimum ever moves to 6.2.
  - **Docblock coverage.** 1186 of the 1248 functions under `includes/` carry one, so the standard matches the house style — the gap is a tail to close, not a convention to abandon. Holding CI red until it is closed would only teach everyone to ignore the job.

Before reaching for a `phpcs:ignore`, check that the finding is genuinely not a defect, and put the reason on the same line. Prefer a scoped `disable`/`enable` pair over a file-wide `disable`: the AJAX handlers in `includes/plugins-window/ajax.php` verify their nonce inside a shared guard function, which the sniff cannot follow, but the exemption is scoped to the `$_POST` reads so a handler that forgets the guard still trips.

`npm run lint:php:fix` runs PHPCBF. It is safe on formatting but it has one known rough edge: its `Squiz.PHP.EmbeddedPhp` fix splits multi-line inline comments inside templates and leaves the continuation lines misaligned. Skim the diff for comments before committing.

Extensions under `extensions/` are excluded here and scanned against their own rulesets — they ship as separate plugins with their own prefixes and text domains.

## Module layout

```
src/
├── public-api.ts            # Barrel: re-exports every plugin-author-facing
│                            #   type / enum / helper. New author-facing
│                            #   symbol? Add it here too.
├── desktop.ts               # Shell entry — boots the window manager,
│                            #   dock, widget layer, wallpaper layer, and
│                            #   exposes `window.wp.os`.
├── hooks.ts                 # @wordpress/hooks bridge + the typed HOOKS
│                            #   enum that names every event we fire.
├── types.ts                 # Window / session / config interfaces.
├── shared-store.ts          # Cross-bundle reactive state primitive
│                            #   (`wp.os.createSharedStore`).
├── tracked-fetch.ts         # Cross-bundle bridge to `wp.os.fetch`.
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
├── ui/components/           # The `<os-*>` kit. `entry.ts` + `loader.ts`
│                            #   also build it as a lazy bundle behind
│                            #   `wp.os.loadComponents()`, for plugins
│                            #   that can't import at build time.
├── commands/                # Command registration: server-sync, shell
│                            #   harvester, iframe bridge.
├── presence/                # Presence store (`wp.os.presence`).
├── pwa/                     # PWA: install, notify, service worker.
├── desktop-files/           # Files/folders on the wallpaper
│                            #   (`wp.os.files`).
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
├── settings/                # OpenStation Preferences panel: state, sections,
│                            #   media REST client.
├── ui/
│   ├── core/                # The tagged-template renderer + base
│   │                        #   Component class + css` helper.
│   └── components/          # <os-*> web components (one folder per
│                            #   tag, each with .ts / .styles.ts / .test.ts).
├── modules/                 # Vendor-script registry (PixiJS today,
│                            #   more later). Used by canvas wallpapers.
├── plugins/                 # Built-in plugins that use the public API —
│                            #   animated-logo-wallpaper is the reference
│                            #   example for third-party authors.
├── dock.ts                  # The left-edge dock (icons, tooltips,
│                            #   submenu popover, instance rail).
├── toast.ts                 # Toast queue (wraps <os-toast-container>).
├── utils.ts                 # urlMatchKey, deriveWindowId, sanitize*.
└── i18n.ts                  # Thin wrapper around window.wp.i18n.
```

The tree above is curated, not exhaustive — `src/` holds many more
single-purpose modules and feature directories (drag bridge, devtools,
pinned notes, …). Run `ls src/` for the full picture; the shipped
bundles (and the TS entry behind each) are the `build:*` scripts in
`package.json`, resolved via `OPENSTATION_TARGET` in `vite.config.js`.

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
- `src/settings/sections/*` — OpenStation Preferences internals.
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

1. **Name it.** Convention: `os.<domain>.<event>` (JS) or
   `openstation_<domain>_<event>` (PHP). Add the constant to the `HOOKS`
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

Everything on `window.wp.os` lives in the `OpenStationPublicApi`
interface in `src/desktop.ts`. To add a method:

1. Add the field to the interface with a JSDoc.
2. Wire it up inside the `window.wp.os = { … }` assignment.
3. Re-export whatever types it uses from `src/public-api.ts`.
4. Document it in `docs/javascript-reference.md`.

## Coding conventions

- **TS**: strict mode, tabs, `snake_case` for PHP / `camelCase` for JS.
  Prefer `const` over `let`. No `any`; use `unknown` + type-narrow.
- **CSS**: custom properties for theming. BEM-ish
  `.os-{component}__{element}--{modifier}`.
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
  populated bundles — `openstation` (the main shell),
  `os-posts-window`, and `desktop-mode-recycle-bin`; see
  `bin/build-i18n.sh` for the handle to source-prefix map.

### POT header fields

`Project-Id-Version` is derived by `make-pot` from the plugin header
in `desktop-mode.php` (Plugin Name plus Version). Nothing pins it in
the extraction script, and nothing should: pinning is how it goes
stale.

`Report-Msgid-Bugs-To` points translators at
`https://wordpress.org/support/plugin/desktop-mode`. That slug is the
published wp.org slug and is frozen, so it keeps reading
`desktop-mode` even though the plugin is now called OpenStation. See
AGENTS.md, "`desktop_mode_*` values are frozen".

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

## Docs → GitHub wiki

The repository's GitHub wiki is a **generated mirror of `docs/`** — never
edit it through the wiki UI; the next sync overwrites it. Doc changes go
through pull requests against `docs/` like any other change.

The pipeline is two pieces:

- `bin/build-wiki.mjs` flattens `docs/` into the wiki's flat page
  namespace: `docs/README.md` becomes `Home`, `docs/examples/README.md`
  becomes `Examples`, every example page gets an `example-` prefix (which
  is also what prevents basename collisions such as `desktop-host.md`
  existing in both directories), `docs/plans/` is excluded, and
  `docs/assets/` is copied verbatim. Relative `.md` links are rewritten to
  wiki page names (anchors preserved); links escaping `docs/` into the
  source tree become absolute GitHub `blob/trunk` URLs. It also generates
  the `_Sidebar.md` navigation and a `_Footer.md` provenance note.
  Unresolved relative links are printed as warnings — run
  `node bin/build-wiki.mjs /tmp/wiki-out` locally to preview a sync or
  check links.
- `.github/workflows/wiki.yml` runs the script on every push to `trunk`
  that touches `docs/**` (plus `workflow_dispatch` for manual runs) and
  pushes the output to `<repo>.wiki.git` — a wiki is itself a git
  repository — using the workflow's `GITHUB_TOKEN`. Deletes and renames
  propagate; the sync is authoritative.

One-time prerequisite: GitHub only creates the wiki repository when a
first page is saved through the UI. If the sync job fails with "Could not
clone", enable the wiki, save any page (its content will be replaced), and
re-run the workflow.

## Where things are tested

- **Vitest** — `tests/vitest/*.test.ts` + colocated
  `src/**/*.test.ts`. Runs in jsdom.
- **PHPUnit** — `tests/phpunit/tests/*.php`. Tagged `@group openstation`.
  Runs inside the dedicated wp-env tests instance (PHPUnit 9.6 +
  phpunit-polyfills). Configured in `.wp-env.tests.json` + `composer.json`.
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
