/**
 * Cross-bundle reactive state primitive.
 *
 * **The problem this solves.** The Desktop Mode build pipeline ships
 * each feature as an independent Vite IIFE bundle (the main shell,
 * the code editor, the recycle bin, third-party plugin bundles, …).
 * Each bundle is a closed module graph: if two bundles both
 * `import './state'`, they each get their own compiled copy of that
 * module's top-level state object. Mutations inside one bundle are
 * invisible to the other. Plugin authors who split their JS across
 * more than one bundle hit this every time and end up reinventing
 * the same `window.__myPluginShared` slot.
 *
 * **The fix this provides.** A typed reactive store keyed by a
 * caller-supplied string. The first call with a given key creates
 * the store, attaches it to `window` under a namespaced slot, and
 * returns it. Every subsequent call with the same key — including
 * from a different bundle — returns the SAME store. Mutations
 * propagate; subscribers from any bundle fire on any mutation.
 *
 * **The pattern.** Plain mutate-then-notify. No immutable-update
 * plumbing, no reducer enum, no dependencies. The store gives you
 * four things:
 *
 *   - `state` — the live mutable object. Mutate it directly.
 *   - `notify()` — call after mutating to wake subscribers.
 *   - `subscribe( cb )` — register a listener. Returns an
 *     unsubscribe function.
 *   - `reset()` — restore the initial state and clear listeners.
 *     Mainly for tests.
 *
 * @example
 * ```ts
 * import { createSharedStore } from 'desktop-mode/shared-store';
 *
 * interface MyState { counter: number; user: string | null }
 * const store = createSharedStore< MyState >( 'my-plugin/state', () => ( {
 *     counter: 0,
 *     user: null,
 * } ) );
 *
 * store.subscribe( ( s ) => console.log( 'counter is', s.counter ) );
 * store.state.counter += 1;
 * store.notify();
 * ```
 *
 * @since 0.5.5
 */

/**
 * Public API of a shared store. Generic over the state shape.
 */
export interface SharedStore< T > {
	/**
	 * Live mutable state. Mutate directly, then call {@link notify}
	 * so subscribers see the change. The runtime can't enforce
	 * read-only at the type level on the live object — `getState()`
	 * returns the same reference cast to `Readonly< T >` for
	 * authors who want the type-level safety, but mutating either
	 * shape ultimately mutates the same object.
	 */
	state: T;
	/**
	 * Read-only view of {@link state} for subscribers and other
	 * read-side code. Identical reference, narrower type.
	 */
	getState(): Readonly< T >;
	/**
	 * Wake every subscriber. Idempotent within a tick — no
	 * batching, no microtask deferral; calls run synchronously
	 * inline with whatever code triggered the mutation.
	 */
	notify(): void;
	/**
	 * Register a listener. Returns an unsubscribe function.
	 * Listeners are called with the live state — same reference
	 * each time, so `===` comparison won't work for change
	 * detection. Use specific field comparisons instead.
	 */
	subscribe( cb: ( state: Readonly< T > ) => void ): () => void;
	/**
	 * Patch + notify in one call. Sugar over the canonical
	 * `mutate-then-notify` flow:
	 *
	 *   ```ts
	 *   store.state.foo = 'bar';
	 *   store.state.baz = 1;
	 *   store.notify();
	 *   ```
	 *
	 * collapses to:
	 *
	 *   ```ts
	 *   store.setState( { foo: 'bar', baz: 1 } );
	 *   ```
	 *
	 * The classic shape (`state.* = …; notify()`) stays first-class —
	 * use it when you need conditional / multi-step updates. Use
	 * `setState` when you have a flat patch and don't want to
	 * forget the notify (the silent-no-op when you do is the most
	 * common DX cliff in this API).
	 *
	 * Only valid for object-shaped state. Primitive-shaped stores
	 * still use the `state` setter path.
	 *
	 * @since 0.18.0
	 *
	 * @param patch Partial state to merge into `state`.
	 */
	setState( patch: Partial< T > ): void;
	/**
	 * Reset the store to its initial state and clear every
	 * subscriber. Mainly for tests; production code rarely needs
	 * it. Calls the original `initialState` thunk again — handy
	 * for stores whose initial value derives from runtime config.
	 */
	reset(): void;
}

/**
 * Internal shape held in the window slot. Keyed by the caller's
 * string, so two plugins using the same key intentionally share —
 * but the namespacing convention (`'my-plugin/something'`) keeps
 * accidental collisions away.
 */
interface InternalRecord< T > {
	state: T;
	listeners: Set< ( state: Readonly< T > ) => void >;
	// Cached thunk so `reset()` can rebuild without the original
	// closure leaking back to the caller.
	rebuild: () => T;
}

/**
 * Window-level slot map. One namespace, many keys.
 */
const SHARED_STORES_SLOT = '__desktopModeSharedStores';

interface SharedStoresWindow {
	[ SHARED_STORES_SLOT ]?: Map< string, InternalRecord< unknown > >;
}

function resolveSlot(): Map< string, InternalRecord< unknown > > {
	const w = window as unknown as SharedStoresWindow;
	let slot = w[ SHARED_STORES_SLOT ];
	if ( ! slot ) {
		slot = new Map();
		w[ SHARED_STORES_SLOT ] = slot;
	}
	return slot;
}

