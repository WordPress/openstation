/**
 * OpenStation — Recycle Bin window.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-recycle-bin` window opens. Wires up the toolbar (filter,
 * search, refresh, bulk actions, empty), populates the `<os-table>`
 * from the REST list endpoint, and persists nothing locally — every
 * action is a roundtrip + reload so the table never lies about
 * server state.
 *
 * Web-component registrations: the main `desktop.min.js` ships only
 * the `<os-*>` tags it constructs itself. This bundle leaf-imports
 * the additional ones it needs (`<os-table>`, `<os-relative-time>`).
 * `defineComponent()` is idempotent.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
// Side-effect imports — register the `<os-*>` components this
// bundle constructs that the main shell does not ship.
import '../ui/components/os-table/os-table';
import '../ui/components/os-relative-time/os-relative-time';
// `<os-segmented>` (with `<os-segment>` children) is the type-filter
// toolbar emitted by `includes/recycle-bin/window.php`, never built
// via `document.createElement` here — so the lint rule that scans
// `createElement('os-*')` doesn't see it. Register the compound
// class set explicitly so the server-rendered toolbar works.
import '../ui/components/os-segmented/os-segmented';
// Same story for `<os-empty-state>`, which the template emits.
import '../ui/components/os-empty-state/os-empty-state';
import { DESKTOP_THEME_CHANGED_EVENT } from '../desktop-themes/apply';
import { _currentRecycleBinCount, setRecycleBinCount } from './icon-state';
import { buildColumns, mapRecycleTypeToFileType } from './table-visuals';
import { runEmptyLoop } from './empty-loop';
import * as realtime from './realtime';
import {
	emptyBin,
	fetchList,
	purgeItems,
	restoreItems,
	type RecycleBinItem,
	type RecycleBinItemRef,
} from './rest';

import type { OsTable } from '../ui/components/os-table/os-table';

// The table's cell visuals (type badge, title stack, row buttons,
// the columns builder) live in `table-visuals.ts`, shared verbatim
// with the App Framework port in `apps/trash/` so the two bins stay
// pixel-identical. Re-exported here because tests and plugin code
// historically import it from this module.
export { mapRecycleTypeToFileType } from './table-visuals';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/**
 * Map a recycle-bin row's `type` (post/page/CPT/attachment/comment)
 * to the Files-on-the-Desktop file-type slug. Used by the
 * "Pin to desktop" toolbar action.
 */
/**
 * Bridge to `wp.os.confirm` (the main bundle's
 * `<os-confirm-dialog>` wrapper). The recycle-bin script lists
 * `openstation` as a dependency, so the global is always set by
 * the time this code runs.
 */
interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}
function osConfirmGlobal( options: ConfirmOptions ): Promise< boolean > {
	const fn = ( window.wp as { os?: { confirm?: ( o: ConfirmOptions ) => Promise< boolean > } } | undefined )
		?.os?.confirm;
	if ( typeof fn !== 'function' ) {
		return Promise.reject(
			new Error(
				'[openstation] wp.os.confirm is missing — the main desktop bundle must load before the recycle-bin script.',
			),
		);
	}
	return fn( options );
}

const ROOT = '[data-os-recycle-bin-root]';
const TOOLBAR = '[data-os-recycle-bin-toolbar]';
const EMPTY_STATE = '[data-os-recycle-bin-empty-state]';
const FILTER = '[data-os-recycle-bin-filter]';
const SEARCH = '[data-os-recycle-bin-search]';
const REFRESH = '[data-os-recycle-bin-refresh]';
const TABLE = '[data-os-recycle-bin-table]';
const BULK = '[data-os-recycle-bin-bulk]';
const COUNT = '[data-os-recycle-bin-count]';
const RESTORE_SEL = '[data-os-recycle-bin-restore-selected]';
const PIN_TO_DESKTOP = '[data-os-recycle-bin-pin-to-desktop]';
const PURGE_SEL = '[data-os-recycle-bin-purge-selected]';
const EMPTY_BTN = '[data-os-recycle-bin-empty]';

