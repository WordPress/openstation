/**
 * Cross-bundle holder for the Comments window's "filter to one post".
 *
 * `edit-comments.php?p=<ID>` means "comments on this post". The native
 * window's URL remap (main bundle) parses that id and stashes it here via
 * {@link setCommentsPostFilter} before `openById`; the conversation
 * renderer (comments bundle) reads it back on mount to scope its rail.
 * Shared through `wp.desktop.createSharedStore` so the two bundles see one
 * source of truth — same approach as `user-edit-target`.
 */

interface SharedStoreApi< T > {
	state: T;
	notify(): void;
	subscribe( cb: ( state: T ) => void ): () => void;
}

interface DesktopFacade {
	createSharedStore?: < T >( key: string, initial: () => T ) => SharedStoreApi< T >;
}

let _store: SharedStoreApi< { postId: number } > | null = null;
function getStore(): SharedStoreApi< { postId: number } > | null {
	if ( _store ) {
		return _store;
	}
	const factory = ( window as unknown as { wp?: { desktop?: DesktopFacade } } )
		.wp?.desktop?.createSharedStore;
	if ( typeof factory !== 'function' ) {
		return null;
	}
	_store = factory( 'desktop-mode/comments/post-filter', () => ( { postId: 0 } ) );
	return _store;
}

/** Scope the next Comments-window open to one post. `0` clears the filter. */
export function setCommentsPostFilter( postId: number ): void {
	const store = getStore();
	if ( store ) {
		store.state.postId = postId;
		store.notify(); // createSharedStore is mutate-then-notify.
	}
}

/** The pending post filter; `0` means "all comments". */
export function readCommentsPostFilter(): number {
	return getStore()?.state.postId ?? 0;
}

/** Clear the filter (after "Show all", or a general open). */
export function clearCommentsPostFilter(): void {
	setCommentsPostFilter( 0 );
}

/**
 * React to filter changes. Native windows render once per instance, so a
 * window already open when a new `?p=` open arrives must re-read the
 * filter here rather than on (re)mount. Returns an unsubscribe.
 */
export function subscribeCommentsPostFilter( cb: () => void ): () => void {
	const store = getStore();
	return store ? store.subscribe( () => cb() ) : () => {};
}