/**
 * Create or retrieve a cross-bundle reactive store.
 *
 * The first call for a given `key` runs `initialState()` and
 * registers the resulting record on the window-level slot map.
 * Every subsequent call — INCLUDING from a different IIFE bundle —
 * returns the SAME record so all callers share one mutable state
 * + one set of subscribers.
 *
 * Type safety is opt-in: callers pass the generic type they want
 * the store typed as. The runtime stores it untyped and casts at
 * the boundary. When two bundles request the same key with
 * incompatible types, the FIRST bundle's shape wins — keep keys
 * namespaced and document the shape next to the call site.
 *
 * @param key          Globally-unique store id. Recommend
 *                     `'<plugin>/<purpose>'` format
 *                     (e.g. `'my-plugin/state'`).
 * @param initialState Thunk that returns the initial state. Only
 *                     called once per key; subsequent calls with
 *                     the same key reuse the existing instance.
 *                     Thunked (not a value) so heavy initial
 *                     state isn't built when the store already
 *                     exists.
 * @return The shared store handle.
 */
export function createSharedStore< T >(
	key: string,
	initialState: () => T,
): SharedStore< T > {
	const slot = resolveSlot();
	let record = slot.get( key ) as InternalRecord< T > | undefined;
	if ( ! record ) {
		record = {
			state: initialState(),
			listeners: new Set(),
			rebuild: initialState,
		};
		slot.set( key, record as InternalRecord< unknown > );
	}

	const handle: SharedStore< T > = {
		// `record.state` is the live reference. The getter on the
		// `state` field reads the latest value even if `reset()`
		// reassigned it to a fresh object.
		get state() {
			return record!.state;
		},
		set state( next: T ) {
			record!.state = next;
		},
		getState(): Readonly< T > {
			return record!.state as Readonly< T >;
		},
		notify(): void {
			// Iterate a snapshot so a subscriber that unsubscribes
			// itself (or another listener) mid-iteration doesn't
			// skip pending callbacks.
			for ( const cb of Array.from( record!.listeners ) ) {
				try {
					cb( record!.state as Readonly< T > );
				} catch ( err ) {
					// One bad listener shouldn't strand the rest.
					// eslint-disable-next-line no-console
					console.error(
						`[desktop-mode/shared-store:${ key }] subscriber threw:`,
						err,
					);
				}
			}
		},
		subscribe( cb ): () => void {
			record!.listeners.add( cb );
			return () => {
				record!.listeners.delete( cb );
			};
		},
		setState( patch: Partial< T > ): void {
			const cur = record!.state;
			if ( typeof cur !== 'object' || cur === null ) {
				// Primitive state — `setState` doesn't apply.
				// eslint-disable-next-line no-console
				console.warn(
					`[desktop-mode/shared-store:${ key }] setState called on a primitive store; use the state setter instead.`,
				);
				return;
			}
			Object.assign( cur as Record< string, unknown >, patch );
			handle.notify();
		},
		reset(): void {
			const fresh = record!.rebuild();
			// For OBJECT state, clear-and-copy to preserve the
			// outer object's identity. Plugin code routinely
			// captures `store.state` into a local at module load
			// (`const s = store.state; s.foo = bar; notify()`),
			// and we'd quietly break those captures if `reset()`
			// reassigned the slot to a fresh object — the local
			// would then be a dangling reference to the old
			// snapshot. Iterating + deleting + Object.assign keeps
			// the same outer object alive while restoring its
			// fields.
			//
			// For PRIMITIVE state (number, string, boolean), the
			// reassign path is the only option since primitives
			// can't be mutated in place.
			const cur = record!.state;
			if (
				typeof cur === 'object' && cur !== null &&
				typeof fresh === 'object' && fresh !== null
			) {
				const target = cur as Record< string, unknown >;
				for ( const k of Object.keys( target ) ) {
					delete target[ k ];
				}
				Object.assign( target, fresh as object );
			} else {
				record!.state = fresh;
			}
			record!.listeners.clear();
		},
	};
	return handle;
}

/**
 * Test-only escape hatch: reset EVERY shared store on this
 * window to its initial state and drop subscribers.
 *
 * Critically: does NOT delete the slot map — that would orphan
 * any `SharedStore` handle that the system-under-test created
 * during module load (those handles capture the record by
 * closure). Instead we reset each record in place so existing
 * handles see fresh state on their next `getState()` /
 * `state.foo` read.
 *
 * Vitest setups should call this in `beforeEach` / `afterEach`
 * to keep tests independent.
 *
 * @internal
 */
export function _resetAllSharedStoresForTests(): void {
	const w = window as unknown as SharedStoresWindow;
	const slot = w[ SHARED_STORES_SLOT ];
	if ( ! slot ) {
		return;
	}
	for ( const record of slot.values() ) {
		const fresh = record.rebuild();
		const cur = record.state;
		if (
			typeof cur === 'object' && cur !== null &&
			typeof fresh === 'object' && fresh !== null
		) {
			const target = cur as Record< string, unknown >;
			for ( const k of Object.keys( target ) ) {
				delete target[ k ];
			}
			Object.assign( target, fresh as object );
		} else {
			record.state = fresh;
		}
		record.listeners.clear();
	}
}
