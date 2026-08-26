/**
 * My WordPress — early-load API stub.
 *
 * Imported by `src/desktop.ts` so it lands in the main `desktop.min.js`
 * bundle that's always loaded. `my-wordpress.min.js` is a third of a
 * megabyte and loads the first time the WP Explorer window opens, so
 * for most of a session `wp.os.myWordpress` has to exist without it.
 * This stub is that stand-in, and it covers the surface two ways:
 *
 *   - `registerEntityKind()` **queues**. It's synchronous by
 *     contract (it returns an unregister), and plugin scripts call
 *     it at script-load time. The lazy bundle drains
 *     `window.wp.os.myWordpress.__pendingKinds` on init.
 *   - Everything else **forwards**: load the bundle, then re-read
 *     `wp.os.myWordpress` (the bundle replaces this stub with the
 *     real API on init) and call through. Those methods either
 *     already returned a Promise or returned nothing, so awaiting a
 *     load first is invisible to callers.
 *
 * @public
 */

/** Window id of the WP Explorer native window the bundle backs. */
const WINDOW_ID = 'desktop-mode-my-wordpress';

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
	/**
	 * Route the window into a post/page detail view. Forwarding
	 * stub — see the module header.
	 */
	openDetail: ( args: unknown ) => void;
	/** Route the window into a media drill-in. Forwarding stub. */
	openMedia: ( args: unknown ) => void;
	/** Route the window into a user's activity footprint. Forwarding stub. */
	openUserFootprint: ( args: unknown ) => void;
	/** Trash an entity by id. Forwarding stub; resolves like the real one. */
	trashEntity: ( entityId: string, id: number ) => Promise< void >;
	/** Any method the lazy bundle adds later. */
	[ key: string ]: unknown;
}

/** The shape of `wp.os` this module reaches for. */
interface LooseDesktopApi {
	loadWindowScript?: ( id: string ) => Promise< boolean >;
	myWordpress?: MyWordpressEarlyStub;
	[ key: string ]: unknown;
}

function desktopApi(): LooseDesktopApi | undefined {
	return ( window as unknown as { wp?: { os?: LooseDesktopApi } } ).wp?.os;
}

/**
 * Load `my-wordpress.min.js` and hand back whatever
 * `wp.os.myWordpress` is once it settles — the real API on success,
 * this stub if the load failed or the shell is too early to have
 * wired `loadWindowScript` yet.
 *
 * Reading the global AFTER the await rather than closing over it is
 * the whole trick: the bundle's init overwrites the property, so a
 * captured reference would forward back into the stub forever.
 */
async function resolveApi(): Promise< MyWordpressEarlyStub | undefined > {
	const desktop = desktopApi();
	if ( typeof desktop?.loadWindowScript === 'function' ) {
		await desktop.loadWindowScript( WINDOW_ID );
	}
	return desktopApi()?.myWordpress;
}

/**
 * Build a forwarding stub for a method the lazy bundle owns.
 *
 * The identity guard is the important part: if the bundle failed to
 * load, `wp.os.myWordpress` is still this stub, and calling through
 * would recurse until the stack ran out. A missed call is the
 * correct failure here — the load error already went out through
 * `SHELL_ERROR`.
 */
function forward< A extends unknown[] >(
	name: string,
	self: () => MyWordpressEarlyStub,
): ( ...args: A ) => Promise< void > {
	return async ( ...args: A ): Promise< void > => {
		const api = await resolveApi();
		if ( ! api || api === self() ) {
			return;
		}
		const fn = api[ name ];
		if ( typeof fn !== 'function' ) {
			return;
		}
		await ( fn as ( ...a: A ) => unknown )( ...args );
	};
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
	// `self` is read lazily so `forward()` can compare the resolved
	// API against this exact object — see the recursion note there.
	const self = (): MyWordpressEarlyStub => stub;
	const stub: MyWordpressEarlyStub = {
		openDetail: forward( 'openDetail', self ),
		openMedia: forward( 'openMedia', self ),
		openUserFootprint: forward( 'openUserFootprint', self ),
		trashEntity: forward< [ string, number ] >( 'trashEntity', self ),
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
