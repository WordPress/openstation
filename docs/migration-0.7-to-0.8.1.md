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
| 6 | PHP slicing — split `helpers.php`, `render.php`, `components.php`; centralize REST routes | 🚧 in progress (helpers.php split done — 1,609 → 153 LOC; render/components/REST pending) |
| 7 | Window-system rename + heavy-window decomposition | 🚧 planned |
| 8 | Layout SSOT, `WpdBase`, extension base, types package | 🚧 planned |
| 9 | Documentation lockstep | 🚧 planned |
| 10 | Cutover, tag `v0.8.1` | 🚧 planned |

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
