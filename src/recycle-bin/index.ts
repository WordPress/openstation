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
import { decodeHTML } from '../utils';
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
import { DESKTOP_THEME_CHANGED_EVENT } from '../desktop-themes/apply';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../desktop-themes/icons';
import { DESKTOP_THEME_SLOTS } from '../desktop-themes/slots';
import { setRecycleBinBadge } from './badge';
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

import type {
	OsTable,
	OsTableColumn,
} from '../ui/components/os-table/os-table';

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

export function mapRecycleTypeToFileType( recycleType: string ): string {
	if ( recycleType === 'attachment' ) {
		return 'attachment';
	}
	if ( recycleType === 'comment' ) {
		return 'comment';
	}
	// Every public post type collapses into the 'post' file type;
	// the desktop tile reads `postType` from the serialized shape
	// for label / icon if it wants to differentiate.
	return 'post';
}

/**
 * Inline-styled background tints for the type badge. Lives in JS
 * because `<os-table>` renders its body into a shadow DOM that
 * blocks document stylesheets — every visual property has to come
 * from inline `style.*` assignments. The palette is intentionally
 * desaturated so badges read as metadata, not as primary content.
 * Unknown types fall through to `_default`.
 */
const TYPE_BADGE_COLORS: Record< string, { bg: string; fg: string } > = {
	post: { bg: '#dbe9fe', fg: '#1d4ed8' },
	page: { bg: '#e0f2fe', fg: '#075985' },
	attachment: { bg: '#fef3c7', fg: '#92400e' },
	comment: { bg: '#dcfce7', fg: '#166534' },
	// The hued badges above are left alone deliberately — the colour
	// IS the type signal, and it survives on a dark row. Only the
	// neutral fallback follows the palette, because a grey-on-grey
	// chip carries no signal to preserve.
	_default: {
		bg: 'var( --os-ui-surface-sunken, #e5e7eb )',
		fg: 'var( --os-ui-fg-muted, #374151 )',
	},
};

function humanizeType( slug: string ): string {
	if ( ! slug ) {
		return '';
	}
	return slug
		.replace( /[_-]+/g, ' ' )
		.replace( /\b\w/g, ( c ) => c.toUpperCase() );
}

function makeTypeBadge( row: RecycleBinItem ): HTMLElement {
	const label =
		row.type_label && row.type_label.length > 0
			? row.type_label
			: humanizeType( row.type );
	const colors =
		TYPE_BADGE_COLORS[ row.type ] ?? TYPE_BADGE_COLORS._default;
	const badge = document.createElement( 'span' );
	badge.setAttribute( 'data-os-recycle-bin-type-badge', row.type );
	badge.textContent = label;
	badge.style.cssText = [
		'display: inline-flex',
		'align-items: center',
		'flex-shrink: 0',
		'padding: 2px 8px',
		'border-radius: 999px',
		'font-size: 11px',
		'font-weight: 600',
		'line-height: 1.4',
		'letter-spacing: 0.2px',
		'text-transform: uppercase',
		'white-space: nowrap',
		'background: ' + colors.bg,
		'color: ' + colors.fg,
	].join( ';' );
	return badge;
}

const ROOT = '[data-os-recycle-bin-root]';
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

