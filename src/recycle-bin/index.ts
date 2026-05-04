/**
 * Desktop Mode — Recycle Bin window.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `wpdm-recycle-bin` window opens. Wires up the toolbar (filter,
 * search, refresh, bulk actions, empty), populates the `<wpd-table>`
 * from the REST list endpoint, and persists nothing locally — every
 * action is a roundtrip + reload so the table never lies about
 * server state.
 *
 * The `<wpd-*>` web components are defined by the main desktop
 * bundle; this module only consumes them. We therefore avoid any
 * side-effect imports from `src/ui/` so loading this bundle never
 * tries to re-`customElements.define()` an existing tag.
 *
 * @public
 * @since 0.19.0
 */

import { __, sprintf } from '../i18n';
import { setRecycleBinBadge } from './badge';
import * as realtime from './realtime';
import {
	emptyBin,
	fetchList,
	purgeItems,
	restoreItems,
	type RecycleBinItem,
	type RecycleBinItemRef,
} from './rest';

import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const ROOT = '[data-wpdm-recycle-bin-root]';
const FILTER = '[data-wpdm-recycle-bin-filter]';
const SEARCH = '[data-wpdm-recycle-bin-search]';
const REFRESH = '[data-wpdm-recycle-bin-refresh]';
const TABLE = '[data-wpdm-recycle-bin-table]';
const BULK = '[data-wpdm-recycle-bin-bulk]';
const COUNT = '[data-wpdm-recycle-bin-count]';
const RESTORE_SEL = '[data-wpdm-recycle-bin-restore-selected]';
const PURGE_SEL = '[data-wpdm-recycle-bin-purge-selected]';
const EMPTY_BTN = '[data-wpdm-recycle-bin-empty]';

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
 * `table.data = …` assignment and the wpd-table body repaint
 * that comes with it.
 */
function itemsFingerprint( items: RecycleBinItem[] ): string {
	if ( items.length === 0 ) {
		return '';
	}
	// Sort first — server order can vary on ties (same `modified`
	// timestamp). Comparing the sorted projection makes the
	// fingerprint stable against ordering churn.
	const parts = items
		.map( ( i ) => `${ i.id }:${ i.deleted_at }` )
		.sort();
	return parts.join( '|' );
}

/** Per-window state. Re-created on every render() call. */
interface BinState {
	filter: '' | 'post' | 'page' | 'attachment' | 'comment';
	search: string;
	searchDebounce: number | null;
}

/** Build the columns descriptor. Filterable via the public hook. */
function buildColumns(): WpdTableColumn< RecycleBinItem >[] {
	const cols: WpdTableColumn< RecycleBinItem >[] = [
		{
			key: 'preview',
			label: '',
			width: '52px',
			render: ( _v, row ) => {
				// Custom cell renders land inside `<wpd-table>`'s
				// shadow DOM, so the global Dashicons stylesheet
				// doesn't reach them. We show an actual thumbnail
				// when there is one, otherwise leave the cell
				// empty — the type column already communicates
				// "post / page / media" in text.
				if (
					row.preview &&
					row.type === 'attachment' &&
					row.mime.startsWith( 'image/' )
				) {
					const img = document.createElement( 'img' );
					img.src = row.preview;
					img.alt = '';
					img.loading = 'lazy';
					img.style.cssText =
						'width:36px;height:36px;border-radius:4px;object-fit:cover;display:block;';
					return img;
				}
				const empty = document.createElement( 'span' );
				empty.style.cssText = 'display:inline-block;width:36px;height:36px;';
				return empty;
			},
		},
		{
			key: 'title',
			label: __( 'Title' ),
			sortable: true,
			filter: 'text',
			render: ( _v, row ) => {
				// Two-line title cell. All visual styles inline so
				// we don't depend on outer CSS reaching past the
				// `<wpd-table>` shadow boundary.
				const cell = document.createElement( 'span' );
				cell.style.cssText =
					'display:flex;flex-direction:column;gap:2px;min-width:0;';
				const title = document.createElement( 'span' );
				title.style.cssText =
					'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;';
				title.textContent = row.title;
				title.title = row.title;
				cell.appendChild( title );
				if ( row.subtitle ) {
					const sub = document.createElement( 'span' );
					sub.style.cssText =
						'font-size:12px;color:#50575e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;';
					sub.textContent = row.subtitle;
					sub.title = row.subtitle;
					cell.appendChild( sub );
				}
				return cell;
			},
		},
		{
			key: 'type',
			label: __( 'Type' ),
			sortable: true,
			filter: 'select',
			width: '120px',
			render: ( _v, row ) => labelForType( row.type ),
		},
		{
			key: 'deleted_at',
			label: __( 'Deleted' ),
			sortable: true,
			width: '180px',
			sortValue: ( row ) => Date.parse( row.deleted_at + 'Z' ) || 0,
			render: ( _v, row ) => {
				// `<wpd-relative-time>` self-ticks every 30s on a
				// shared interval — no row-level repaint required to
				// roll "just now" → "1 minute ago" → "5 minutes ago".
				const el = document.createElement( 'wpd-relative-time' );
				el.setAttribute( 'datetime', row.deleted_at );
				return el;
			},
		},
		{
			key: 'deleted_by',
			label: __( 'By' ),
			sortable: true,
			filter: 'text',
			width: '160px',
			render: ( _v, row ) => row.deleted_by || '—',
		},
		{
			key: '__actions',
			label: '',
			width: '96px',
			align: 'end',
			render: ( _v, row ) => {
				// All wrapper styles inline — wpd-table renders
				// into its own shadow DOM, so my recycle-bin.css
				// can't reach this node. Direct click binding
				// instead of body delegation (delegation lost
				// races with web-component stop-propagation).
				const wrap = document.createElement( 'span' );
				wrap.style.cssText =
					'display:inline-flex;gap:4px;justify-content:flex-end;align-items:center;flex-wrap:nowrap;white-space:nowrap;line-height:1;';
				if ( row.can_restore ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Restore' ),
						icon: 'restore',
						onClick: () =>
							rowActionRestore( { id: row.id, type: row.type } ),
					} ) );
				}
				if ( row.can_purge ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Delete forever' ),
						icon: 'trash',
						variant: 'danger',
						onClick: () =>
							rowActionPurge( { id: row.id, type: row.type } ),
					} ) );
				}
				return wrap;
			},
		},
	];

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.applyFilters === 'function' ) {
		// Mirror the PHP `desktop_mode_recycle_bin_columns` extension
		// point on the JS side so plugins can append/replace columns
		// without forking the bundle.
		return hooks.applyFilters(
			'wp_desktop.recycleBin.columns',
			cols,
		) as WpdTableColumn< RecycleBinItem >[];
	}
	return cols;
}

