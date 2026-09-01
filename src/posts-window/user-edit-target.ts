/**
 * Tiny module-level holder for the User Edit window's "current
 * target user".
 *
 * The native-window framework's `openById` doesn't carry per-open
 * state, so the click handler in the Users table sets the target
 * here right before invoking `openById( 'desktop-mode-user-edit' )`.
 * The render callback reads it back, then resets to `null` so the
 * next open without an explicit target falls back to the viewer's
 * own profile (the "Edit my profile" path from the admin bar).
 *
 * Shared via `wp.os.createSharedStore` so a future split of
 * the user-edit code into its own bundle keeps the same single
 * source of truth across bundles (per CLAUDE.md guidance).
 */

interface SharedStoreApi< T > {
	state: T;
	notify(): void;
	subscribe( cb: ( state: T ) => void ): () => void;
}

interface UserEditTarget {
	userId: number | null;
	requestedAt: number;
	/**
	 * When `true`, the next Users-window render should activate
	 * the "Profile" sub-tab. Set by URL remaps (user-edit.php /
	 * profile.php) and by the in-window row-click handler.
	 */
	tabRequested: boolean;
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
	relations?: {
		set?: (
			windowId: string,
			ref: { type: string; id: number | string; label?: string } | null,
		) => void;
	};
}

const _initial: UserEditTarget = {
	userId: null,
	requestedAt: 0,
	tabRequested: false,
};

let _store: SharedStoreApi< UserEditTarget > | null = null;
function getStore(): SharedStoreApi< UserEditTarget > | null {
	if ( _store ) {
		return _store;
	}
	const w = window as unknown as { wp?: { os?: DesktopFacade } };
	const factory = w.wp?.os?.createSharedStore;
	if ( typeof factory !== 'function' ) {
		return null;
	}
	_store = factory< UserEditTarget >(
		'desktop-mode/user-edit/target',
		() => ( { ..._initial } ),
	);
	return _store;
}

/**
 * Set the target user id the next User Edit window open should
 * render. Must be called BEFORE `openById( 'desktop-mode-user-edit' )`.
 */
export function setUserEditTarget( userId: number ): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = userId;
		store.state.requestedAt = Date.now();
		// Setting a target implicitly requests the Profile tab —
		// every consumer that calls this wants the tab to flip.
		store.state.tabRequested = true;
		// `createSharedStore` is mutate-then-notify; subscribers
		// don't fire on field assignment alone. Easy to forget,
		// silent failure when you do — caught the hard way.
		store.notify();
		return;
	}
	const w = window as unknown as { _wpdUserEditTarget?: UserEditTarget };
	w._wpdUserEditTarget = {
		userId,
		requestedAt: Date.now(),
		tabRequested: true,
	};
}

/** Read the pending target. `null` means "edit the viewer's own profile". */
export function readUserEditTarget(): UserEditTarget {
	const store = getStore();
	if ( store ) {
		return { ...store.state };
	}
	const w = window as unknown as { _wpdUserEditTarget?: UserEditTarget };
	return w._wpdUserEditTarget ?? { ..._initial };
}

/** Clear the target after the render callback has captured it. */
export function clearUserEditTarget(): void {
	const store = getStore();
	if ( store ) {
		store.state.userId = null;
		store.state.requestedAt = 0;
		store.state.tabRequested = false;
		store.notify();
	}
	const w = window as unknown as { _wpdUserEditTarget?: UserEditTarget };
	if ( w._wpdUserEditTarget ) {
		w._wpdUserEditTarget = {
			userId: null,
			requestedAt: 0,
			tabRequested: false,
		};
	}
}

/**
 * Flag the Users-window render to activate its "Profile" sub-tab.
 * Used by the URL remap for user-edit.php / profile.php and by
 * the in-window row-click handler.
 */
export function setUserEditTabRequested( requested: boolean ): void {
	const store = getStore();
	if ( store ) {
		store.state.tabRequested = requested;
		store.notify();
		return;
	}
	const w = window as unknown as { _wpdUserEditTarget?: UserEditTarget };
	const prev = w._wpdUserEditTarget ?? { ..._initial };
	w._wpdUserEditTarget = { ...prev, tabRequested: requested };
}

/**
 * Open (or retarget) the User Edit window on one person — the shared
 * "edit this profile" contract every surface routes through: WP
 * Explorer's user pane and tiles, the My WordPress app's, and any
 * plugin that wants the same door. Deliberately in this leaf module
 * (no imports) so a bundle can take the contract without dragging a
 * window bundle in.
 *
 * Sets the shared-store target first (a warm, already-open window
 * retargets through its subscription), then opens the singleton with
 * `{ userId }` as an open-time param — params ride the session, so a
 * reload brings the window back on the same person — and announces
 * the `user` identity to the relations engine, matching what the
 * chromeless bridge announces for `user-edit.php`, so both paths
 * join one window group.
 *
 * @param userId        The person.
 * @param opts          Options.
 * @param opts.source   Source tag for the open call.
 * @param opts.fallback Runs when the native window isn't registered
 *                      (legacy / disabled sites) — the caller supplies
 *                      its own classic-admin door, since only it knows
 *                      how to build one.
 * @return true when the native window took it.
 */
export function openUserEditWindow(
	userId: number,
	opts: { source?: string; fallback?: () => void } = {},
): boolean {
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return false;
	}
	setUserEditTarget( userId );

	const w = window as unknown as { wp?: { os?: DesktopFacade } };
	const desktop = w.wp?.os;
	const opened = desktop?.openWindow?.( 'desktop-mode-user-edit', {
		source: opts.source ?? 'my-wordpress/user-tile',
		params: { userId },
	} );

	if ( opened ) {
		// The profile window is a singleton that retargets through the
		// shared store, so nothing else can tell the relations engine
		// its identity changed.
		desktop?.relations?.set?.( 'desktop-mode-user-edit', {
			type: 'user',
			id: userId,
		} );
		return true;
	}

	opts.fallback?.();
	return false;
}

/**
 * Subscribe to target-changes — fires when a click sets a NEW
 * target after the window is already open. Lets the render
 * callback re-fetch for a different user without closing /
 * reopening.
 */
export function subscribeUserEditTarget(
	cb: ( target: UserEditTarget ) => void,
): () => void {
	const store = getStore();
	if ( ! store ) {
		return () => {};
	}
	return store.subscribe( ( state ) => cb( { ...state } ) );
}
