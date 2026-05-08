# Architecture refactor — 0.8.1

> Branch: `refactor/architecture-1.0` (commits reference 0.8.1 throughout — branch name is historical).
> **Do not merge to trunk.** Land via cherry-pick or manual review per maintainer instruction.

## Summary

Reorganises the plugin's internals around explicit layers and reusable primitives. Four god-modules were sliced into focused single-responsibility files, the public API moved into a single facade, the postMessage protocol got a typed catalogue + guards, and plugin authors gained `@core` / `@api` / `@protocol` / `@layout` / `@ui` / `@window-system` path aliases backed by reusable building blocks.

Behaviour is unchanged. Function names, hook names, filter contracts, and `wp.desktop.*` keys are identical. **947 vitest tests + 573 PHPUnit tests + 0 lint errors at HEAD.**

## Why

The plugin had grown to ~50k LOC across PHP and TypeScript and was showing the strain:

- **God modules.** `src/desktop.ts` (3,695), `includes/render.php` (2,525), `includes/components.php` (2,101), `includes/helpers.php` (1,609). Each mixed 4+ unrelated concerns; touching one to change one thing forced reading hundreds of lines of unrelated code.
- **Pattern duplication.** ~15 PHP registry pairs (`*_script_registry` + `*_registry`) with copy-pasted bodies. ~22 TS server-sync modules with identical "subscribe → POST" choreography. ≥4 hand-rolled REST fetch wrappers. Three separate listener-Set primitives.
- **DX gaps for plugin authors.** No `tsconfig` path aliases — `../../../../` imports everywhere. `wp.desktop.*` was assembled inline by 50+ scattered `Object.assign` calls in `desktop.ts`. postMessage shapes were defined inline in each consumer. No npm-publishable types package — third-party TS plugins got zero IDE help.

## What changed

### TypeScript shared primitives

- **`src/core/reactive-registry.ts`** — `createReactiveRegistry< T >()` factory backed by `createSharedStore`. Replaces the ~22 ad-hoc `register / unregister / Set< listener > / notify` implementations across wallpapers, settings tabs, dock-rail renderers, window themes, commands, palettes, etc.
- **`src/core/server-sync.ts`** — `createRegistrySync()` wires a registry to a REST endpoint with debounce + tracked-fetch + activity-bus tagging. One canonical pattern instead of 22 copies.
- **`src/core/api-client.ts`** — `createRestClient()` base for the four feature REST clients (`posts-window`, `my-wordpress`, `recycle-bin`, `desktop-files`); `RestError` normalises WP-style failures and `recover` handles `term_exists`-style domain recoveries.

### Public API home

- **`src/api/facade.ts`** — `buildPublicApi(deps)` + `installPublicApi(api)`. The ~280-LOC `wp.desktop.*` literal that used to be inline in `init()` is now one grep-target.
- **`src/api/deprecated.ts`** — `installDeprecatedAlias()` for any rename: forwards silently after a one-shot `console.warn` pointing at the new name.
- **`src/api/index.ts`** — barrel re-exporting `src/public-api.ts`.

### Bridge protocol

- **`src/protocol/window-messages.ts`** — `BridgeEventFromIframe` / `BridgeEventToIframe` unions, the `BRIDGE_EVENT_TYPES` runtime catalogue. Pulled out of the 1,860-LOC `types.ts` grab-bag.
- **`src/protocol/guards.ts`** — `isBridgeEvent`, `isBridgeEventFromIframe`, `isBridgeEventToIframe`, `assertBridgeEventType`. Replaces ~20 inline `data?.type === 'desktop-mode-*'` string checks.
- **`src/protocol/version.ts`** — `PROTOCOL_VERSION = '0.8.1'`.

### Boot decomposition

`src/desktop.ts` 3,695 → 2,667 LOC. Eight focused boot modules under `src/boot/`:

