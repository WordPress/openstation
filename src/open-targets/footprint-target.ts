/**
 * My WordPress — cross-bundle "open this user's activity footprint"
 * target.
 *
 * Footprints render inside the WP Explorer APP, whose client bundle
 * is a lazy companion of its window. The click that requests one
 * originates elsewhere — the profile sidebar, an agent card, and most
 * notably the chromeless `users.php` iframe, whose row-action click
 * is routed through the window-system bundle's `handleWindowMessage`.
 *
 * Flow:
 *   1. A caller (parent shell handler, plugin code) invokes
 *      `openUserFootprintWindow( { userId, userName } )`.
 *   2. That calls `wp.os.openWindow( 'my-wordpress', { params } )`
 *      with the person as OPEN-TIME PARAMS (`footprint`, `fpName`).
 *      On a cold open the app's `mount` derives the footprint state
 *      from them on the server, so the first paint IS the footprint —
 *      never the folder grid for a beat and a second request after.
 *      On a live window the shell fires the `reopen` lifecycle and
 *      the app retargets. Params ride the session, so a reload brings
 *      the window back on the same person.
 *   3. The person is ALSO stashed in the shared store below, the
 *      contract that predates params: a plugin that stashes and
 *      opens by hand still lands, and the app's client view
 *      (`apps/my-wordpress/parts/wire.ts`) consumes the target on
 *      mount and on re-targets — skipping a person the params already
 *      put on screen. Module-level state in one bundle is invisible to
 *      another (see `AGENTS.md` § "Cross-bundle state"), hence
 *      `wp.os.createSharedStore`.
 */

/**
 * The window that renders footprints: the WP Explorer APP
 * (`apps/my-wordpress/`). Its client view consumes the pending
 * target on mount and subscribes for re-targets — see
 * `apps/my-wordpress/parts/wire.ts`.
 */
const WINDOW_ID = 'my-wordpress';

interface SharedStoreApi< T > {
	state: T;
	notify(): void;
	subscribe( cb: ( state: T ) => void ): () => void;
}

/** Pending footprint target shared across bundles. */
export interface FootprintTarget {
	/** Target user id, or `null` when nothing is pending. */
	userId: number | null;
	/**
	 * Display name for the breadcrumb/title before the REST footprint
	 * payload resolves. Empty string when the caller didn't supply one.
	 */
	userName: string;
	/**
	 * `Date.now()` of the last `set`. Currently informational and
	 * reserved for future dedup — e.g. telling a fresh request apart
	 * from a stale one, or distinguishing the mount-read from the
	 * subscribe callback if the shell ever batches notifications. No
	 * consumer reads it today: the subscribe callback navigates on any
	 * `userId > 0`, which is correct under the current synchronous
	 * notify model (two quick opens on different users should navigate
	 * twice and land on the last one — a `requestedAt`-based skip with
	 * `Date.now()`'s millisecond resolution could wrongly drop the
	 * second).
	 */
	requestedAt: number;
}

interface DesktopFacade {
	createSharedStore?: < T >(
		key: string,
		initial: () => T,
	) => SharedStoreApi< T >;
	openWindow?: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean | undefined;
}

// Frozen sentinel — only ever spread into a fresh mutable object
// (`{ ..._initial }`), never mutated in place. Freezing turns an
// accidental direct mutation into a loud error instead of silent
// shared-state corruption.
const _initial: Readonly< FootprintTarget > = Object.freeze( {
	userId: null,
	userName: '',
	requestedAt: 0,
} );

function getDesktop(): DesktopFacade | undefined {
	return ( window as unknown as { wp?: { os?: DesktopFacade } } ).wp
		?.os;
}

let _store: SharedStoreApi< FootprintTarget > | null = null;