function labelForType( type: string ): string {
	switch ( type ) {
		case 'post':
			return __( 'Post' );
		case 'page':
			return __( 'Page' );
		case 'attachment':
			return __( 'Media' );
		case 'comment':
			return __( 'Comment' );
		default:
			return type;
	}
}

interface RowButtonOptions {
	label: string;
	icon: string;
	onClick: () => void;
	variant?: string;
}

/**
 * Build a row-action button. Renders icon + visible label so
 * single-icon collapse (which gave the "two pills" misrender) is
 * impossible, and binds the click handler in place — no body-
 * level delegation, no `data-` attribute coupling.
 *
 * `data-noclick` opts the button out of `wpd-table-row-click`,
 * and `e.stopPropagation()` keeps the click from bubbling up to
 * any other listener that might be watching the row container.
 */
/**
 * Inline SVG paths for the row-action icons.
 *
 * Why inline SVG instead of Dashicons spans: `<wpd-table>` renders
 * its body into its OWN shadow DOM (`shadow = true`), so any node
 * we return from a `column.render` callback ends up inside that
 * shadow boundary. Document-level stylesheets do not cross the
 * boundary — neither the global Dashicons CSS nor our own
 * `recycle-bin.css`. The result: Dashicons spans render empty,
 * outer height/width rules are ignored, and the button collapses.
 *
 * Inline SVG renders from its own attributes (no stylesheet
 * needed), and we apply every visual style as inline `style.*`
 * properties so the button is fully self-contained.
 *
 * 24×24 viewBox is the Dashicons grid; these paths are simplified
 * versions of the actual `dashicons-image-rotate` and
 * `dashicons-trash` glyphs — close enough that users recognise
 * them, simple enough to ship inline.
 */
const ICON_SVG: Record< string, string > = {
	restore:
		'<path d="M12 5V2L7 6l5 4V7c2.76 0 5 2.24 5 5 0 .83-.21 1.61-.57 2.3l1.46 1.46A6.96 6.96 0 0 0 19 12c0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5 0-.83.21-1.61.57-2.3L6.11 8.24A6.96 6.96 0 0 0 5 12c0 3.87 3.13 7 7 7v3l5-4-5-4v3z" fill="currentColor"/>',
	trash:
		'<path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" fill="currentColor"/>',
};