```
src/boot/origin.ts            INITIAL_ORIGIN snapshot
src/boot/geometry.ts          clampGeometryToViewport, findDockEntryForUrl
src/boot/session.ts           restoreSession, openCurrentPage
src/boot/session-saver.ts     createSessionSaver (debounced + sendBeacon)
src/boot/tracked-fetch.ts     wp.desktop.fetch implementation
src/boot/link-interceptor.ts  bindTopWindowLinkInterceptor
src/boot/menu-refresh.ts      bindMenuRefresh (live plugins-changed pipeline)
src/boot/shell-lifecycle.ts   bindShellLifecycle, wireSessionEvents
```

### PHP slicing

`includes/helpers.php` **1,609 → 153** LOC. `includes/components.php` **2,101 → 376** LOC. `includes/render.php` **2,525 → 29** (umbrella loader).

```
includes/core/
  registry-factory.php   desktop_mode_create_registry() + create_script_registry()
  routing.php            chromeless / classic detection + redirect preservation
                         + url-is-same-admin + admin-target allowlist
  payload.php            dock builder + menu/native-window/script payload assembly

includes/registries/
  native-windows.php     register_window + native_window_registry + template html
  window-tabs.php        register_window_tab + tabs registry
  icons.php              register_icon + desktop_icon_registry
  wallpapers.php         register_wallpaper + wallpaper_registry + asset enqueue
  widgets.php            register_widget + widget_registry + asset enqueue

includes/render/
  body-classes.php       admin_body_class filter
  assets.php             desktop_mode_enqueue_assets
  shell.php              desktop_mode_render_shell
  chromeless-bridge.php  offset-neutralizer + chromeless bridge script
  classic-link-interceptor.php

includes/rest/
  README.md              REST route → handler-file map (discoverability index)
```

### Cross-bundle layout SSOT, design tokens, extension base, types package

- **`src/layout/`** — `getCurrentLayout` / `subscribeLayout` shared store, published by the shell on every OS Settings change. Feature bundles + third-party plugins read it without threading the snapshot through.
- **`src/ui/core/tokens.ts`** — `readToken` / `setToken` / `isWpdToken` typed wrappers around the ~190 `--wpd-*` CSS custom properties already exposed across the 45 web components.
- **`src/window-system/index.ts`** — umbrella barrel re-exporting `window/`, `window-manager/`, `window-chrome/`. New code uses `@window-system/*`; legacy paths still resolve.
- **`extensions/base/`** — abstract PHP `Desktop_Mode_Extension_Window` + `Desktop_Mode_Extension_Rest` bases plus the `createExtensionWindow< Config >` TS helper. ~250 LOC of per-extension boilerplate becomes ~30 LOC of subclass declarations.
- **`packages/desktop-mode-types/`** — npm-publishable TypeScript types package re-exporting `src/public-api.ts`. Third-party plugins get IDE autocomplete on `wp.desktop.*`.

### Tooling

- **`tsconfig.json`** — `baseUrl` + `paths` for `@/*`, `@core/*`, `@api/*`, `@protocol/*`, `@boot/*`, `@layout/*`, `@features/*`, `@ui/*`, `@window-system/*`. Mirrored in `vite.config.js` + `vitest.config.ts` so both build and test resolve them.
- **`package.json`** — new `npm run typecheck` (`tsc --noEmit`).

## Headline numbers

| File | Before | After | Reduction |
|---|---:|---:|---:|
| `src/desktop.ts` | 3,695 | 2,667 | −1,028 (28%) |
| `includes/helpers.php` | 1,609 | 153 | −1,456 (91%) |
| `includes/components.php` | 2,101 | 376 | −1,725 (82%) |
| `includes/render.php` | 2,525 | 29 (umbrella) | −2,496 (99%) |

47 new vitest tests across the new TS primitives + protocol + facade + layout + tokens. 7 new PHPUnit tests for the registry factory.

## Migration for plugin authors

Everything is **additive**: existing imports, hook names, filter contracts, and `wp.desktop.*` keys keep working unchanged. Adopt the new modules opt-in.