/**
 * Resolve the shared store, memoizing once `wp.os.createSharedStore`
 * is available. Returns `null` until then, which routes `set`/`read`
 * to the `window._wpdFootprintTarget` stash fallback.
 *
 * Known, accepted trade-off of the shared-store hand-off: a target
 * stashed via the fallback BEFORE the store exists is NOT promoted
 * into the store once it initialises. A subsequent `readFootprintTarget`
 * after init reads the freshly-created store (empty) and the stash is
 * silently dropped. This only bites in the narrow window before
 * `wp.os.createSharedStore` is wired at boot — well before any
 * users-table click can reach `openUserFootprintWindow` — so it's left
 * as-is rather than adding stash→store reconciliation. Documented here
 * so it's a deliberate choice, not a latent surprise.
 */
function getStore(): SharedStoreApi< FootprintTarget > | null {
	if ( _store ) {
		return _store;
	}
	const factory = getDesktop()?.createSharedStore;
	if ( typeof factory !== 'function' ) {
		return null;
	}
	_store = factory< FootprintTarget >(
		'desktop-mode/my-wordpress/footprint-target',
		() => ( { ..._initial } ),
	);
	return _store;
}

/**
 * Set the pending footprint target the next My WordPress window open
 * should render. Must be called BEFORE
 * `openWindow( 'desktop-mode-my-wordpress' )`.
 */
export function setFootprintTarget( userId: number, userName = '' ): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = userId;
		store.state.userName = userName;
		store.state.requestedAt = Date.now();
		// `createSharedStore` is mutate-then-notify; subscribers don't
		// fire on field assignment alone. Easy to forget, silent
		// failure when you do.
		store.notify();
		return;
	}
	// Pre-facade fallback (tests / very early boot before
	// `wp.os.createSharedStore` exists): stash on `window`.
	(
		window as unknown as { _wpdFootprintTarget?: FootprintTarget }
	)._wpdFootprintTarget = {
		userId,
		userName,
		requestedAt: Date.now(),
	};
}

/** Read the pending target. `userId === null` means nothing pending. */
export function readFootprintTarget(): FootprintTarget {
	const store = getStore();
	if ( store ) {
		return { ...store.state };
	}
	return (
		( window as unknown as { _wpdFootprintTarget?: FootprintTarget } )
			._wpdFootprintTarget ?? { ..._initial }
	);
}

/** Clear the target after a consumer has captured it. */
export function clearFootprintTarget(): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = null;
		store.state.userName = '';
		store.state.requestedAt = 0;
		store.notify();
	}
	const w = window as unknown as { _wpdFootprintTarget?: FootprintTarget };
	if ( w._wpdFootprintTarget ) {
		w._wpdFootprintTarget = { ..._initial };
	}
}

/**
 * Subscribe to target changes — fires when a new target is set after
 * the window is already open, so the live render can navigate to the
 * footprint without a close/reopen. Returns an unsubscribe function.
 */
export function subscribeFootprintTarget(
	cb: ( target: FootprintTarget ) => void,
): () => void {
	const store = getStore();
	if ( ! store ) {
		return () => {};
	}
	return store.subscribe( ( state ) => cb( { ...state } ) );
}

/**
 * Open (or retarget) the WP Explorer window on a user's activity
 * footprint. The person travels as open-time params, so a cold open
 * mounts straight onto the footprint and a live window retargets
 * through `reopen`; the shared target is stashed as well, for the
 * store-based contract.
 *
 * @param args          Footprint target.
 * @param args.userId   Target user id (must be a positive integer).
 * @param args.userName Optional display name for the breadcrumb.
 */
export function openUserFootprintWindow( args: {
	userId: number;
	userName?: string;
} ): void {
	const userId = Number( args.userId );
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return;
	}
	const userName = args.userName ?? '';
	setFootprintTarget( userId, userName );
	getDesktop()?.openWindow?.( WINDOW_ID, {
		source: 'my-wordpress/open-user-footprint',
		params: { footprint: userId, fpName: userName },
	} );
}
