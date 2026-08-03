# OpenStation — agent + contributor guide

The imperative rules for working in this repo, plus the contributor-only gotchas that aren't obvious from reading the code. Public APIs and their contracts live in `docs/`; this file is the rulebook and cheatsheet for working *inside* the codebase.

## Contents

- [Hard rules](#hard-rules)
  - [Never hand-edit JS in `assets/js/`](#never-hand-edit-js-in-assetsjs)
  - [The palette lives in `variables.css`](#the-palette-lives-in-variablescss--one-declaration-one-owner)
  - [Never declare a themeable token on a component's `:host`](#never-declare-a-themeable-token-on-a-components-host)
  - [The Legacy theme manifest is frozen data](#the-legacy-theme-manifest-is-frozen-data-not-build-output)
  - [Use `wp.os.fetch` (or `trackedFetch`), never raw `fetch()`](#use-wposfetch-or-trackedfetch-never-raw-fetch)
  - [Use `wp.os.confirm` (or `osConfirm`), never `window.confirm`/`alert`/`prompt`](#use-wposconfirm-or-osconfirm-never-windowconfirmalertprompt)
  - [Use `os-*` components, not raw HTML controls](#use-os--components-not-raw-html-controls)
  - [No version-history annotations in docs or comments](#no-version-history-annotations-in-docs-or-comments)
- [Workflow](#workflow)
  - [Always run `npm run build` after all the changes](#always-run-npm-run-build-after-all-the-changes)
  - [Always branch + PR, never commit to trunk](#always-branch--pr-never-commit-to-trunk)
  - [Use `bin/sync-to-wp-develop.sh` for local sync, not raw rsync](#use-binsync-to-wp-developsh-for-local-sync-not-raw-rsync)
  - [Don't regenerate POT/PO/JSON in feature PRs](#dont-regenerate-potpojson-in-feature-prs)
- [Process reminders](#process-reminders)
- [Contributor gotchas](#contributor-gotchas)
  - [Live-refresh on plugin install/activate — how it actually works](#live-refresh-on-plugin-installactivate--how-it-actually-works)
  - [Event-driven framework](#event-driven-framework)
  - [Presence — framework-level](#presence--framework-level)
  - [Cross-bundle state — `wp.os.createSharedStore`](#cross-bundle-state--wposcreatesharedstore)
  - [Chromeless admin-bar suppression](#chromeless-admin-bar-suppression)
  - [Running PHPUnit](#running-phpunit)
- [Developer docs — read before, update after](#developer-docs--read-before-update-after)

---

## Hard rules

### Never hand-edit JS in `assets/js/`

**`assets/js/*.js` is build output. Treat it as if it were `dist/`.**

Every built JS bundle has a TypeScript source under `src/`. The active build targets (and their TS entries) are listed in `package.json` under the `build:*` scripts; `npm run build` runs them all. The actual entry file for each target is in `vite.config.js`, selected by the `OPEN_STATION_TARGET` env var.

Two hand-written files are the exception and stay tracked in git: `assets/js/admin-bar.js` and `assets/js/media-library-enhanced.js` (see the re-includes in `.gitignore`) — edit those directly; everything else under `assets/js/` is build output.

Process for any JS change:

1. Edit only TS files under `src/` (and CSS under `assets/css/` if styling, that's not built).
2. Run `npm run build` (or the per-target script).
3. Run `npm run lint` (or `lint:fix`), must pass on EVERYTHING you touched.
4. Run `npm run test:js`, must stay green.
5. Run `npm run typecheck`, must stay green.

If you ever find yourself reaching for `assets/js/*.js` directly, stop and write the TS instead. Hand-edited JS is overwritten by the next `npm run build` and produces no TS-checked types, a silent class of bug.

**Lint scope:** `npm run lint` runs on `src/**/*.ts` only. Test files under `tests/vitest/` aren't in the lint config (typescript-eslint project doesn't include them); rely on `npm run typecheck` + `npm run test:js` to catch issues there.

### The palette lives in `variables.css` — one declaration, one owner

The shell wears the [OpenStation brand](https://nuriapenya.github.io/open-station-brand/), and it wears it as **token declarations in `assets/css/variables.css` and nowhere else**. Void as the base, Obsidian for surfaces, Pulse and Nebula for identity moments, Sirius and Starlight for contrast, the Shade ramp for text hierarchy and lines.

**The palette is scoped to `body.os-active`, never `:root`.** `variables.css` is a dependency of `chromeless.css`, so it also loads inside every iframe window — a real `wp-admin` document. On `:root` the palette would repaint WordPress's own UI in there, and `--wp-admin-theme-color` alone would move Core's primary buttons, links and focus rings across every admin screen. Iframe documents carry `os-chromeless`, match nothing, and render on the fallback literals. **An admin page in a window looks exactly as it does outside one — that is a promise, and `tests/vitest/brand-palette.test.ts` holds you to it.**

Three rules follow from that, and all have tests:

1. **Restyling means changing a token's value in `variables.css`**, not adding a rule in a feature stylesheet. A colour declared next to the thing it paints is out of reach of the palette *and* of every desktop theme — including Legacy, the way back to the pre-brand look.
2. **Every consuming rule keeps reading `var( --token, <literal> )`**, and that literal stays the pre-brand WordPress-admin value. It is the floor if the stylesheet fails to load, and it is what the Legacy snapshot collected. Never "tidy" a fallback away.

**The failure mode to watch for after a palette change** is a chain that now means something else: a fill resolving to a 10%-alpha wash, or a base and its hover state — declared in two different rules, distinguished only by their fallback literals — collapsing onto the same value once the shared token is declared. `<os-button>`'s ghost/secondary hover did exactly that. When a surface stops reacting to the pointer, check whether both states resolve through the same palette token, and declare the second one.

### Never declare a themeable token on a component's `:host`

**In a `<os-*>` component, a default belongs in a `var()` fallback, never in a `--os-ui-*` declaration on the bare `:host` block.**

A custom property declared on `:host` matches the host *element*, and a declaration matching the element always beats a value that element would otherwise *inherit*. The palette declares on `body.os-active`; a desktop theme declares on `body.os-desktop-theme-<slug>`. Both are ancestors. So this:

```css
:host { --os-ui-table-bg: var( --os-ui-surface, #fff ); }
```

does not read as "default to the surface colour". It reads as *"`--os-ui-table-bg` can never be set from outside this element again"* — the theme's declaration of that name is dead, and so is the palette's. `<os-table>`, `<os-modal>`, `<os-progress-bar>` and `<os-spinner>` between them pinned 22 names this way; every one is in the Legacy snapshot and none of them reached its component.

Read the public token **into a private alias** instead:

```css
:host { --_bg: var( --os-ui-table-bg, var( --os-ui-surface, #fff ) ); }
/* …then every use site reads var( --_bg ). */
```

With no declaration on the host to find, the `var()` resolves the inherited value — theme first, palette next, the pre-brand literal last. `<os-rating-summary>` is the reference implementation.

Two things this does **not** apply to:

- **State modifiers** (`:host( [ compact ] )`, `:host( [ tone='danger' ] )`, `:host( [ preset='inline' ] )`) keep declaring the *public* token. The alias reads it off the host, so the state still overrides the default, and a document-tree rule still outranks the state the way it always did.
- **A component that deliberately opts out of a palette value** — `<os-modal>`'s dialog surface is dark whatever the admin colour scheme says, so following `--os-ui-fg` would put near-black text on a near-black dialog. It still re-points `--os-ui-fg` on `:host`, but through `--os-ui-modal-text`, a name the palette owns. Opting out of the *value* is fine; opting out of *reachability* is not.

`tests/vitest/component-token-reachability.test.ts` is the guard, with the opt-outs named in one allowlist.

### The Legacy theme manifest is frozen data, not build output

`assets/desktop-themes/legacy/theme.json` is a **frozen snapshot**: the built-in [Legacy desktop theme](docs/desktop-themes.md#the-legacy-theme--start-here), every design token at the value it resolved to before the brand. It was collected from the stylesheets once, by hand, and it is a plain data file from here on.

**Changing a default does NOT mean updating Legacy.** Someone wearing it asked for the old look and is entitled to keep it; a manifest that tracked the code would silently turn the theme back into a no-op every release. Nothing generates it — not the build, not CI, not a script — and nothing should. There is deliberately no tool that can rewrite it.

`Tests_OpenStation_DesktopThemesLegacy` is the guard: it pins the token count and a set of canonical values, and fails if any value stops satisfying the manifest's value grammar — otherwise a silent drop, since a rejected token just falls back to the built-in look. If you find yourself editing the JSON, that test failing is the question "is this really what Legacy should say forever?" being asked out loud.

### Use `wp.os.fetch` (or `trackedFetch`), never raw `fetch()`

**Every HTTP call from the shell must route through the framework helper** so the request feeds the active window's loading spinner + the activity bus. Two equivalent entry points:

- **In-bundle** (any `src/**/*.ts` that ends up in any built bundle): `import { trackedFetch } from '<…>/tracked-fetch'`. The helper finds `wp.os.fetch` at runtime.
- **Plugin-side / external scripts**: `await window.wp.os.fetch( url, init, { source: 'my-plugin/foo' } )`.

Shape:

```ts
trackedFetch(
    input: RequestInfo,
    init?: RequestInit,
    opts?: { windowId?: string; source?: string; silent?: boolean },
): Promise< Response >;
```

Pass `windowId` to attribute the request to a specific native window (so its spinner shows). Pass `source` as a free-form tag (`'desktop-mode/files'`, `'desktop-mode/recycle-bin'`) for the activity bus + debug widgets. Pass `silent: true` for genuinely background pings the user didn't initiate (session save, badge polling).

ESLint enforces this — raw `fetch( … )` and `window.fetch( … )` calls fail lint with the message pointing at this helper. The only legitimate exceptions are documented inline with `// eslint-disable-next-line no-restricted-syntax -- <reason>`:

- The `trackedFetch` wrapper itself (the boot-time fallback before `wp.os` exists).
- The PWA service worker (`src/pwa/sw.ts` — different context, no `wp.os` global).
- Genuinely silent background pollers where attribution would mis-render as user activity (`src/devtools/index.ts`, `src/recycle-bin/badge.ts`).

### Use `wp.os.confirm` (or `osConfirm`), never `window.confirm`/`alert`/`prompt`

The framework ships a `<os-confirm-dialog>` component and a Promise-returning wrapper:

```ts
import { osConfirm } from '<…>/ui/components/os-confirm-dialog/os-confirm-dialog';

if ( await osConfirm( {
    title: 'Delete forever?',
    message: 'Cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
} ) ) {
    // …
}
```

External bundles call `window.wp.os.confirm(...)` (same shape). ESLint rejects `window.confirm`, `window.alert`, `window.prompt` — see the rule message for the suggested replacement (a toast, a `<os-confirm-dialog>`, or a custom modal built with `<os-text-field>`).

### Use `os-*` components, not raw HTML controls

**Default to the `<os-*>` web component for any UI element that has one.** They live in `src/ui/components/<name>/` and are tag-listed in `src/ui/components/index.ts`, that file is the index of what already exists. Pick from there before reaching for raw `<button>`, `<input>`, `<select>`, dialogs, menus, toasts, etc. The components carry the framework's keyboard-nav, focus-management, theming-token, and accessibility plumbing for free; raw HTML doesn't.

Concrete checklist when adding UI:

1. Look at `src/ui/components/index.ts`. If the component you need is there, use it.
2. If it isn't but the shape is generic (a kind of dialog, picker, menu, status indicator that any future feature could reuse), **build it as a new `<os-*>` component**, folder under `src/ui/components/<name>/` with `<name>.ts` (Web Component class), `<name>.styles.ts` (shadow-DOM CSS), and `<name>.test.ts`. Register it in `src/ui/components/index.ts`. Document it via the `static help` block on the class (universal convention across the kit).
3. Only fall back to bespoke DOM construction when the surface is feature-specific (a tile renderer that knows about placement metadata, a menu-flyout positioning rig).

The `<os-context-menu>` / `<os-context-menu-option>` and `<os-confirm-dialog>` pair are good examples, they replaced ~200 LOC of duplicated DOM construction across the wallpaper menu, the tile context menu, the create-folder dialog, and the recycle-bin/posts-window confirm prompts.

### No version-history annotations in docs or comments

**Document functionality, never when that functionality was added or changed.** No `@since X.Y.Z` docblock tags, no `Stable *(0.8.3)*` status stamps, no "(since 0.8.4)" / "as of 0.9.1" / "added in 0.8.0" / "fixed in 0.8.5" asides — in PHP, TS, or Markdown. Status labels stay (`Stable`, `Experimental`, `Beta`, `Planned`, `@deprecated`), but bare, with no version attached. Git history is the changelog; the docs and docblocks describe what the current release does.

The two deliberate exceptions:

- `docs/migration-*.md` — migration notes are version-anchored by design; they (and index entries pointing at them) keep their version references.
- Named refactors that a migration doc defines (e.g. "architecture-0.8.1") may be referenced by that name in file headers.

If a change is big enough that "when did this change?" matters to plugin authors, that's a breaking change: write a `docs/migration-*.md` note instead of an inline version stamp.

---

## Workflow

### Always run `npm run build` after all the changes

Uniform workflow across the repo. Once you're done with a batch of edits (don't bother running it between individual changes), run `npm run build` even if the batch was PHP-only, the build is a cheap correctness gate (it touches Vite + the vendor copy step) and keeps `assets/js/` in sync with `src/`. If you don't, the next person to run `npm run build` will see spurious diffs.

### Always branch + PR, never commit to trunk

Even small chores (typos, doc tweaks, one-line fixes) go on a feature branch. Open a PR for every change. Wait for the user's green light before running `gh pr create`; once given, run it yourself.

### Use `bin/sync-to-wp-develop.sh` for local sync, not raw rsync

The script is the single source of truth for the include list and runs `npm run build` first. Only fall back to raw `rsync` for files that are genuinely outside the script's scope (and then question why they're outside it).

### Don't regenerate POT/PO/JSON in feature PRs

i18n re-extraction is a batched pre-translation step, not a per-PR chore. Don't run `npm run build:i18n` as part of a feature branch unless the PR is specifically a translation refresh; the noise dilutes the diff and creates churn with other in-flight branches.

---

## Process reminders

- **Read before speculating.** When asked how a mechanism works (refresh flow, hook order, bridge protocol), grep the code first. Hand-waving gets caught.
- **Don't implement architectural changes unilaterally.** PHP API additions, payload shape changes, and new registry-sync modules are all load-bearing for plugin authors. Propose, get the green light, then code.
- **Let the user test before committing.** Sync to local dev, wait for verification, then commit. Avoid the eager-push trail of partial fixes.
- **Plugin Check** runs in CI as the `plugin-check` job (runs `wp plugin check` inside its own wp-env — a dedicated `.wp-env.plugin-check.json` generated in `ci.yml` that mounts the built zip — with `--ignore-warnings` plus an `--ignore-codes` baseline; the `wordpress/plugin-check-action@v1` path was dropped because its zip source hangs `wp-env start` on GitHub runners, see the comment in `ci.yml`). For local runs: `npm run env:start` then `npm run check:plugin`. Don't add it to a pre-commit hook, it needs a live WP/WP-CLI and is too slow per-commit.

---

## Contributor gotchas

### Live-refresh on plugin install/activate — how it actually works

When the user installs or activates a plugin, the **chromeless bridge** inside the `plugins.php` iframe postMessages `os-plugins-changed` to the parent shell with a **payload captured in real admin context** (plugins that gate `admin_menu` on `is_admin()` at load time register correctly there; a REST roundtrip from the shell cannot replicate that, so don't try).

Payload shape (`open_station_build_menu_payload()` in `includes/core/payload.php` builds it, `includes/render/chromeless-bridge.php` emits it, `src/menu-refresh-apply.ts` owns the consumer contract — `createApplyPayload()` there returns the `applyPayload` function that `src/boot/menu-refresh.ts` wires up):

```
{ dockItems, nativeWindows, serverWidgets, serverWallpapers,
  serverCommandScripts, serverCommands,
  serverSettingsTabScripts, serverSettingsTabs,
  serverDockRailRendererScripts, serverTitleBarButtonScripts,
  serverUnfocusEffectScripts, serverWindowLinkRendererScripts,
  serverWindowThemeScripts, serverWindowThemes,
  serverWindowControlScripts, serverWindowControls,
  serverWindowSlotScripts, serverWindowSlots,
  serverWindowChromeScripts, serverWindowChromes,
  serverWindowNotices, serverGames, serverDesktopThemes,
  desktopIcons, updateCounts }
```

- **PHP-declared** things are in the payload: dock, native windows, widgets, wallpapers. The shell diffs them and fires `registry.subscribe` listeners → UI repaints. No F5.
- For widgets and wallpapers, the pattern is: PHP payload carries metadata + `scriptUrl`; the `server-sync` module (`src/{widgets,wallpapers}/server-sync.ts`) dynamically loads the plugin's JS, which then publishes a full def on a global (`window.openStationWallpapers[id]` / `window.openStationWidgets[id]`). The sync reads the def and registers it.
- **Commands** use the same pattern via `open_station_register_command_script( $handle )` (primary, minimum-ceremony) or `open_station_register_command( $args )` (optional, declares metadata server-side). Sync module: `src/commands/server-sync.ts`. Live unregistration on deactivation works for commands that either (a) declare `script` in PHP metadata, or (b) set `owner` on their JS `registerCommand` call. Plugins that do neither still require F5 on deactivate, graceful backwards-compat.
- **OS Settings tabs** use the same pattern via `open_station_register_settings_tab_script( $handle )` (primary) or `open_station_register_settings_tab( $args )` (optional, id/label/capability/order/script). Sync module: `src/settings/server-sync.ts`; registry: `src/settings/registry.ts`; built-in tabs (appearance=10, themes=12, apps-icons=22, features=25, effects=27, help=40; help is admin-only and labelled "Components" in the UI, About is pinned last via `order: Number.MAX_SAFE_INTEGER`, and Features hosts the admin-only Extended options section) are interleaved with the registry in `src/settings/panel.ts` `renderOsSettingsPanel()` (lazy-loaded by the `renderPanel()` stub in `src/settings/index.ts`) and re-painted live via `subscribeSettingsTabs`. Same (a)/(b) live-unregister rules as commands.
- **AI Copilot extensibility** lives on a different axis from the live-refresh payloads, it's all per-request wiring inside `/ai/search` (`includes/ai-copilot/search.php`) plus the WordPress Abilities API. Two distinct registration surfaces. **Server-dispatched tools are abilities** (`includes/ai-copilot/abilities.php`): register with `wp_register_ability()` on `wp_abilities_api_init`, under the `openstation` category registered on `wp_abilities_api_categories_init`. The loop offers the model every registered ability whose `meta.annotations.readonly` is set and runs the chosen one through `wp_get_ability()->execute()`, which is where `permission_callback` and input-schema validation happen. There's no Desktop-Mode-specific opt-in: register a read-only ability (yours, Core's, another plugin's) and the assistant can call it. Read-only is a **security boundary, not an oversight**: a search turn can be driven by attacker-controlled content (comment or post text landing in a tool result), so the model is never handed an ability that could change the site. Model-facing tool names are the ability name minus its namespace with dashes as underscores (`desktop-mode/search-posts` → `search_posts`, see `open_station_ai_ability_tool_name()`), which keeps the system prompt, answer schema, and progress labels stable across the migration. The second surface is client-side `registerCommand({ aiCallable: true })` for JS-dispatched slash-commands the AI can pick via `/ai/search`'s `command_tools` param. The full filter/action surface is `open_station_ai_{system_prompt,system_prompt_appendix,system_prompt_replace_capability,request,tools,command_tools,command_allowed,tool_result,answer}` + observability actions `open_station_ai_{search_started,tool_called,search_completed,search_error}`, every call carries a shared `request_id` UUID for trace correlation. `open_station_register_ai_tool()` and the `open_station_ai_tool_registered` action were removed in 0.9.4, see `docs/migration-ai-connectors.md`. `wp.os.ai.ask()` (`src/ai/ask.ts`) is the client-side programmatic entry point; it harvests `aiCallable: true` commands into `command_tools` and handles the server's `answer_type: 'tool_call'` short-circuit by running `run()` locally. The command's `run` function always lives JS-side, the server only emits a slug+args intent; the client invokes.
- **Games** (`open_station_register_game( $id, $args )`) use the metadata + `scriptUrl` pattern with one deliberate deviation: `src/games/server-sync.ts` registers metadata-only **stubs** on sync (no script load — the metadata is enough for the Games launcher grid + scoreboard tabs) and `launchGame()` in `src/games/launch.ts` fetches the script on first play, reading the full def off `window.openStationGames[id]`. Games are heavyweight (game bundle + PixiJS + a dictionary asset); eager loading would tax every boot for nothing.
- **Desktop themes** (`open_station_register_desktop_theme()`, plus admin-uploaded ZIPs) ship metadata + a compiled stylesheet reference and carry **no script at all**, which makes `src/desktop-themes/server-sync.ts` the one synchronous reconciler in the family. Losing the ACTIVE theme from the payload deactivates it locally without saving — the server already treats an orphaned selection as the system default on every request.
- **Palettes** (`registerPalette`) are the remaining JS-registered-only gap. No server-side opt-in yet; a new plugin's palette won't appear until F5. Same fix shape as commands if/when needed: `open_station_register_palette_script( $handle )` + payload key + clone the sync module.

**When fixing this kind of "why doesn't X update live?" gap**, match the existing pattern: add server-side registration API (`open_station_register_*`), extend the payload with a `server*` array including `scriptUrl`, add a `src/*/server-sync.ts` module modeled on the wallpaper one, wire it into `createApplyPayload()` in `src/menu-refresh-apply.ts`. Don't invent a different mechanism.

### Event-driven framework

The framework is a **transport + state provider**, not a UX policy maker. Apps subscribe to OS events, query window state synchronously, decide for themselves what to do. The framework MUST NOT auto-render based on heuristics it can't generalize across all apps. We learned this when the Dock briefly auto-suppressed badges while their window was focused, convenient for an unread-counter pattern, wrong for any plugin whose badge meant something else (deploy failures, queued items, etc.).

Three layers:

1. **State queries.** `windowManager.getById/isActive`, `presence.getStatus`, `createSharedStore`.
2. **Window lifecycle events.** Document CustomEvents (`os-window-*`) AND hook actions (`HOOKS.WINDOW_*`) for every transition: opened, reopened, focused, blurred, minimized, restored, maximized, unmaximized, fullscreen-entered/exited, closing, closed. Per-window facade: `wp.os.onWindow(id, handlers)`.
3. **Activity channels.** `wp.os.activity.publish/subscribe/filter` with channel naming `<plugin>/<event>`, peer-to-peer state-change broadcasts on the hook bus.

When you're tempted to add a heuristic inside the framework, "do X automatically when Y", stop and turn it into a hook the app can subscribe to. App owns the policy.

Canonical example in-tree: `src/recycle-bin/badge.ts`. Full doc: `docs/event-driven-framework.md`.

### Presence — framework-level

Presence tracking (`online | inactive | offline`) lives in `includes/presence.php` and `src/presence/index.ts`. Any plugin can read `wp.os.presence.*` or `open_station_presence_*()` without depending on a particular feature plugin being installed (chat, collaboration, …).

Storage: `_desktop_mode_presence` option (autoload=false). The WordPress Heartbeat handler in `includes/presence.php` records bumps at priority 5; the framework client (`src/presence/index.ts`) sends `open_station_presence_active: true` + `open_station_user_active: <bool>` on every tick and ingests the snapshot from the response.

Public surface, see `docs/javascript-reference.md` (`wp.os.presence`), `docs/hooks-reference.md` (filters / actions), and `docs/examples/presence.md` (recipe). Plugins with a faster delivery channel (an SSE stream, a WebSocket) can push updates straight into the framework store via `wp.os.presence.applyBatch()`.

### Cross-bundle state — `wp.os.createSharedStore`

Each OpenStation feature compiles to its own Vite IIFE bundle (one per `build:*` script in `package.json`, plus any third-party plugin bundles). Module-level state (a top-level `const state = ...` or `class Foo { …singleton… }`) defined in one bundle is **invisible** to another bundle even when both `import './state'` from the same source, each bundle has its own compiled copy. Mutations don't propagate; subscribers don't fire.

**This was the bug that ate days of debugging on a multi-bundle feature.** Symptom: an always-on shell bundle called a setter that mutated module-level state; a lazy window-bundle read the same state, found the initial value, and rendered the placeholder, because the two bundles each had their own copy of the state module. The fix that's now standard:

```ts
import { createSharedStore } from '../shared-store';

const store = createSharedStore< MyState >( 'my-plugin/state', () => initial() );
// `store.state` is identical across every bundle that calls
// createSharedStore with the same key.
```

The primitive is also exposed on the public API as `wp.os.createSharedStore`. See [`docs/javascript-reference.md`](docs/javascript-reference.md) and [`docs/examples/shared-store.md`](docs/examples/shared-store.md).

**When you ARE writing module-level state in a feature with multiple bundles, route it through `createSharedStore`.** This is non-negotiable.

**Before importing from one bundle's entry into another bundle's tree**, double-check that you aren't dragging in heavy code as a side-effect. Pulling a single symbol from a bundle entry that side-effect-imports the whole feature (poller, SSE, leader, heartbeat, …) inflates the consumer bundle. Pull the symbol from the leaf module that defines it instead.

### Chromeless admin-bar suppression

`is_admin_bar_showing()` short-circuits to `true` in admin context, the `show_admin_bar` filter alone is NOT sufficient inside chromeless iframes. We pair it with `remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 )` on `admin_init`, AND a CSS rule killing the reserved 32px. Do not remove either half.

### Running PHPUnit

`npm run test:php` runs the suite inside a **dedicated wp-env instance** defined by `.wp-env.tests.json` (wp-env's `--config` flag; the `test:php*` scripts pass it for you). The QA instance (`.wp-env.json`, port **8890**) and the tests instance (port **8891**) are two independent stacks; `testsEnvironment: false` in both configs disables wp-env's deprecated built-in dual-environment mode. Ports are remapped from wp-env's defaults so both coexist with the user's Core-checkout dev environment on 8889. CI uses the same scripts.

```bash
npm run env:start:tests   # idempotent; brings the PHPUnit wp-env instance up if needed
npm run test:php          # full suite
npm run test:php -- --filter='Tests_OpenStation_Render'   # one class
```

`npm run env:start` is for the manual-QA instance only; it no longer brings up test containers.

History: an earlier port collision against `wordpress-develop-wordpress-develop-1` (8889) made starting wp-env destructive. The remapped ports remove that hazard, wp-env and the Core checkout can both be up at the same time.

---

## Developer docs — read before, update after

`docs/` is the public contract with third-party plugin authors. Two rules, no exceptions:

1. **Before any task that touches a documented surface, read the relevant doc first.** It's the ground truth for what plugins depend on, reading it tells you whether a change is a bug fix, a backwards-compatible extension, or a breaking change that needs a different approach.
2. **Update the relevant doc in the same change.** A hook change without a doc update ships a lie. A new example code path without an example entry is invisible to the people who need it.

### Doc map

The full index lives in [`docs/README.md`](docs/README.md). Quick reference:

| Path | Read before / update when |
|---|---|
| `docs/README.md` | Top-level index + status legend. |
| `docs/getting-started.md` | The minimum-viable plugin skeleton or bootstrap hook names change. |
| `docs/architecture.md` | A new rendering path, persistence layer, REST route, or payload shape lands; build tooling shifts. |
| `docs/api-index.md` | Any public API surface changes (PHP, JS, or events). |
| `docs/hooks-reference.md` | Any `apply_filters()` / `do_action()` change: add, rename, remove, signature, default, or status. **The PHP hook contract.** |
| `docs/javascript-reference.md` | Any CustomEvent shape, postMessage bridge message, `wp.os.*` method/property, user meta key, or query flag changes. **The JS contract.** |
| `docs/bridge-protocol.md` | The postMessage bridge protocol, lifecycle steps, or internal sniff points change. |
| `docs/native-windows-proposal.md` | The native-window API, tab system, or framework integration story changes. |
| `docs/event-driven-framework.md` | The event-bus model, activity channels, or window lifecycle events change. |
| `docs/pwa.md` | Caching policy, manifest emission, SW scope/registration, or `wp.os.notify` / `pwa.*` surface changes. |
| `docs/plugin-compat-layer.md` | A chromeless-CSS shim, offset neutralizer, or dock-builder adaptation for a third-party plugin shape is added/changed. |
| `docs/dock-customization.md` | Dock rendering, ordering, or decoration hooks change. |
| `docs/desktop-themes.md` | The desktop-theme manifest format, icon/texture slot lists, value grammar, or fallback semantics change. **Slot names must stay equal on both sides** (`open_station_desktop_theme_icon_slots()` ↔ `src/desktop-themes/slots.ts`). |
| `docs/mio.md` | Mio's simulation, appearance/physics config keys, layer stacking, or `wp.os.mio` surface changes. **The four soft-body failure modes documented there (no core particle; edge-normal pressure; one rest shape shared by every spring family; angular-order constraint against folding) are load-bearing — read before touching `src/mio/soft-body.ts`.** |
| `docs/files-on-desktop.md` | Desktop file/folder behavior, tile metadata, or placement changes. |
| `docs/folder-sharing.md` | Folder-sharing API, ACL model, or REST routes change. |
| `docs/migration-*.md` | A breaking change ships, write a migration note here in the same PR. |
| `docs/DEVELOPMENT.md` | Local-dev setup, build, or test workflow changes. |
| `docs/RELEASE.md` | The release process changes. |
| `docs/examples/*.md` | The hook, API, or component the example uses changes. **One example per surface.** |
| `docs/examples/README.md` | A new example is added or an existing one is renamed. |

**Rules of thumb:**

- If an example stops working because the hook it uses changed, update the example in the same PR. Never leave a broken example.
- A documented "Stable" signature changing in a backwards-incompatible way is a breaking change, surface it to the user before shipping.
- If a change spans a surface that doesn't yet have an example (new public API), add one under `docs/examples/` and index it in `examples/README.md`.
- If a change adds a whole new surface with no doc yet, ask whether it deserves its own `docs/*.md` or fits as an example. Default to an example unless the surface has meaningful architectural weight.
