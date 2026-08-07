/**
 * My WordPress — early-load API stub.
 *
 * Imported by `src/desktop.ts` so it lands in the main `desktop.min.js`
 * bundle that's always loaded. Installs a queueing stub on
 * `window.wp.os.myWordpress` so plugin scripts can call
 * `registerEntityKind(...)` at script-load time, before the lazy
 * `my-wordpress.min.js` bundle has mounted.
 *
 * When the lazy bundle initializes it drains
 * `window.wp.os.myWordpress.__pendingKinds` and replaces this
 * stub with the real API.
 *
 * @public
 */

/**
 * Per-call mutable slot the stub closes over. Until the lazy bundle
 * mounts, `unregister` is `null` and the stub-returned unregister
 * splices from `__pendingKinds`. After drain, the lazy bundle fills
 * `unregister` with the real registry closure, and any cached
 * stub-unregister forwards through it.
 */
export interface PendingKindSlot {
	unregister: ( () => void ) | null;
}

export interface PendingKindRegistration {
	kind: string;
	renderer: ( ...args: unknown[] ) => void;
	slot: PendingKindSlot;
}

interface MyWordpressEarlyStub {
	/**
	 * Stub registerEntityKind — buffers the call. Returns an
	 * unregister that splices the buffered entry out of
	 * `__pendingKinds` before drain, and forwards to the real
	 * registry closure after drain (see `PendingKindSlot`).
	 */
	registerEntityKind: (
		kind: string,
		renderer: ( ...args: unknown[] ) => void,
	) => () => void;
	/** Drained by the lazy bundle on mount. */
	__pendingKinds?: PendingKindRegistration[];
	/** Any other methods (openDetail, openMedia, …) get attached later. */
	[ key: string ]: unknown;
}

/**
 * Idempotent — safe to call from every bundle entry. Only the first
 * call installs the stub. Reads/writes the loosely-typed
 * `window.wp.os` namespace via casts to side-step the strict
 * `OpenStationPublicApi` global type — the early stub installs BEFORE
 * the full public API is wired, so a partial shape is expected here.
 *
 * @public
 */
export function installMyWordpressEarlyStub(): void {
	type Loose = {
		wp?: { os?: Record< string, unknown > & {
			myWordpress?: MyWordpressEarlyStub;
		} };
	};
	const w = window as unknown as Loose;
	w.wp = w.wp ?? {};
	const wp = w.wp;
	if ( ! wp.os ) {
		wp.os = {};
	}
	const desktop = wp.os;
	if ( desktop.myWordpress ) {
		return;
	}
	const queue: PendingKindRegistration[] = [];
	const stub: MyWordpressEarlyStub = {
		registerEntityKind: ( kind, renderer ) => {
			const slot: PendingKindSlot = { unregister: null };
			const entry: PendingKindRegistration = { kind, renderer, slot };
			queue.push( entry );
			return () => {
				// After drain — forward to the real registry closure.
				if ( slot.unregister ) {
					slot.unregister();
					slot.unregister = null;
					return;
				}
				// Before drain — pull the entry out of the queue so
				// the lazy bundle never sees it.
				const i = queue.indexOf( entry );
				if ( i !== -1 ) {
					queue.splice( i, 1 );
				}
			};
		},
		__pendingKinds: queue,
	};
	desktop.myWordpress = stub;
}

installMyWordpressEarlyStub();
