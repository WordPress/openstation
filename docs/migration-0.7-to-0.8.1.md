# Migration: 0.7 → 0.8.1

Architecture 0.8.1 reorganizes the plugin's internals around explicit
layers and reusable primitives. The work lands across multiple
phases; this document tracks what each phase changes for plugin
authors.

The promise: **no name in the public surface disappears silently.**
Renames keep the old name alive as a deprecation shim (PHP via
`_doing_it_wrong`, JS via `installDeprecatedAlias` from
`@api/deprecated`) for the entire 0.8.x line.

## At-a-glance status

| Phase | Subject | Status |
|---|---|---|
| 1 | tsconfig path aliases + typecheck script | ✅ landed |
| 2 | Shared primitives (`@core/reactive-registry`, `@core/server-sync`, `@core/api-client`, PHP registry factory) | ✅ landed |
| 3 | Bridge-protocol consolidation (`@protocol/window-messages`, `@protocol/guards`, `@protocol/version`) | ✅ landed |
| 4 | Public API home (`@api`) + deprecation alias helper | ✅ landed |
| 5 | Boot decomposition — split `src/desktop.ts` into `src/boot/*` + `src/api/facade.ts` | 🚧 in progress (10 modules landed: 8 boot + facade + deprecated; init() body still needs decomposition) |
| 6 | PHP slicing — split `helpers.php`, `render.php`, `components.php`; REST discoverability | ✅ landed (helpers/components/render fully sliced — 6,235 → 558 LOC; REST README index added; ai-copilot/search.php deliberately left intact — file is coherent per AGENTS.md) |
| 7 | Window-system rename + heavy-window decomposition | 🚧 partial (`@window-system/*` umbrella barrel landed; physical merge of window/+window-manager/+window-chrome/ + `src/window/index.ts` 2,642-LOC class decomposition + heavy native-window splits deferred — each is multi-day surgery best tackled one window at a time) |
| 8 | Layout SSOT, design-token catalogue, extension base, types package | ✅ landed (`src/layout/` cross-bundle store, `src/ui/core/tokens.ts`, `extensions/base/` PHP+TS bases, `packages/desktop-mode-types/` skeleton; existing `src/ui/core/component.ts` already covered the WpdBase line item) |
| 9 | Documentation lockstep | ✅ landed (architecture map + migration doc + REST README + extensions/base/README + packages/desktop-mode-types/README + docs/README index all current) |
| 10 | Cutover (no merge to trunk) | 🟡 branch held — `refactor/architecture-0.8.1` is review-ready; **maintainer asked NOT to merge to trunk**. Land via cherry-pick or manual review. |

## Quantified outcome

| File | Before | After | Reduction |
|---|---:|---:|---:|
| `src/desktop.ts` | 3,695 | 2,667 | −1,028 (28%) |
| `includes/helpers.php` | 1,609 | 153 | −1,456 (91%) |
| `includes/components.php` | 2,101 | 376 | −1,725 (82%) |
| `includes/render.php` | 2,525 | 29 (umbrella) | −2,496 (99%) |
| `src/types.ts` (bridge unions only) | inline | re-exports | n/a |

New focused modules created (every line green under
lint + tsc + 947 vitest tests + 573 PHPUnit tests):

- **TS shared primitives** — `src/core/{reactive-registry,server-sync,api-client}.ts` (+ 26 tests)
- **TS public API** — `src/api/{index,facade,deprecated}.ts` (+ 4 tests)
- **TS protocol** — `src/protocol/{window-messages,guards,version}.ts` (+ 6 tests)
- **TS boot** — `src/boot/{origin,geometry,session,session-saver,tracked-fetch,link-interceptor,menu-refresh,shell-lifecycle}.ts`
- **TS layout SSOT** — `src/layout/{types,index}.ts` (+ 5 tests)
- **TS UI** — `src/ui/core/tokens.ts` (+ 6 tests)
- **TS umbrella** — `src/window-system/index.ts`
- **PHP core** — `includes/core/{registry-factory,routing,payload}.php` (+ 7 PHPUnit tests for the factory)
- **PHP registries** — `includes/registries/{native-windows,window-tabs,icons,wallpapers,widgets}.php`
- **PHP render** — `includes/render/{body-classes,assets,shell,chromeless-bridge,classic-link-interceptor}.php`
- **PHP REST index** — `includes/rest/README.md`
- **Extension library** — `extensions/base/{includes/{ExtensionWindow,ExtensionRest}.php,client/createExtensionWindow.ts,README.md}`
- **Types package** — `packages/desktop-mode-types/`