/**
 * Module-scoped row-action delegates. The column descriptors are
 * built once per render() call but their `render` closures
 * outlive any single button paint — the table calls them on
 * every re-paint. Threading the handlers through every helper
 * would clutter every signature, so we publish them here and
 * re-bind on each `renderRecycleBin()` invocation. Each row
 * action carries `{ id, type }` because the server dispatches by
 * type — comments use `wp_untrash_comment`, posts go through
 * `wp_untrash_post`, etc.
 */
let currentRowActionRestore: ( ref: RecycleBinItemRef ) => void = () => {};
let currentRowActionPurge: ( ref: RecycleBinItemRef ) => void = () => {};
const rowActionRestore = ( ref: RecycleBinItemRef ): void =>
	currentRowActionRestore( ref );
const rowActionPurge = ( ref: RecycleBinItemRef ): void =>
	currentRowActionPurge( ref );

/**
 * Module-scoped item cache.
 *
 * The bin is a native window; closing tears down the body, the
 * column render closures, and every per-render listener. Reopening
 * spawns a fresh `renderRecycleBin()` call with a brand-new table.
 *
 * Without a cache, every reopen pays the cold-load skeleton flash
 * even when the data hasn't changed. Caching at the module level
 * survives close/open and lets us paint the previous data
 * synchronously, then quietly reconcile against the server in the
 * background.
 */
let cachedItems: RecycleBinItem[] | null = null;

/**
 * Stable key for change detection. Any movement in the trash
 * (a row appears, disappears, or its `deleted_at` shifts because
 * an item was re-trashed) flips the key; identical state across
 * two fetches yields the same key, so we can skip the
 * `table.data = …` assignment and the os-table body repaint
 * that comes with it.
 */
function itemsFingerprint( items: RecycleBinItem[] ): string {
	if ( items.length === 0 ) {
		return '';
	}
	// Sort first — server order can vary on ties (same `modified`
	// timestamp). Comparing the sorted projection makes the
	// fingerprint stable against ordering churn.
	// Type-qualified like getRowId — post #5 and comment #5 are
	// distinct items and must produce distinct fingerprint parts.
	const parts = items
		.map( ( i ) => `${ i.type }:${ i.id }:${ i.deleted_at }` )
		.sort();
	return parts.join( '|' );
}

/** Per-window state. Re-created on every render() call. */
interface BinState {
	filter: '' | 'post' | 'page' | 'attachment' | 'comment' | 'desktop' | 'placement' | 'shortcut' | 'folder';
	search: string;
	searchDebounce: number | null;
}

/**
 * Render entry point. The shell hands us a mounted body element on
 * every open; we own everything inside it for the lifetime of the
 * window. Closing tears down the element entirely so we don't need
 * a separate cleanup path.
 */
