/**
 * Keyed-list rendering helper.
 *
 * Solves the subtle "click does nothing on a re-rendering list" bug
 * that lurks anywhere a component repaints a list of dynamic data
 * while the user might be interacting with a row.
 *
 * **The bug it prevents.** Without keyed reconciliation, list re-
 * renders typically do `host.innerHTML = ''` followed by a full
 * rebuild — every row's `<li>` (or whatever element) is a fresh DOM
 * node. If the user is mid-press on a row when the repaint happens,
 * `mousedown` fires on the OLD node, the rebuild destroys it, and
 * `mouseup` lands on a new node. The browser DOES NOT synthesize a
 * `click` event when mousedown and mouseup target different
 * elements — so the user's click silently does nothing. The row
 * appears to "flash" via :hover and revert. Bug-by-design of the
 * platform; no event-listener attachment can paper over it.
 *
 * **The fix.** Reuse DOM nodes across renders by matching on a
 * stable key. Same key → same element instance, listener attached
 * once at build time. Different key → only the affected nodes are
 * created or removed; everything stable stays put.
 *
 * **When to use.** Any list rendered from observable data that can
 * change while the user is reading or pressing it: chat messages,
 * conversation lists, dock items, taskbar items, notifications,
 * search results, log streams, drag handles, anywhere.
 *
 * **When NOT to use.** Static lists that render once and never
 * update. The reconciliation overhead is tiny (one Map lookup per
 * item) but a one-shot render with `appendChild` is simpler.
 *
 * ```ts
 * import { renderKeyedList } from 'wp-desktop-mode';
 *
 * function repaint(): void {
 *   renderKeyedList( host, items, {
 *     keyOf:    ( item ) => item.id,
 *     buildItem ( item ) {
 *       const li = document.createElement( 'li' );
 *       li.dataset.id = String( item.id );
 *       li.addEventListener( 'mousedown', () => onSelect( item ) );
 *       return li;
 *     },
 *     updateItem( el, item ) {
 *       el.querySelector( '.title' )!.textContent = item.title;
 *     },
 *   } );
 * }
 * ```
 *
 * @since 0.22.10
 */

const NODE_KEY_PROP = '__wpdmKeyedListKey';
const NODE_DATA_PROP = '__wpdmKeyedListData';

export interface KeyedListOptions< T > {
	/**
	 * Stable identity for an item. Same key across renders means
	 * "this is the same item, reuse the DOM". `string | number` only
	 * — keys go into a `Map`, so anything stringifies cleanly.
	 *
	 * MUST be unique per item within a single render. Duplicate keys
	 * land last-write-wins in the index and produce visual surprise.
	 */
	keyOf( item: T ): string | number;

	/**
	 * Build the DOM for an item that wasn't present in the previous
	 * render. Called exactly once per new key. Attach event listeners
	 * here — they survive future re-renders as long as the key stays.
	 *
	 * Use `mousedown` (NOT `click`) for selection-style listeners on
	 * elements that may be removed by future state changes — see the
	 * module-level docblock.
	 */
	buildItem( item: T ): HTMLElement;

	/**
	 * Optional in-place updater. Called for items whose key matched
	 * a previous render but whose data may have changed. Refresh the
	 * existing DOM here — change text, swap badges, retoggle classes.
	 * The listener already attached in `buildItem` continues to fire.
	 *
	 * If omitted, in-place updates are skipped entirely. Use this
	 * for items that are static once mounted (rare for list rows).
	 */
	updateItem?( el: HTMLElement, item: T, prevItem: T | null ): void;
}

interface IndexedNode {
	el: HTMLElement;
	data: unknown;
}

interface HostState {
	byKey: Map< string, IndexedNode >;
}

/**
 * Read or initialise the per-host state. Stored on the host element
 * itself so multiple `renderKeyedList` calls on different hosts in
 * the same module don't share indices.
 */
function getHostState( host: HTMLElement ): HostState {
	const cached = ( host as unknown as { __wpdmKeyedList?: HostState } )
		.__wpdmKeyedList;
	if ( cached ) {
		return cached;
	}
	const fresh: HostState = { byKey: new Map() };
	( host as unknown as { __wpdmKeyedList?: HostState } ).__wpdmKeyedList =
		fresh;
	return fresh;
}