function makeRowButton( opts: RowButtonOptions ): HTMLElement {
	// Inline SVG + inline styles. We can't depend on outer CSS
	// reaching this button — wpd-table's shadow DOM blocks both
	// the Dashicons stylesheet and our `recycle-bin.css`. So the
	// button carries every visual property on its `style` attribute,
	// and the icon is an inline SVG sized via attributes.
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.setAttribute( 'data-noclick', '' );
	btn.setAttribute( 'aria-label', opts.label );
	btn.title = opts.label;

	const isDanger = opts.variant === 'danger';
	const restColor = isDanger ? '#d63638' : '#50575e';
	const restBorder = isDanger ? '#d63638' : '#c3c4c7';

	// Single source of truth for visual state. Hover/leave swap
	// the relevant inline properties — cheap, predictable, no
	// CSS-rule cascade to debug.
	const applyRest = (): void => {
		btn.style.background = '#fff';
		btn.style.color = restColor;
		btn.style.borderColor = restBorder;
	};
	const applyHover = (): void => {
		if ( isDanger ) {
			btn.style.background = '#d63638';
			btn.style.color = '#fff';
			btn.style.borderColor = '#d63638';
		} else {
			btn.style.background = '#f0f0f1';
			btn.style.color = '#1d2327';
			btn.style.borderColor = '#8c8f94';
		}
	};

	btn.style.cssText = [
		'display: inline-flex',
		'align-items: center',
		'justify-content: center',
		'flex: 0 0 30px',
		'width: 30px',
		'height: 30px',
		'padding: 0',
		'margin: 0',
		'border: 1px solid ' + restBorder,
		'border-radius: 6px',
		'background: #fff',
		'color: ' + restColor,
		'cursor: pointer',
		'box-sizing: border-box',
		'line-height: 1',
		'font: inherit',
		'transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease',
	].join( ';' );

	btn.addEventListener( 'mouseenter', applyHover );
	btn.addEventListener( 'mouseleave', applyRest );
	btn.addEventListener( 'focus', applyHover );
	btn.addEventListener( 'blur', applyRest );

	const svgNs = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS( svgNs, 'svg' );
	svg.setAttribute( 'width', '18' );
	svg.setAttribute( 'height', '18' );
	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.setAttribute( 'focusable', 'false' );
	svg.style.display = 'block';
	svg.innerHTML = ICON_SVG[ opts.icon ] ?? '';
	btn.appendChild( svg );

	btn.addEventListener( 'click', ( e: Event ) => {
		e.stopPropagation();
		opts.onClick();
	} );

	return btn;
}

/**
 * Render entry point. The shell hands us a mounted body element on
 * every open; we own everything inside it for the lifetime of the
 * window. Closing tears down the element entirely so we don't need
 * a separate cleanup path.
 */