/** Build the columns descriptor. Filterable via the public hook. */
function buildColumns(): OsTableColumn< RecycleBinItem >[] {
	const cols: OsTableColumn< RecycleBinItem >[] = [
		{
			key: 'title',
			label: __( 'Title' ),
			sortable: true,
			filter: 'text',
			render: ( _v, row ) => {
				// One-cell layout: optional thumbnail (image
				// attachments only) sits inline at the start, then
				// the two-line title/subtitle stack. A small type
				// badge sits inline before the title so each row
				// answers "what kind of thing is this?" without a
				// dedicated column. Posts, pages, comments get the
				// full title width since they have nothing to show
				// on the left — no reserved gap.
				const wrap = document.createElement( 'span' );
				wrap.style.cssText =
					'display:flex;align-items:center;gap:10px;min-width:0;';

				const showsThumb =
					row.preview &&
					row.type === 'attachment' &&
					row.mime.startsWith( 'image/' );
				if ( showsThumb ) {
					const img = document.createElement( 'img' );
					img.src = row.preview;
					img.alt = '';
					img.loading = 'lazy';
					img.style.cssText =
						'width:36px;height:36px;border-radius:4px;object-fit:cover;display:block;flex-shrink:0;';
					wrap.appendChild( img );
				}

				const stack = document.createElement( 'span' );
				stack.style.cssText =
					'display:flex;flex-direction:column;gap:2px;min-width:0;';
				const titleRow = document.createElement( 'span' );
				titleRow.style.cssText =
					'display:flex;align-items:center;gap:8px;min-width:0;';
				titleRow.appendChild( makeTypeBadge( row ) );
				const title = document.createElement( 'span' );
				title.style.cssText =
					'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;';
				const decodedTitle = decodeHTML( row.title );
				title.textContent = decodedTitle;
				title.title = decodedTitle;
				titleRow.appendChild( title );
				stack.appendChild( titleRow );
				if ( row.subtitle ) {
					const sub = document.createElement( 'span' );
					sub.style.cssText =
						'font-size:12px;color:var( --os-ui-fg-muted, #50575e );white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;';
					const decodedSubtitle = decodeHTML( row.subtitle );
					sub.textContent = decodedSubtitle;
					sub.title = decodedSubtitle;
					stack.appendChild( sub );
				}
				wrap.appendChild( stack );
				return wrap;
			},
		},
		// No explicit Type column — the inline type badge in the
		// title cell and the toolbar's type filter tabs already
		// convey the entity kind, and an extra column inflates the
		// row visually for no signal gain.
		{
			key: 'deleted_at',
			label: __( 'Deleted' ),
			sortable: true,
			width: '180px',
			sortValue: ( row ) => Date.parse( row.deleted_at + 'Z' ) || 0,
			render: ( _v, row ) => {
				// `<os-relative-time>` self-ticks every 30s on a
				// shared interval — no row-level repaint required to
				// roll "just now" → "1 minute ago" → "5 minutes ago".
				const el = document.createElement( 'os-relative-time' );
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
				// All wrapper styles inline — os-table renders
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
		// Mirror the PHP `openstation_recycle_bin_columns` extension
		// point on the JS side so plugins can append/replace columns
		// without forking the bundle.
		return hooks.applyFilters(
			'openstation.recycleBin.columns',
			cols,
		) as OsTableColumn< RecycleBinItem >[];
	}
	return cols;
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
 * `data-noclick` opts the button out of `os-table-row-click`,
 * and `e.stopPropagation()` keeps the click from bubbling up to
 * any other listener that might be watching the row container.
 */
/**
 * Inline SVG paths for the row-action icons.
 *
 * Why inline SVG instead of Dashicons spans: `<os-table>` renders
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
	// reaching this button — os-table's shadow DOM blocks both
	// the Dashicons stylesheet and our `recycle-bin.css`. So the
	// button carries every visual property on its `style` attribute,
	// and the icon is an inline SVG sized via attributes.
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.setAttribute( 'data-noclick', '' );
	btn.setAttribute( 'aria-label', opts.label );
	btn.title = opts.label;

	const isDanger = opts.variant === 'danger';

	// Every colour below is a `var()` against the shared palette with
	// the original literal as its fallback.
	//
	// These buttons are built by hand with INLINE styles rather than
	// as `<os-button>`s because `<os-table>` renders its body into a
	// shadow root that document stylesheets cannot reach. That is a
	// legitimate constraint — but it also meant the colours here were
	// unreachable by any theme, so the row actions stayed white-on-
	// white while the table around them went dark.
	//
	// Inline `var()` is the fix precisely BECAUSE custom properties
	// inherit through a shadow boundary: the token resolves against
	// the host even though the rule does not.
	const restColor = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-fg-muted, #50575e )';
	const restBorder = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-border, #c3c4c7 )';
	const restBg = 'var( --os-ui-surface, #fff )';

	// Single source of truth for visual state. Hover/leave swap
	// the relevant inline properties — cheap, predictable, no
	// CSS-rule cascade to debug.
	const applyRest = (): void => {
		btn.style.background = restBg;
		btn.style.color = restColor;
		btn.style.borderColor = restBorder;
	};
	const applyHover = (): void => {
		if ( isDanger ) {
			btn.style.background = 'var( --os-ui-danger, #d63638 )';
			btn.style.color = 'var( --os-ui-fg-on-accent, #fff )';
			btn.style.borderColor = 'var( --os-ui-danger, #d63638 )';
		} else {
			btn.style.background = 'var( --os-ui-hover, #f0f0f1 )';
			btn.style.color = 'var( --os-ui-fg, #1d2327 )';
			btn.style.borderColor = 'var( --os-ui-border-strong, #8c8f94 )';
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
		'background: ' + restBg,
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

	// Desktop-theme override for the row-action glyph.
	//
	// Rendered as an 18x18 CSS MASK tinted with `currentColor`, not
	// as an `<img>`. These buttons swap their colour on hover / focus
	// and the danger variant goes red; an image would be blind to all
	// of that. Same trade-off as `<os-window-button icon-src>`: the
	// glyph is a monochrome silhouette.
	//
	// A theme that maps the slot to a DASHICON is ignored here on
	// purpose — `<os-table>` renders into its own shadow root, which
	// the global Dashicons stylesheet cannot reach, so the span would
	// come out blank. The built-in SVG below is a better answer than
	// an empty button.
	const themedSlot =
		opts.icon === 'restore'
			? DESKTOP_THEME_SLOTS.RECYCLE_RESTORE
			: DESKTOP_THEME_SLOTS.RECYCLE_DELETE;
	const themed = resolveThemedIcon( themedSlot );
	// A theme may name the fill. Unset, `currentColor` keeps the
	// button's hover / danger tinting working, which is the default
	// these two slots have always had.
	const themedFill = resolveThemedIconColor( themedSlot ) ?? 'currentColor';
	// The value is interpolated into a `url("…")` inside an inline
	// `style`, so it must not be able to close that string or the
	// attribute. Same reasoning (and same character set) as
	// `sanitizeIconSrc` in `<os-window-button>`; a rejected value
	// falls through to the built-in SVG below.
	const maskSafe =
		themed !== null &&
		! themed.startsWith( 'dashicons-' ) &&
		/^(https?:\/\/|data:image\/)/i.test( themed ) &&
		! /['"()\\<>\s]/.test( themed );

	if ( maskSafe ) {
		const mask = document.createElement( 'span' );
		mask.setAttribute( 'aria-hidden', 'true' );
		mask.style.cssText = [
			'display: block',
			'width: 18px',
			'height: 18px',
			'flex-shrink: 0',
			`background-color: ${ themedFill }`,
			`-webkit-mask: url("${ themed }") center / contain no-repeat`,
			`mask: url("${ themed }") center / contain no-repeat`,
		].join( ';' );
		btn.appendChild( mask );
	} else {
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
	}

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

	table.columns = buildColumns();
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
				// data-driven change hid it behind an active column
				// filter. `collectSelectedItems()` already resolves
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
	// `type` — bulk handlers send `[{id, type}]` to the server. Keys
	// are the composite `type:id` produced by getRowId above; matching
	// on the bare numeric id would fan one selected row out to every
	// same-id row of another type.
	//
	// Resolve against the VISIBLE rows, not the full `data` buffer:
	// a data-driven change (e.g. a realtime refresh replacing a row
	// whose new title no longer matches an active Title column filter)
	// can hide a selected row without any filter event firing — and a
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
				setRecycleBinBadge( 0 );
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

	// The Title / "By" columns declare client-side `filter: 'text'`
	// filters. A row ticked BEFORE the user types into one stays
	// selected while hidden — and it's still in `table.data`, so
	// `collectSelectedItems()` would sweep it into a bulk purge the
	// user can't see coming. Same hygiene as the toolbar filter /
	// search: any visibility change starts with a clean selection.
	table.addEventListener( 'os-table-filter-change', () => {
		table.clearSelection();
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
