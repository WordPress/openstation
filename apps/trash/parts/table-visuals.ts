import { __ } from '../../../src/i18n';
import { decodeHTML } from '../../../src/utils';

import '../../../src/ui/components/os-relative-time/os-relative-time';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../../../src/desktop-themes/icons';
import { DESKTOP_THEME_SLOTS } from '../../../src/desktop-themes/slots';
import { makeRowActionButton } from '../../../src/ui/util/row-action-button';
import type { RecycleBinItem, RecycleBinItemRef } from './types';
import type { OsTableColumn } from '../../../src/ui/components/os-table/os-table';

export function mapRecycleTypeToFileType( recycleType: string ): string {
	if ( recycleType === 'attachment' ) {
		return 'attachment';
	}
	if ( recycleType === 'comment' ) {
		return 'comment';
	}

	return 'post';
}

const TYPE_BADGE_COLORS: Record< string, { bg: string; fg: string } > = {
	post: { bg: '#dbe9fe', fg: '#1d4ed8' },
	page: { bg: '#e0f2fe', fg: '#075985' },
	attachment: { bg: '#fef3c7', fg: '#92400e' },
	comment: { bg: '#dcfce7', fg: '#166534' },

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

	labelled?: boolean;
}

const ICON_SVG: Record< string, string > = {
	restore:
		'<path d="M12 5V2L7 6l5 4V7c2.76 0 5 2.24 5 5 0 .83-.21 1.61-.57 2.3l1.46 1.46A6.96 6.96 0 0 0 19 12c0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5 0-.83.21-1.61.57-2.3L6.11 8.24A6.96 6.96 0 0 0 5 12c0 3.87 3.13 7 7 7v3l5-4-5-4v3z" fill="currentColor"/>',
	trash:
		'<path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" fill="currentColor"/>',
};

export function makeRowButton( opts: RowButtonOptions ): HTMLElement {
	const themedSlot =
		opts.icon === 'restore'
			? DESKTOP_THEME_SLOTS.RECYCLE_RESTORE
			: DESKTOP_THEME_SLOTS.RECYCLE_DELETE;
	const themed = resolveThemedIcon( themedSlot );
	const themedFill = resolveThemedIconColor( themedSlot ) ?? 'currentColor';

	const maskSafe =
		themed !== null &&
		! themed.startsWith( 'dashicons-' ) &&
		/^(https?:\/\/|data:image\/)/i.test( themed ) &&
		! /['"()\\<>\s]/.test( themed );

	let glyph: Element;
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
		glyph = mask;
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
		glyph = svg;
	}

	return makeRowActionButton( {
		label: opts.label,
		glyph,
		onClick: opts.onClick,
		variant: opts.variant,
		labelled: opts.labelled,
	} );
}

export interface RowActionHandlers {
	onRestore: ( ref: RecycleBinItemRef ) => void;
	onPurge: ( ref: RecycleBinItemRef ) => void;
}

export interface ColumnOptions {

	phone?: boolean;
}

export function buildColumns(
	handlers: RowActionHandlers,
	options: ColumnOptions = {},
): OsTableColumn< RecycleBinItem >[] {
	const phone = options.phone === true;
	const titleStyle = phone
		? 'font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;'
		: 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;';
	const cols: OsTableColumn< RecycleBinItem >[] = [
		{
			key: 'title',
			label: __( 'Title' ),
			sortable: true,
			stack: 'title',
			render: ( _v, row ) => {
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
				title.style.cssText = titleStyle;
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

		{
			key: 'deleted_at',
			label: __( 'Deleted' ),
			sortable: true,
			stack: 'meta',
			width: '180px',
			sortValue: ( row ) => Date.parse( row.deleted_at + 'Z' ) || 0,
			render: ( _v, row ) => {
				const el = document.createElement( 'os-relative-time' );
				el.setAttribute( 'datetime', row.deleted_at );
				return el;
			},
		},
		{
			key: 'deleted_by',
			label: __( 'By' ),
			sortable: true,
			stack: 'meta',
			width: '160px',
			render: ( _v, row ) => decodeHTML( row.deleted_by ?? '' ) || '—',
		},
		{
			key: '__actions',
			label: '',
			stack: 'actions',
			width: '96px',
			align: 'end',
			render: ( _v, row ) => {
				const wrap = document.createElement( 'span' );
				wrap.style.cssText = phone
					? 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;line-height:1;'
					: 'display:inline-flex;gap:4px;justify-content:flex-end;align-items:center;flex-wrap:nowrap;white-space:nowrap;line-height:1;';
				if ( row.can_restore ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Restore' ),
						icon: 'restore',
						labelled: phone,
						onClick: () =>
							handlers.onRestore( { id: row.id, type: row.type } ),
					} ) );
				}
				if ( row.can_purge ) {
					wrap.appendChild( makeRowButton( {
						label: __( 'Delete forever' ),
						icon: 'trash',
						variant: 'danger',
						labelled: phone,
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
