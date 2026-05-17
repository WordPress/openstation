/**
 * My WordPress — early-load API stub.
 *
 * Imported by `src/desktop.ts` so it lands in the main `desktop.min.js`
 * bundle that's always loaded. Installs a queueing stub on
 * `window.wp.desktop.myWordpress` so plugin scripts can call
 * `registerEntityKind(...)` at script-load time, before the lazy
 * `my-wordpress.min.js` bundle has mounted.
 *
 * When the lazy bundle initializes it drains
 * `window.wp.desktop.myWordpress.__pendingKinds` and replaces this
 * stub with the real API.
 *
 * @public
 * @since 0.21.0
 */

export interface PendingKindRegistration {
	kind: string;
	renderer: ( ...args: unknown[] ) => void;
}

interface MyWordpressEarlyStub {
	/**
	 * Stub registerEntityKind — buffers the call. Returns a stub
	 * unregister that's a no-op (the real unregister isn't available
	 * yet; if a plugin needs to unregister before mount it can mutate
	 * `__pendingKinds` directly).
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
 * `window.wp.desktop` namespace via casts to side-step the strict
 * `WpDesktopPublicApi` global type — the early stub installs BEFORE
 * the full public API is wired, so a partial shape is expected here.
 *
 * @public
 * @since 0.21.0
 */
export function installMyWordpressEarlyStub(): void {
	type Loose = {
		wp?: { desktop?: Record< string, unknown > & {
			myWordpress?: MyWordpressEarlyStub;
		} };
	};
	const w = window as unknown as Loose;
	w.wp = w.wp ?? {};
	const wp = w.wp;
	if ( ! wp.desktop ) {
		wp.desktop = {};
	}
	const desktop = wp.desktop;
	if ( desktop.myWordpress ) {
		return;
	}
	const queue: PendingKindRegistration[] = [];
	const stub: MyWordpressEarlyStub = {
		registerEntityKind: ( kind, renderer ) => {
			queue.push( { kind, renderer } );
			return () => {
				const i = queue.findIndex(
					( e ) => e.kind === kind && e.renderer === renderer,
				);
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
