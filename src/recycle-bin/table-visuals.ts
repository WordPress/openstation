/**
 * Recycle Bin — the table's cell visuals.
 *
 * The Trash app (`apps/trash/trash.os.ts`) paints its rows through
 * these: type badge, title stack with optional thumbnail, relative
 * deleted-at, and the restore / delete-forever row buttons. Kept as
 * a leaf (they were shared verbatim with the legacy window this app
 * replaced) because the hard-won shadow-DOM constraints belong in
 * one place: `<os-table>` renders its body into its own shadow root,
 * so nothing here may rely on a document stylesheet (every visual
 * property is an inline `style.*`, colours are inline `var()` chains
 * that inherit THROUGH the boundary, and icons are inline SVG
 * because the Dashicons stylesheet cannot reach in).
 *
 * @public
 */

import { __ } from '../i18n';
import { decodeHTML } from '../utils';
// Side-effect import — the deleted-at column constructs
// `<os-relative-time>`, so every bundle shipping these renderers
// must register it. `defineComponent` is idempotent.
import '../ui/components/os-relative-time/os-relative-time';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../desktop-themes/icons';
import { DESKTOP_THEME_SLOTS } from '../desktop-themes/slots';
import type { RecycleBinItem, RecycleBinItemRef } from './types';
import type { OsTableColumn } from '../ui/components/os-table/os-table';

/**
 * Map a recycle-bin row's `type` (post/page/CPT/attachment/comment)
 * to the Files-on-the-Desktop file-type slug. Used by the
 * "Pin to desktop" toolbar action.
 */
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

export function makeTypeBadge( row: RecycleBinItem ): HTMLElement {
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

export interface RowButtonOptions {
	label: string;
	icon: string;
	onClick: () => void;
	variant?: string;
}

/**
 * Inline SVG paths for the row-action icons.
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

/**
 * Build a row-action button: icon + hidden label, every visual
 * property inline, click bound in place with propagation stopped
 * (`data-noclick` opts it out of `os-table-row-click`). Colours are
 * inline `var()` chains so themes reach through the table's shadow
 * boundary; hover / focus swap the relevant properties directly.
 */
export function makeRowButton( opts: RowButtonOptions ): HTMLElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.setAttribute( 'data-noclick', '' );
	btn.setAttribute( 'aria-label', opts.label );
	btn.title = opts.label;

	const isDanger = opts.variant === 'danger';

	const restColor = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-fg-muted, #50575e )';
	const restBorder = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-border, #c3c4c7 )';
	const restBg = 'var( --os-ui-surface, #fff )';

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

	// Desktop-theme override for the glyph, rendered as an 18x18 CSS
	// MASK tinted with `currentColor` so hover / danger tinting keeps
	// working. A theme that maps the slot to a DASHICON is ignored on
	// purpose — the Dashicons stylesheet cannot reach into the
	// table's shadow root, so the span would come out blank.
	const themedSlot =
		opts.icon === 'restore'
			? DESKTOP_THEME_SLOTS.RECYCLE_RESTORE
			: DESKTOP_THEME_SLOTS.RECYCLE_DELETE;
	const themed = resolveThemedIcon( themedSlot );
	const themedFill = resolveThemedIconColor( themedSlot ) ?? 'currentColor';
	// The value lands inside url("…") in an inline style, so it must
	// not be able to close that string or the attribute.
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

export interface RowActionHandlers {
	onRestore: ( ref: RecycleBinItemRef ) => void;
	onPurge: ( ref: RecycleBinItemRef ) => void;
}

/**
 * Build the columns descriptor both bins share. Filterable via the
 * public `openstation.recycleBin.columns` JS hook, mirroring the PHP
 * `openstation_recycle_bin_columns` extension point.
 */
export function buildColumns(
	handlers: RowActionHandlers,
): OsTableColumn< RecycleBinItem >[] {
	const cols: OsTableColumn< RecycleBinItem >[] = [
		{
			key: 'title',
			label: __( 'Title' ),
			sortable: true,
			render: ( _v, row ) => {
				// One-cell layout: optional thumbnail (image
				// attachments only) inline at the start, then the
				// two-line title/subtitle stack with a small type
				// badge before the title.
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
		// convey the entity kind.
		{
			key: 'deleted_at',
			label: __( 'Deleted' ),
			sortable: true,
			width: '180px',
			sortValue: ( row ) => Date.parse( row.deleted_at + 'Z' ) || 0,
			render: ( _v, row ) => {
				// `<os-relative-time>` self-ticks every 30s on a
				// shared interval — no row-level repaint required.
				const el = document.createElement( 'os-relative-time' );
				el.setAttribute( 'datetime', row.deleted_at );
				return el;
			},
		},
		{
			key: 'deleted_by',
			label: __( 'By' ),
			sortable: true,
			width: '160px',
			render: ( _v, row ) => row.deleted_by || '—',
		},
		{
			key: '__actions',
			label: '',
			width: '96px',
			align: 'end',
			render: ( _v, row ) => {
				const wrap = document.createElement( 'span' );
				wrap.style.cssText =
					'display:inline-flex;gap:4px;justify-content:flex-end;align-items:center;flex-wrap:nowrap;white-space:nowrap;line-height:1;';
				if ( row.can_restore ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Restore' ),
						icon: 'restore',
						onClick: () =>
							handlers.onRestore( { id: row.id, type: row.type } ),
					} ) );
				}
				if ( row.can_purge ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Delete forever' ),
						icon: 'trash',
						variant: 'danger',
						onClick: () =>
							handlers.onPurge( { id: row.id, type: row.type } ),
					} ) );
				}
				return wrap;
			},
		},
	];

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.applyFilters === 'function' ) {
		return hooks.applyFilters(
			'openstation.recycleBin.columns',
			cols,
		) as OsTableColumn< RecycleBinItem >[];
	}
	return cols;
}