export function renderRecycleBin( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >( ROOT );
	const table = body.querySelector< OsTable< RecycleBinItem > >( TABLE );
	if ( ! root || ! table ) {
		return;
	}

	const state: BinState = {
		filter: '',
		search: '',
		searchDebounce: null,
	};

	// Set on `window.<global>` so the column render closures (built
	// once below) can reach the per-render handlers without us
	// threading them through every helper signature. Reset on
	// teardown so a re-open from a fresh template doesn't fire the
	// previous render's stale callback.
	currentRowActionRestore = ( ref ) => void handleRestore( [ ref ] );
	currentRowActionPurge = ( ref ) => void handlePurge( [ ref ] );

	table.columns = buildColumns( {
		onRestore: rowActionRestore,
		onPurge: rowActionPurge,
	} );
	// Composite identity — the bin mixes entity types whose numeric id
	// sequences are independent (comments live in wp_comments; posts /
	// pages / attachments in wp_posts; placements / folders / shortcuts
	// in their own tables), so post #5 and comment #5 routinely coexist
	// in the list. A bare `row.id` would give both rows the SAME
	// selection key: ticking one would select — and bulk-purge — the
	// other. Qualifying with the type makes identity unambiguous.
	table.getRowId = ( row ) => `${ row.type }:${ row.id }`;
	// No `fileTypeForRow` here on purpose: trashed items are
	// for restoring, not for pinning to the desktop. The Pin to
	// Desktop toolbar action still covers the rare "I want both
	// at once" path. `<os-table>`'s drag-handle surface is
	// reserved for tables where dragging IS the primary
	// affordance (e.g. plugin-authored picker UIs).

	const toolbar = root.querySelector< HTMLElement >( TOOLBAR );
	const emptyState = root.querySelector< HTMLElement >( EMPTY_STATE );
	const noMatchText = table.getAttribute( 'empty' ) ?? '';

	/**
	 * Show or hide everything that only makes sense against a list.
	 * The table goes too — its header row carries the sort controls.
	 *
	 * Callers pass the list endpoint's `total`, which counts the whole
	 * bin regardless of the active filter or search: a search matching
	 * nothing must keep the toolbar, or there is no way back out of
	 * it. That case shows the table's own `empty` text instead.
	 */
	const setChromeVisible = ( hasItems: boolean ): void => {
		toolbar?.toggleAttribute( 'hidden', ! hasItems );
		emptyState?.toggleAttribute( 'hidden', hasItems );
		table.hidden = ! hasItems;
	};

	// The badge count is seeded from the shell config on boot, so an
	// empty bin opens straight into its empty state rather than a
	// skeleton and a toolbar that both vanish a moment later.
	setChromeVisible( _currentRecycleBinCount() > 0 );

	// If we have a cached snapshot from a previous open, paint it
	// synchronously — the user sees the data they expect on
	// reopen, no skeleton, no flash. The fingerprint becomes the
	// baseline so an identical-state refresh that follows
	// immediately is a complete no-op (no second `table.data = …`
	// assignment, no body repaint).
	//
	// The template ships with `loading` set so cold opens render
	// the skeleton; with a warm cache we remove it before paint
	// so the cached rows show directly instead of the skeleton.
	let currentFingerprint = '';
	if ( cachedItems ) {
		table.data = cachedItems;
		currentFingerprint = itemsFingerprint( cachedItems );
		table.removeAttribute( 'loading' );
	}

	// Monotonic refresh id. Multiple refreshes can be in flight
	// concurrently (real-time signal, post-action reload).
	// Out-of-order responses would overwrite fresh data with stale
	// (the classic "click Restore, item stays, click again" bug);
	// only the response whose seq matches the current high-water
	// mark gets to mutate `table.data`.
	let refreshSeq = 0;

	/**
	 * Fetch and reconcile.
	 *
	 * Loading skeleton is shown ONLY when we have no cached items
	 * to paint over (i.e. the very first cold load on this page-
	 * lifetime). Every other refresh — initial reopen with cache,
	 * real-time signal, post-action reload, manual click — runs
	 * without touching the loading flag and without re-assigning
	 * `table.data` if the fingerprint shows nothing changed.
	 */
	const refresh = async (): Promise< void > => {
		const showSkeleton = ! cachedItems;
		const mySeq = ++refreshSeq;
		if ( showSkeleton ) {
			table.toggleAttribute( 'loading', true );
		}
		try {
			const { items, total } = await fetchList( {
				type: state.filter,
				search: state.search,
				perPage: 200,
			} );
			if ( mySeq !== refreshSeq ) {
				// A newer refresh started after us. Discard.
				return;
			}
			const next = itemsFingerprint( items );
			if ( next !== currentFingerprint ) {
				table.data = items;
				currentFingerprint = next;
				cachedItems = items;
				// Prune selection keys whose row is no longer VISIBLE —
				// it left the list (purged / restored elsewhere) or a
				// data-driven change hid it behind a `table.filters`
				// entry. `collectSelectedItems()` resolves
				// against the visible rows, so this is not load-bearing
				// for safety — it keeps the bulk bar's "N selected"
				// count truthful instead of overcounting ghosts.
				// Selections of still-visible rows are preserved.
				const visible = new Set(
					( table.visibleRows ?? [] ).map(
						( row ) => `${ row.type }:${ row.id }`,
					),
				);
				const kept = Array.from( table.selection ?? [], String )
					.filter( ( key ) => visible.has( key ) );
				if ( kept.length !== ( table.selection?.size ?? 0 ) ) {
					table.selection = kept;
				}
			} else {
				// Fingerprint unchanged — keep DOM as-is, just
				// refresh the cache reference so it survives
				// future close/open cycles.
				cachedItems = items;
			}
			// Authoritative reset for the dock/icon badge — server's
			// `total` covers ALL trash (every type), not the slice
			// the user is currently viewing. This is the cheapest
			// way to keep the badge truthful: we already paid for
			// the round-trip, so we may as well consume the count.
			setRecycleBinCount( total );
			table.setAttribute( 'empty', noMatchText );
			setChromeVisible( total > 0 );
		} catch ( err ) {
			if ( mySeq !== refreshSeq ) {
				return;
			}
			console.error( '[recycle-bin] list failed', err );
			// With a cache, keep the stale rows — better than
			// flashing "empty" because the network blipped. With
			// none, show an empty table, and force the chrome on
			// whatever the seeded count said: the failure copy
			// below points at Refresh, which lives in the toolbar.
			if ( showSkeleton ) {
				table.data = [];
				currentFingerprint = '';
				table.setAttribute(
					'empty',
					__( 'Could not load the Trash. Try Refresh.' ),
				);
				setChromeVisible( true );
			}
		} finally {
			// Only the latest in-flight refresh gets to flip the
			// loading flag back off / repaint the bulk bar — an
			// older response can't take credit for the newer's
			// already-finished UI work.
			if ( mySeq === refreshSeq ) {
				if ( showSkeleton ) {
					table.toggleAttribute( 'loading', false );
				}
				refreshBulkBar();
			}
		}
	};

	const bulk = root.querySelector< HTMLElement >( BULK );
	const countEl = root.querySelector< HTMLElement >( COUNT );

	const refreshBulkBar = (): void => {
		if ( ! bulk || ! countEl ) {
			return;
		}
		const selected = Array.from( table.selection ?? [] );
		if ( selected.length === 0 ) {
			bulk.hidden = true;
			return;
		}
		bulk.hidden = false;
		countEl.textContent = sprintf(
			/* translators: %d: selected row count. */
			__( '%d selected' ),
			selected.length,
		);
	};

	// Each selection entry resolves back to the row so we know its
	// `type` — bulk handlers send `[{id, type}]` to the server. Keys
	// are the composite `type:id` produced by getRowId above; matching
	// on the bare numeric id would fan one selected row out to every
	// same-id row of another type.
	//
	// Resolve against the VISIBLE rows, not the full `data` buffer:
	// a data-driven change (e.g. a realtime refresh replacing a row
	// whose new title no longer matches a `table.filters` entry) can
	// hide a selected row without any filter event firing — and a
	// row the user cannot see must never ride into a purge.
	const collectSelectedItems = (): RecycleBinItemRef[] => {
		const sel = new Set( Array.from( table.selection ?? [], String ) );
		const out: RecycleBinItemRef[] = [];
		for ( const row of table.visibleRows ?? [] ) {
			if ( sel.has( `${ row.type }:${ row.id }` ) ) {
				out.push( { id: row.id, type: row.type } );
			}
		}
		return out;
	};

	const handleRestore = async (
		refs: RecycleBinItemRef[],
	): Promise< void > => {
		if ( refs.length === 0 ) {
			return;
		}
		const types = Array.from( new Set( refs.map( ( r ) => r.type ) ) );
		try {
			const result = await restoreItems( refs );
			emitDoneEvent( 'restore', result.ok, result.errors, types, result.ok );
		} catch ( err ) {
			console.error( '[recycle-bin] restore failed', err );
		}
		// Drop the selection — the rows that were just restored
		// are gone; lingering ids would leave the bulk bar visible
		// with a stale "N selected" count and force the user to
		// uncheck things that no longer exist.
		table.clearSelection();
		await refresh();
	};

	const handlePinToDesktop = async (
		refs: RecycleBinItemRef[],
	): Promise< void > => {
		if ( refs.length === 0 ) {
			return;
		}
		// Restore first so the items exist again at their canonical
		// post/comment id, then place each on the desktop at staggered
		// coordinates near the top-left so the user sees them all
		// without overlap.
		//
		// One restore call PER REF, not one batched call: the bulk
		// response's `ok` array carries bare numeric ids with no type,
		// so with a mixed selection like post #5 + comment #5 a batch
		// can't say WHICH #5 succeeded — a failed comment restore
		// would be pinned anyway because the post's id matched. The
		// server dispatches per item either way, so per-ref calls cost
		// the same work and keep the success signal unambiguous.
		const types = Array.from( new Set( refs.map( ( r ) => r.type ) ) );
		const okIds: number[] = [];
		const allErrors: Array< { id: number; code: string; message: string } > = [];
		const filesApi = ( window.wp as { os?: { files?: { rest?: { createPlacement: ( payload: unknown ) => Promise< unknown > } } } } | undefined )
			?.os?.files?.rest;
		let placed = 0;
		for ( const ref of refs ) {
			let restored;
			try {
				restored = await restoreItems( [ ref ] );
			} catch ( err ) {
				console.error( '[recycle-bin] pin-to-desktop restore failed', err );
				continue;
			}
			allErrors.push( ...restored.errors );
			if ( ! restored.ok.includes( ref.id ) ) {
				continue;
			}
			okIds.push( ref.id );
			const desktopType = mapRecycleTypeToFileType( ref.type );
			if ( ! filesApi || ! desktopType ) {
				continue;
			}
			try {
				// Match the grid in src/desktop-files/grid.ts
				// (padding 16 + col 96 + row 110, column-major
				// fill). The math is duplicated because this
				// bundle is a separate vite target and can't
				// reach into the desktop bundle's internals.
				await filesApi.createPlacement( {
					type: desktopType,
					ref: String( ref.id ),
					x: 16 + ( placed % 5 ) * 96,
					y: 16 + Math.floor( placed / 5 ) * 110,
				} );
			} catch ( err ) {
				console.error( '[recycle-bin] pin-to-desktop placement failed', err );
			}
			placed += 1;
		}
		emitDoneEvent( 'restore', okIds, allErrors, types, okIds );
		table.clearSelection();
		await refresh();
	};

	const handlePurge = async (
		refs: RecycleBinItemRef[],
	): Promise< void > => {
		if ( refs.length === 0 ) {
			return;
		}
		const ok = await osConfirmGlobal( {
			title: __( 'Delete forever?' ),
			message: sprintf(
				/* translators: %d: row count. */
				__( 'Permanently delete %d item(s)? This cannot be undone.' ),
				refs.length,
			),
			confirmLabel: __( 'Delete forever' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		const types = Array.from( new Set( refs.map( ( r ) => r.type ) ) );
		try {
			const result = await purgeItems( refs );
			emitDoneEvent( 'purge', result.ok, result.errors, types, result.ok );
		} catch ( err ) {
			console.error( '[recycle-bin] purge failed', err );
		}
		table.clearSelection();
		await refresh();
	};

	const emptyButton = root.querySelector< HTMLElement >( EMPTY_BTN );

	// Wrap the existing trailing text node in a span so we can swap
	// the label during the empty loop without wiping the leading icon.
	// The PHP template emits `<os-button><span dashicon/> Empty Trash</os-button>`;
	// the trailing text node is the last child after the icon span.
	let emptyButtonLabelEl: HTMLSpanElement | null = null;
	let emptyButtonOriginalLabel = '';
	if ( emptyButton ) {
		const trailingText = Array.from( emptyButton.childNodes ).find(
			( n ): n is Text =>
				n.nodeType === Node.TEXT_NODE &&
				( n.textContent ?? '' ).trim() !== '',
		);
		emptyButtonOriginalLabel = ( trailingText?.textContent ?? '' ).trim();
		emptyButtonLabelEl = document.createElement( 'span' );
		emptyButtonLabelEl.setAttribute(
			'data-os-recycle-bin-empty-label',
			'',
		);
		emptyButtonLabelEl.textContent = emptyButtonOriginalLabel;
		if ( trailingText ) {
			trailingText.replaceWith( emptyButtonLabelEl );
		} else {
			emptyButton.appendChild( emptyButtonLabelEl );
		}
	}

	/**
	 * Update the Empty Trash button to reflect in-progress emptying.
	 *
	 * `<os-button>` slots its children; we only swap the label span
	 * (created above) so the leading dashicon and any other slotted
	 * markup survive intact.
	 */
	const setEmptyButtonState = (
		mode: 'idle' | 'progress' | 'starting',
		purged = 0,
		total = 0,
	): void => {
		if ( ! emptyButton || ! emptyButtonLabelEl ) {
			return;
		}
		if ( mode === 'idle' ) {
			emptyButton.removeAttribute( 'disabled' );
			emptyButton.removeAttribute( 'aria-busy' );
			emptyButtonLabelEl.textContent = emptyButtonOriginalLabel;
			return;
		}
		emptyButton.setAttribute( 'disabled', '' );
		emptyButton.setAttribute( 'aria-busy', 'true' );
		emptyButtonLabelEl.textContent = mode === 'starting' || total === 0
			? __( 'Emptying…' )
			: sprintf(
				/* translators: 1: items purged so far, 2: items in bin when emptying began. */
				__( 'Emptying… %1$d of %2$d' ),
				purged,
				total,
			);
	};

	const handleEmpty = async (): Promise< void > => {
		// The server's empty endpoint purges the ENTIRE Trash — it takes
		// no type/search scope (see openstation_recycle_bin_empty()).
		// The confirm copy must say so; claiming "the current view"
		// while a filter is active would purge items the user filtered
		// out of sight.
		const ok = await osConfirmGlobal( {
			title: __( 'Empty Trash?' ),
			message: __(
				'Permanently delete ALL items in the Trash? This includes every type and any items hidden by the current filter or search. This cannot be undone.',
			),
			confirmLabel: __( 'Empty Trash' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		// Empty fans out across whatever the user can see — assume
		// every tracked type is potentially affected.
		const allTypes = Array.from(
			new Set( ( table.data ?? [] ).map( ( r ) => r.type ) ),
		);

		// The server caps each call at a chunk size (default 200) to
		// avoid PHP timeouts. The loop driver iterates until the bin
		// is empty (or no progress is possible because every leftover
		// item is capability-blocked).
		setEmptyButtonState( 'starting' );
		try {
			const loop = await runEmptyLoop( {
				emptyBin,
				onProgress: ( { purged, initialTotal } ) =>
					setEmptyButtonState( 'progress', purged, initialTotal ),
			} );

			emitDoneEvent(
				'empty',
				new Array( loop.purged ).fill( 0 ),
				loop.skipped > 0
					? [ {
						id: 0,
						code: 'openstation_recycle_bin_skipped',
						message: sprintf(
							/* translators: %d: skipped count. */
							__( '%d item(s) skipped (insufficient permissions).' ),
							loop.skipped,
						),
					} ]
					: [],
				allTypes,
				[],
			);

			// Optimistic badge zero: emitDoneEvent + refresh() both
			// reconcile via REST round-trips, so without this the badge
			// shows the pre-empty count for ~hundreds of ms after the
			// bin is empty. refresh() below sets the authoritative value.
			if ( loop.stoppedBecause === 'empty' ) {
				setRecycleBinCount( 0 );
			}
		} catch ( err ) {
			console.error( '[recycle-bin] empty failed', err );
		} finally {
			setEmptyButtonState( 'idle' );
		}
		await refresh();
	};

	// --- Toolbar wiring -----------------------------------------------

	root.querySelector( FILTER )?.addEventListener( 'os-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: string } > ).detail;
		state.filter = ( detail?.value ?? '' ) as BinState[ 'filter' ];
		// The result set is about to change wholesale. `<os-table>`
		// keeps selected ids across `data` reassignment, so ids picked
		// under the previous filter would linger invisibly and resurface
		// checked when the user switches back. Start the new view clean.
		table.clearSelection();
		void refresh();
	} );

	const search = root.querySelector< HTMLElement >( SEARCH );
	search?.addEventListener( 'os-input-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		state.search = value;
		if ( state.searchDebounce !== null ) {
			window.clearTimeout( state.searchDebounce );
		}
		state.searchDebounce = window.setTimeout( () => {
			// Same rationale as the type-filter handler above.
			table.clearSelection();
			void refresh();
		}, 250 );
	} );

	// Body-level click delegation for every toolbar action. Direct
	// element-bound listeners on `<os-button>` were proving
	// flaky — the click event was reaching the host but my handler
	// wasn't firing reliably for the bulk Restore button. Body
	// delegation walks `closest()` from the click target, so we
	// catch the click no matter how deeply the os-button shadow
	// re-targets the event. One listener, four selectors, zero
	// custom-element-quirk surface area.
	body.addEventListener( 'click', ( e: Event ) => {
		const target = e.target as HTMLElement | null;
		if ( ! target ) {
			return;
		}
		if ( target.closest( REFRESH ) ) {
			void refresh();
			return;
		}
		if ( target.closest( RESTORE_SEL ) ) {
			void handleRestore( collectSelectedItems() );
			return;
		}
		if ( target.closest( PIN_TO_DESKTOP ) ) {
			void handlePinToDesktop( collectSelectedItems() );
			return;
		}
		if ( target.closest( PURGE_SEL ) ) {
			void handlePurge( collectSelectedItems() );
			return;
		}
		if ( target.closest( EMPTY_BTN ) ) {
			void handleEmpty();
		}
	} );

	// --- Table wiring -------------------------------------------------

	table.addEventListener( 'os-table-selection-change', () => {
		refreshBulkBar();
	} );

	// Default sort: most-recently-deleted first. Users can change it.
	table.sort = { key: 'deleted_at', direction: 'desc' };

	// Real-time updates while the window is open. Both the
	// chromeless-iframe fast path and the heartbeat catch-all path
	// dispatch `os-recycle-bin-changed` on document — we
	// debounce to coalesce burst events (bulk-trash a folder of 50
	// images = one repaint).
	realtime.start();
	let externalRefreshTimer: number | null = null;
	const onExternalChange = ( e: Event ): void => {
		const detail = ( e as CustomEvent< { source?: string } > ).detail;
		// Local events (kind: 'restore' | 'purge' | 'empty') already
		// trigger a refresh from the action handlers themselves —
		// only re-fetch on external sources to avoid double-loading.
		if ( ! detail?.source || detail.source === 'local' ) {
			return;
		}
		if ( externalRefreshTimer !== null ) {
			window.clearTimeout( externalRefreshTimer );
		}
		externalRefreshTimer = window.setTimeout( () => {
			externalRefreshTimer = null;
			void refresh();
		}, 200 ) as unknown as number;
	};
	document.addEventListener( 'os-recycle-bin-changed', onExternalChange );

	// Subscribe to the per-domain broadcast topics — when a post,
	// page, or attachment is mutated anywhere in the shell (list-
	// table trash, REST DELETE, Gutenberg "Move to trash") we get
	// notified through the broadcast bus and refresh. This is the
	// instant complement to the heartbeat catch-all.
	const broadcastUnsubs: Array< () => void > = [];
	const api = window.wp?.os;
	if ( api && typeof api.subscribe === 'function' ) {
		const onDomainChanged = ( payload: unknown ): void => {
			const detail = payload as { source?: string } | null;
			// Skip our own emissions — restore/purge already
			// triggers a refresh from the action handler, no
			// need to double-fetch.
			if ( detail?.source === 'recycle-bin' ) {
				return;
			}
			if ( externalRefreshTimer !== null ) {
				window.clearTimeout( externalRefreshTimer );
			}
			externalRefreshTimer = window.setTimeout( () => {
				externalRefreshTimer = null;
				void refresh();
			}, 200 ) as unknown as number;
		};
		const postTypes =
			window.openStationRecycleBinConfig?.postTypes ??
			( window as { openStationConfig?: { recycleBinPostTypes?: string[] } } ).openStationConfig
				?.recycleBinPostTypes ??
			[ 'post', 'page', 'attachment' ];
		// Fixed non-post-type entities the Recycle Bin always captures.
		const fixedExtras = [ 'comment', 'placement', 'shortcut', 'folder' ];
		for ( const slug of [ ...postTypes, ...fixedExtras ] ) {
			broadcastUnsubs.push( api.subscribe( `os.${ slug }.changed`, onDomainChanged ) );
		}
	}

	// Focus is intentionally NOT a refresh trigger. Once the
	// window is open, real-time signals (heartbeat + chromeless
	// footer broadcast + the per-domain bus subscriptions below)
	// keep its data current. Refreshing on focus made the bin
	// flash visibly every time the user clicked back in — and
	// the fingerprint guard would skip the body repaint anyway,
	// so the fetch was pure waste.

	// Tear down realtime + listeners when the bin window closes.
	// Use the native CustomEvent (not the hook bus) so we never
	// risk mutating the hook chain from inside a hook callback —
	// `@wordpress/hooks` self-removal during dispatch can desync
	// the iterator and is the most likely culprit behind the
	// close-X failure we saw. Native events have no such concern.
	const onWindowClosed = ( e: Event ): void => {
		const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId !== 'desktop-mode-recycle-bin' ) {
			return;
		}
		realtime.stop();
		document.removeEventListener(
			'os-recycle-bin-changed',
			onExternalChange,
		);
		for ( const unsub of broadcastUnsubs ) {
			try {
				unsub();
			} catch ( err ) {
				void err;
			}
		}
		broadcastUnsubs.length = 0;
		if ( externalRefreshTimer !== null ) {
			window.clearTimeout( externalRefreshTimer );
			externalRefreshTimer = null;
		}
		// Re-stub the row-action delegates so any zombie pointer
		// references (e.g. a button held in a closure by an
		// in-flight fetch) become no-ops instead of resurrecting
		// closed-window state.
		currentRowActionRestore = () => {};
		currentRowActionPurge = () => {};
		document.removeEventListener( 'os-window-closed', onWindowClosed );
		document.removeEventListener(
			DESKTOP_THEME_CHANGED_EVENT,
			onDesktopThemeChanged,
		);
	};
	document.addEventListener( 'os-window-closed', onWindowClosed );

	// The bin lives in its own bundle and paints its row-action
	// glyphs itself, so the shell's theme-change repaint (which walks
	// dock rails and window chrome) never reaches these rows. Re-run
	// the normal refresh so the table rebuilds through
	// `makeRowButton()` and picks up the new theme's icons.
	const onDesktopThemeChanged = (): void => {
		if ( ! body.isConnected ) {
			return;
		}
		void refresh();
	};
	document.addEventListener(
		DESKTOP_THEME_CHANGED_EVENT,
		onDesktopThemeChanged,
	);

	void refresh();
}

/**
 * Notify the rest of the shell that a recycle-bin operation finished.
 *
 * Other windows (e.g. the Media Library) can listen for this and
 * re-fetch their own state. Detail mirrors the bulk-response shape so
 * subscribers can show toasts / badges without re-fetching.
 */
function emitDoneEvent(
	kind: 'restore' | 'purge' | 'empty',
	ok: unknown[],
	errors: Array< { id: number; code: string; message: string } >,
	affectedTypes: string[] = [],
	affectedIds: number[] = [],
): void {
	const detail = { kind, ok: ok.length, errors, source: 'local' as const };
	document.dispatchEvent(
		new CustomEvent( 'os-recycle-bin-changed', { detail } ),
	);

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( 'openstation.recycleBin.changed', detail );
	}

	// Cross-window broadcast — one topic per affected post type so
	// subscribers only hear about what they care about. A Posts
	// list iframe doesn't listen for `os.attachment.changed`,
	// the Media Library doesn't listen for `os.post.changed`.
	// The shell's built-in subscribers reload iframes whose URL
	// matches a known admin page for that post type; plugins can
	// register additional URL patterns or subscribe directly for
	// smarter repaints (e.g. patching `wp.data` instead of reloading).
	const api = window.wp?.os;
	if ( api && typeof api.broadcast === 'function' && affectedTypes.length > 0 ) {
		const action: 'untrashed' | 'deleted' = kind === 'restore' ? 'untrashed' : 'deleted';
		for ( const type of affectedTypes ) {
			// Topic fires per affected post type. Subscribers
			// (Posts list iframe, Media library iframe, plugin
			// listeners) only react to topics they care about.
			// We carry the full id list rather than splitting
			// by type — id matching at the subscriber side is
			// a best-effort filter, not a correctness gate.
			api.broadcast( `os.${ type }.changed`, {
				source: 'recycle-bin',
				action,
				ids: affectedIds,
			} );
		}
	}
}

const registry =
	( window.openStationNativeWindows ??
		( window.openStationNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'desktop-mode-recycle-bin' ] = ( body: HTMLElement ) => {
	renderRecycleBin( body );
};
