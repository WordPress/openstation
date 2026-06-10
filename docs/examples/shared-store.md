# Share state across multi-bundle plugins — `wp.desktop.createSharedStore()`

**Stable** — shipped 0.5.5.

If your plugin ships **more than one JS bundle** (e.g. an always-on
shell + a lazy-loaded UI bundle, or two unrelated features that
share a settings cache), each bundle compiles its own copy of every
imported source file. A `state` object defined at module scope in
one bundle is invisible to the other bundle — same source, different
runtime objects. Mutations don't propagate. Subscribers don't fire.
The chat window opens on the placeholder. The badge stays at zero.

`wp.desktop.createSharedStore()` is the framework primitive that
solves this. One `window`-level slot, keyed by your string;
mutate-then-notify; subscribers from any bundle fire on any
mutation.

## The bug it prevents

A typical multi-bundle plugin: an always-on `shell.js` bundle owns
the inbound delivery / heartbeat plumbing; a lazy `window.js` bundle
renders the UI when the user opens the window.

- `shell.js` calls `setFocusedItem(X)` and mutates
  `state.focusedItemId`.
- `window.js` reads `state.focusedItemId` to decide what to render.
- Each bundle has its own compiled copy of `state.ts`. The shell's
  mutation is invisible to the window's render callback. The
  window opens on the placeholder.

Plugin authors who tried to roll their own dedupe (`window.__myShared
= window.__myShared || ...`) hit subtle issues: stranded subscribers
after one bundle throws, stale captures after a test reset, no
type story, no consistent slot naming.

## The fix

```ts
const store = wp.desktop.createSharedStore< MyState >(
    'my-plugin/state',                     // any unique string
    () => ( {                              // thunk: runs once per key
        selectedId: null,
        items: [],
    } ),
);

// Subscribe — returns an unsubscribe.
const off = store.subscribe( ( s ) => {
    console.log( 'state changed:', s.selectedId, s.items.length );
} );

// Mutate then notify.
store.state.selectedId = 7;
store.state.items.push( newItem );
store.notify();

// Read-only snapshot (same reference, just narrower type).
const current = store.getState();

// Stop listening.
off();
```

The same key from any bundle — including a future bundle that
doesn't exist yet — returns the same store. The thunked
`initialState` only runs the first time the key is seen.

## End-to-end: shell bundle + UI bundle sharing

`src/my-plugin/state.ts` (imported by both bundles):

```ts
import type { SharedStore } from 'desktop-mode';

interface MyState {
    selectedId: number | null;
    items: { id: number; label: string }[];
}

const store: SharedStore< MyState > = wp.desktop.createSharedStore(
    'my-plugin/state',
    () => ( {
        selectedId: null,
        items: [],
    } ),
);

export function getState() { return store.getState(); }
export function subscribe( cb ) { return store.subscribe( cb ); }
export function selectItem( id: number | null ) {
    store.state.selectedId = id;
    store.notify();
}
export function setItems( items: MyState[ 'items' ] ) {
    store.state.items = items;
    store.notify();
}
```

`src/my-plugin/shell-entry.ts` (always-on bundle):

```ts
import { setItems, selectItem } from './state';

// Hydrate from REST on boot — runs once per page load.
wp.desktop.fetch( '/wp-json/my-plugin/v1/items', undefined, { source: 'my-plugin/items' } )
    .then( ( r ) => r.json() )
    .then( ( items ) => setItems( items ) );

// React to a global keyboard shortcut by mutating shared state.
document.addEventListener( 'keydown', ( e ) => {
    if ( e.key === 'Escape' ) {
        selectItem( null );
    }
} );
```

`src/my-plugin/window.ts` (lazy chat-window bundle):

```ts
import { getState, subscribe } from './state';

export function mount( body: HTMLElement ): () => void {
    function repaint(): void {
        const s = getState();
        body.querySelector( '.title' )!.textContent =
            s.selectedId !== null ? `Item #${ s.selectedId }` : 'Nothing selected';
    }
    repaint();
    return subscribe( repaint );
}
```

The shell's `selectItem(null)` mutates the same store the window's
`subscribe` is listening on, so the title repaints — even though
the two files were compiled into separate IIFE bundles.

## When you DON'T need this

If your plugin ships **a single JS bundle**, plain module-level
state works fine. Don't reach for the primitive just because it
exists. The cost of the dedupe lookup is microscopic but the
abstraction overhead — keys, thunks, `notify()` calls — earns its
keep only when you have multiple bundles.

## API surface

```typescript
interface SharedStore< T > {
    state: T;                                                // mutable
    getState(): Readonly< T >;                               // same ref, narrower type
    notify(): void;                                          // wake subscribers
    subscribe( cb: ( s: Readonly< T > ) => void ): () => void;
    setState( patch: Partial< T > ): void;                   // patch + notify in one call
                                                             // (since 0.8.1; object-shaped
                                                             // state only)
    reset(): void;                                           // tests only — preserves
                                                             // outer object identity
                                                             // for object state
}

wp.desktop.createSharedStore< T >(
    key:          string,
    initialState: () => T,
): SharedStore< T >;
```

`setState()` collapses the mutate-then-notify pair into one call
for flat patches; on a primitive-shaped store it warns and no-ops —
use the `state` setter there instead.

## Conventions

- **Namespace your key:** `'<plugin>/<purpose>'` keeps two unrelated
  plugins from colliding.
- **Document the shape near the call site:** the runtime is
  type-erased; the FIRST bundle to call wins on shape if two bundles
  pass incompatible types.
- **Don't call `reset()` in production:** it tears state down for
  every consumer of the key, not just yours. It's there for tests.
- **One key per store:** if you find yourself wanting two stores
  with related shapes, consider whether they should be one store
  with two top-level fields.

## Related

- [`docs/javascript-reference.md#createSharedStore`](../javascript-reference.md#createsharedstore-key-initialstate--stable-since-055) — full API doc.