```ts
// Replace ad-hoc registries
import { createReactiveRegistry } from '@core/reactive-registry';
const widgets = createReactiveRegistry< MyWidgetDef >( {
    key:  'my-plugin/widgets',
    idOf: ( d ) => d.id,
} );

// Replace hand-rolled REST clients
import { createRestClient } from '@core/api-client';
const api = createRestClient( {
    baseUrl: '/wp-json/my-plugin/v1',
    nonce:   myConfig.restNonce,
    source:  'my-plugin',
} );
const items = await api.get< Item[] >( '/items' );

// Replace inline postMessage type checks
import { isBridgeEvent } from '@protocol/guards';
window.addEventListener( 'message', ( e ) => {
    if ( ! isBridgeEvent( e.data ) ) return;
    if ( e.data.type === 'desktop-mode-title-change' ) {
        // e.data is narrowed to the title-change variant
    }
} );

// Read the active layout from any bundle
import { getCurrentLayout, subscribeLayout } from '@layout';

// Server-side: replace static-store registry boilerplate
$registry = desktop_mode_create_registry();
$registry( 'foo', array( 'label' => 'Foo' ) );
$registry( 'foo' );          // array( 'label' => 'Foo' )
$registry( '__flush__' );    // reset
```

## Backwards compatibility

- Every existing `wp.desktop.*` method, every `desktop_mode_*` PHP hook, every CustomEvent on `document` is preserved at the same name and signature.
- `src/types.ts` re-exports the bridge-event unions from `@protocol/window-messages` so existing imports keep resolving.
- `includes/render.php` is now a 29-LOC umbrella that `require_once`s the five sliced files — anything that did `require_once 'includes/render.php'` continues to work.
- `desktop-mode.php` orders the new `core/`, `registries/`, and `render/` requires before any consumer so PHP's runtime function resolution finds every name from any caller.

## Test plan

Validated at every commit boundary:

- [x] `npm run lint` — 0 errors
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npx vitest run` — **947 tests / 108 files**
- [x] `npm run build` — all 6 Vite bundles build clean
- [x] `find includes extensions -name '*.php' | xargs -n1 php -l` — clean
- [x] `vendor/bin/phpunit` (run inside `wordpress-alcazaba-php-1`) — **573 tests / 1,300 assertions**
- [x] Smoke-tested by maintainer mid-refactor on the running dev container

## Out of scope / deferred

Tackled separately because each is multi-day surgery best done one piece at a time:

- `src/desktop.ts` `init()` body decomposition (~2,200 LOC closure).
- `src/window/index.ts` (2,642-LOC class) → `window/{window,renderer,messenger,geometry,event-bus}.ts`.
- Heavy native-window splits (`posts-window/index.ts` 2,579, `my-wordpress/index.ts` 3,868, `recycle-bin/index.ts` 1,038) into `model.ts` / `ui.ts` / `commands.ts`.
- Physical merge of `window/` + `window-manager/` + `window-chrome/` into a single directory (the `@window-system/*` barrel makes this a one-import-line-at-a-time consumer migration).
- Migrating the three in-tree extensions onto `extensions/base/` (the bases are additive; existing extensions keep their hand-rolled boilerplate).
- Publishing `@desktop-mode/types` to npm.
- Splitting `includes/ai-copilot/search.php` (2,208 LOC) — left intact deliberately; the file is coherent per AGENTS.md.
- Centralising every `register_rest_route()` call into `includes/rest/*.php` — the README index is the discoverability win; the per-module registrations stay where they are because the callbacks capture per-module state.

## Reviewer notes

- 27 commits, each individually green. Cherry-pickable in order.
- Phases overlap by intent — phase 5d (facade extraction) lands inside the boot decomposition because the facade IS what the boot exposes.
- The `refactor/architecture-1.0` branch name is historical; every `@since` tag, every `PROTOCOL_VERSION`, and every doc reference inside the commits says `0.8.1`.

## Reporting issues

If a name you depended on changed signature without a deprecation warning during 0.8.x, that's a bug. Open an issue with the import path or hook name and a reproduction.
