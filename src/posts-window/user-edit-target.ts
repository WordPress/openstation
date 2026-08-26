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