export function renderRecycleBin( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >( ROOT );
	const table = body.querySelector< WpdTable< RecycleBinItem > >( TABLE );
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

	table.columns = buildColumns();
	table.getRowId = ( row ) => row.id;

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
			setRecycleBinBadge( total );
		} catch ( err ) {
			if ( mySeq !== refreshSeq ) {
				return;
			}
			console.error( '[recycle-bin] list failed', err );
			// On the first-load failure with no cache, render an
			// empty table so the slotted empty state shows. On
			// subsequent failures with a cache, keep stale data —
			// better UX than flashing "empty" because the network
			// blipped.
			if ( showSkeleton ) {
				table.data = [];
				currentFingerprint = '';
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
	// `type` — bulk handlers send `[{id, type}]` to the server.
	const collectSelectedItems = (): RecycleBinItemRef[] => {
		const sel = Array.from( table.selection ?? [] );
		const idSet = new Set( sel.map( ( id ) => Number( id ) ) );
		const out: RecycleBinItemRef[] = [];
		for ( const row of table.data ?? [] ) {
			if ( idSet.has( row.id ) ) {
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

	const handlePurge = async (
		refs: RecycleBinItemRef[],
	): Promise< void > => {
		if ( refs.length === 0 ) {
			return;
		}
		// eslint-disable-next-line no-alert
		const ok = window.confirm(
			sprintf(
				/* translators: %d: row count. */
				__( 'Permanently delete %d item(s)? This cannot be undone.' ),
				refs.length,
			),
		);
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

	const handleEmpty = async (): Promise< void > => {
		// eslint-disable-next-line no-alert
		const ok = window.confirm(
			__(
				'Empty the recycle bin? Every item visible in the current view will be permanently deleted.',
			),
		);
		if ( ! ok ) {
			return;
		}
		// Empty fans out across whatever the user can see — assume
		// every tracked type is potentially affected.
		const allTypes = Array.from(
			new Set( ( table.data ?? [] ).map( ( r ) => r.type ) ),
		);
		try {
			const result = await emptyBin();
			emitDoneEvent(
				'empty',
				new Array( result.purged ).fill( 0 ),
				result.skipped > 0
					? [ {
						id: 0,
						code: 'wpdm_recycle_bin_skipped',
						message: sprintf(
							/* translators: %d: skipped count. */
							__( '%d item(s) skipped (insufficient permissions).' ),
							result.skipped,
						),
					} ]
					: [],
				allTypes,
				[],
			);
		} catch ( err ) {
			console.error( '[recycle-bin] empty failed', err );
		}
		await refresh();
	};

	// --- Toolbar wiring -----------------------------------------------

	root.querySelector( FILTER )?.addEventListener( 'wpd-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: string } > ).detail;
		state.filter = ( detail?.value ?? '' ) as BinState[ 'filter' ];
		void refresh();
	} );

	const search = root.querySelector< HTMLElement >( SEARCH );
	search?.addEventListener( 'wpd-input-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		state.search = value;
		if ( state.searchDebounce !== null ) {
			window.clearTimeout( state.searchDebounce );
		}
		state.searchDebounce = window.setTimeout( () => {
			void refresh();
		}, 250 );
	} );

	// Body-level click delegation for every toolbar action. Direct
	// element-bound listeners on `<wpd-button>` were proving
	// flaky — the click event was reaching the host but my handler
	// wasn't firing reliably for the bulk Restore button. Body
	// delegation walks `closest()` from the click target, so we
	// catch the click no matter how deeply the wpd-button shadow
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
		if ( target.closest( PURGE_SEL ) ) {
			void handlePurge( collectSelectedItems() );
			return;
		}
		if ( target.closest( EMPTY_BTN ) ) {
			void handleEmpty();
		}
	} );

	// --- Table wiring -------------------------------------------------

	table.addEventListener( 'wpd-table-selection-change', () => {
		refreshBulkBar();
	} );

	// Default sort: most-recently-deleted first. Users can change it.
	table.sort = { key: 'deleted_at', direction: 'desc' };

	// Real-time updates while the window is open. Both the
	// chromeless-iframe fast path and the heartbeat catch-all path
	// dispatch `wp-desktop-recycle-bin-changed` on document — we
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
	document.addEventListener( 'wp-desktop-recycle-bin-changed', onExternalChange );

	// Subscribe to the per-domain broadcast topics — when a post,
	// page, or attachment is mutated anywhere in the shell (list-
	// table trash, REST DELETE, Gutenberg "Move to trash") we get
	// notified through the broadcast bus and refresh. This is the
	// instant complement to the heartbeat catch-all.
	const broadcastUnsubs: Array< () => void > = [];
	const api = window.wp?.desktop;
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
		broadcastUnsubs.push(
			api.subscribe( 'wp-desktop.post.changed', onDomainChanged ),
			api.subscribe( 'wp-desktop.page.changed', onDomainChanged ),
			api.subscribe( 'wp-desktop.attachment.changed', onDomainChanged ),
			api.subscribe( 'wp-desktop.comment.changed', onDomainChanged ),
		);
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
		if ( detail?.windowId !== 'wpdm-recycle-bin' ) {
			return;
		}
		realtime.stop();
		document.removeEventListener(
			'wp-desktop-recycle-bin-changed',
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
		document.removeEventListener( 'wp-desktop-window-closed', onWindowClosed );
	};
	document.addEventListener( 'wp-desktop-window-closed', onWindowClosed );

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
		new CustomEvent( 'wp-desktop-recycle-bin-changed', { detail } ),
	);

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( 'wp_desktop.recycleBin.changed', detail );
	}

	// Cross-window broadcast — one topic per affected post type so
	// subscribers only hear about what they care about. A Posts
	// list iframe doesn't listen for `wp-desktop.attachment.changed`,
	// the Media Library doesn't listen for `wp-desktop.post.changed`.
	// The shell's built-in subscribers reload iframes whose URL
	// matches a known admin page for that post type; plugins can
	// register additional URL patterns or subscribe directly for
	// smarter repaints (e.g. patching `wp.data` instead of reloading).
	const api = window.wp?.desktop;
	if ( api && typeof api.broadcast === 'function' && affectedTypes.length > 0 ) {
		const action: 'untrashed' | 'deleted' = kind === 'restore' ? 'untrashed' : 'deleted';
		for ( const type of affectedTypes ) {
			// Topic fires per affected post type. Subscribers
			// (Posts list iframe, Media library iframe, plugin
			// listeners) only react to topics they care about.
			// We carry the full id list rather than splitting
			// by type — id matching at the subscriber side is
			// a best-effort filter, not a correctness gate.
			api.broadcast( `wp-desktop.${ type }.changed`, {
				source: 'recycle-bin',
				action,
				ids: affectedIds,
			} );
		}
	}
}

const registry =
	( window.wpDesktopNativeWindows ??
		( window.wpDesktopNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'wpdm-recycle-bin' ] = ( body: HTMLElement ) => {
	renderRecycleBin( body );
};