/**
 * Keyed in-place list reconciler. Mutates `host`'s children to match
 * `items`, reusing existing nodes whose key is unchanged.
 *
 * Reorder semantics: items are placed in the same order as the
 * input array. If two adjacent items swap, only the moved nodes are
 * re-inserted (`insertBefore`); the unchanged neighbour stays put.
 * Net DOM mutations: O(diff) not O(n).
 *
 * @public
 *
 * @param host  The container element. ALL of its children are
 *              owned by the reconciler — don't mix in
 *              hand-managed children, they'll be removed.
 * @param items Source-of-truth list. Stable keys via `opts.keyOf`.
 * @param opts  Reconciliation config — see {@link KeyedListOptions}.
 */
export function renderKeyedList< T >(
	host: HTMLElement,
	items: readonly T[],
	opts: KeyedListOptions< T >,
): void {
	const state = getHostState( host );
	const prev = state.byKey;
	const next = new Map< string, IndexedNode >();

	// Pass 1 — resolve each item to a (reused or fresh) element.
	const ordered: HTMLElement[] = [];
	const seenKeys = new Set< string >();
	for ( const item of items ) {
		const key = String( opts.keyOf( item ) );
		if ( seenKeys.has( key ) ) {
			// Duplicate key in the same render is a programming bug;
			// surface it loudly but don't bail (the dup overrides).
			// eslint-disable-next-line no-console
			console.warn(
				'[wpdm/keyed-list] duplicate key — only the last item with this key will render:',
				key,
			);
		}
		seenKeys.add( key );

		const reused = prev.get( key );
		if ( reused ) {
			const prevData = reused.data as T;
			opts.updateItem?.( reused.el, item, prevData );
			reused.data = item;
			next.set( key, reused );
			ordered.push( reused.el );
			continue;
		}
		const el = opts.buildItem( item );
		// Stamp the key on the node for debugging — the data property
		// is opaque but inspectable in DevTools. Cheap.
		( el as unknown as Record< string, unknown > )[ NODE_KEY_PROP ] = key;
		( el as unknown as Record< string, unknown > )[ NODE_DATA_PROP ] = item;
		next.set( key, { el, data: item } );
		ordered.push( el );
	}

	// Pass 2 — remove nodes that are no longer in the list.
	for ( const [ key, entry ] of prev ) {
		if ( ! next.has( key ) ) {
			entry.el.remove();
		}
	}

	// Pass 3 — order the kept + new nodes inside the host. Read
	// `host.children` LIVE each step (it's an HTMLCollection that
	// updates as we mutate) so a previous insert moving a node past
	// the cursor doesn't leave us reading stale positions. Nodes
	// already in the right slot are skipped, so a steady-state
	// re-render with no changes does ZERO DOM writes.
	for ( let i = 0; i < ordered.length; i++ ) {
		const desired = ordered[ i ];
		const live = host.children[ i ] as HTMLElement | undefined;
		if ( live === desired ) {
			continue;
		}
		// `insertBefore` on a node already in `host` moves it; passing
		// `null` (when we've run out of live children) appends.
		host.insertBefore( desired, live ?? null );
	}

	state.byKey = next;
}

/**
 * Drop the keyed-list state for a host. Call this when the list is
 * being destroyed (component unmount, etc.) so future `renderKeyedList`
 * calls on the same host reset cleanly.
 *
 * Idempotent — safe to call on hosts that never had a keyed list.
 *
 * @public
 */
export function clearKeyedList( host: HTMLElement ): void {
	const cached = ( host as unknown as { __wpdmKeyedList?: HostState } )
		.__wpdmKeyedList;
	if ( ! cached ) {
		return;
	}
	for ( const entry of cached.byKey.values() ) {
		entry.el.remove();
	}
	cached.byKey.clear();
	delete ( host as unknown as { __wpdmKeyedList?: HostState } )
		.__wpdmKeyedList;
}
