/**
 * My WordPress — cross-bundle "open this user's activity footprint"
 * target.
 *
 * The native My WordPress window's bundle is lazy-loaded and lives in
 * its own Vite IIFE. The click that requests a footprint originates
 * elsewhere — most notably the chromeless `users.php` iframe, whose
 * row-action click is routed through the window-system bundle's
 * `handleWindowMessage`. Module-level state in one bundle is invisible
 * to another (see `AGENTS.md` § "Cross-bundle state"), so the target
 * user is threaded through `wp.desktop.createSharedStore` — the same
 * mechanism `src/posts-window/user-edit-target.ts` uses for the User
 * Edit window.
 *
 * Flow:
 *   1. A caller (parent shell handler, plugin code) invokes
 *      `openUserFootprintWindow( { userId, userName } )`.
 *   2. That stashes the target here, then calls
 *      `wp.desktop.openWindow( 'desktop-mode-my-wordpress' )`, which
 *      opens the window — triggering the lazy bundle load — or focuses
 *      it when it is already open.
 *   3. The My WordPress bundle reads the target on mount (cold open)
 *      and subscribes for re-targets (warm, already-open window). See
 *      `src/my-wordpress/index.ts`.
 *
 * Cold-start safety is the whole point of routing through the shared
 * store rather than `wp.desktop.myWordpress.openDetail()`: the latter
 * only exists once the lazy bundle has mounted (the early stub in
 * `early-api.ts` buffers `registerEntityKind` and nothing else), so a
 * footprint click in a session that never opened My WordPress would
 * silently no-op.
 *
 * @since 0.23.0
 */

/** Native My WordPress window id — the lazy bundle's `WINDOW_ID`. */
const WINDOW_ID = 'desktop-mode-my-wordpress';

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
		opts?: { source?: string },
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
	return ( window as unknown as { wp?: { desktop?: DesktopFacade } } ).wp
		?.desktop;
}

let _store: SharedStoreApi< FootprintTarget > | null = null;

/**
 * Resolve the shared store, memoizing once `wp.desktop.createSharedStore`
 * is available. Returns `null` until then, which routes `set`/`read`
 * to the `window._wpdFootprintTarget` stash fallback.
 *
 * Known, accepted trade-off (mirrors `user-edit-target.ts`): a target
 * stashed via the fallback BEFORE the store exists is NOT promoted
 * into the store once it initialises. A subsequent `readFootprintTarget`
 * after init reads the freshly-created store (empty) and the stash is
 * silently dropped. This only bites in the narrow window before
 * `wp.desktop.createSharedStore` is wired at boot — well before any
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
		// failure when you do — see `user-edit-target.ts`.
		store.notify();
		return;
	}
	// Pre-facade fallback (tests / very early boot before
	// `wp.desktop.createSharedStore` exists): stash on `window`.
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
 * Open (or focus) the My WordPress window scoped to a user's activity
 * footprint. Cold-start safe: stashes the shared target first, then
 * opens the window so the freshly-mounted bundle reads it back.
 *
 * @since 0.23.0
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
	setFootprintTarget( userId, args.userName ?? '' );
	getDesktop()?.openWindow?.( WINDOW_ID, {
		source: 'my-wordpress/open-user-footprint',
	} );
}