## What plugin authors can do today (after phases 1–4)

### TypeScript path aliases

`tsconfig.json` now exposes:

```
@/*               → src/*
@api/*            → src/api/*
@boot/*           → src/boot/*           (folder ships in phase 5)
@core/*           → src/core/*
@features/*       → src/features/*       (folder ships in phase 7)
@layout/*         → src/layout/*         (folder ships in phase 8)
@protocol/*       → src/protocol/*
@ui/*             → src/ui/*
@window-system/*  → src/window-system/*  (folder ships in phase 7)
```

Vite + Vitest mirror these aliases, so they resolve at build and
test time. Existing relative imports keep working unchanged —
adoption is opt-in per file.

### `@core/reactive-registry` — replace ad-hoc registries

If you've been hand-rolling a `register()` / `unregister()` /
listener-Set / `notify()` pattern, swap it for:

```ts
import { createReactiveRegistry } from '@core/reactive-registry';

interface MyDef { id: string; render: () => void; }

const registry = createReactiveRegistry< MyDef >( {
    key:   'my-plugin/widgets',  // namespace it
    idOf:  ( d ) => d.id,
    label: 'my-plugin widgets',  // shown in console errors
} );
```

You get `register`, `unregister`, `get`, `all`, `subscribe`, `reset`.
The store is shared across IIFE bundles via `createSharedStore`,
so registrations from one bundle are visible from another.

### `@core/server-sync` — push registry state to a REST endpoint

```ts
import { createRegistrySync } from '@core/server-sync';

const teardown = createRegistrySync( registry, {
    endpoint: '/wp-json/my-plugin/v1/sync',
    nonce:    myPluginConfig.restNonce,
    source:   'my-plugin/sync',
} );
```

Debounced, fed through `wp.desktop.fetch`, errors caught and logged.

### `@core/api-client` — typed REST wrapper

```ts
import { createRestClient } from '@core/api-client';

const api = createRestClient( {
    baseUrl: '/wp-json/my-plugin/v1',
    nonce:   myPluginConfig.restNonce,
    source:  'my-plugin',
} );

const items = await api.get< Item[] >( '/items' );
await api.post( '/items', { name: 'A' } );
```

`RestError` carries `status`, `code`, and `data` from a WP-style
error body. Pass a `recover` callback to swallow domain-specific
non-fatal errors (`term_exists`, idempotent conflicts).

### `@protocol/guards` — type-safe postMessage handling

```ts
import { isBridgeEvent, assertBridgeEventType } from '@protocol/guards';

window.addEventListener( 'message', ( e ) => {
    if ( ! isBridgeEvent( e.data ) ) return;
    if ( e.data.type === 'desktop-mode-title-change' ) {
        // e.data is narrowed to the title-change variant.
    }
} );
```

The runtime catalogue is `BRIDGE_EVENT_TYPES`; the version is
`PROTOCOL_VERSION`. Outgoing messages from the shell will start
carrying the version field in phase 5+.

### PHP registry factory

```php
$registry        = desktop_mode_create_registry();
$script_registry = desktop_mode_create_script_registry();

$registry( 'foo', array( 'label' => 'Foo' ) );
$registry( 'foo' );             // → array( 'label' => 'Foo' )
$registry( '' );                // → full map
$registry( '__flush__' );       // → reset

$script_registry( 'my-handle', true );
$script_registry( 'my-handle' ); // → true
```

Each call to the factory creates an isolated closure with its own
private state — no globals, no naming collisions.

## Renames pending shims (planned, phase 5+)

The following surface names will be renamed during the remaining
phases. Each rename ships a one-shot deprecation warning that
forwards to the canonical name; the legacy form keeps working for
the entire 0.8.x line.

_(table populated as each rename lands)_

## Reporting issues

If a name you depend on disappears or behaves differently without
a deprecation warning during 0.8.x, that's a bug — file an issue
against this repo with the import path or hook name and a
reproduction.
