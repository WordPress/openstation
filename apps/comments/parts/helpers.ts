import { __, html, type TemplateResult } from '@openstation/app';
import { pickAvatarUrl } from '../../../src/ui/util/avatar-resolve';
import { adminBaseUrl as adminUrl, decodeHTML } from '../../../src/utils';

export { adminUrl, pickAvatarUrl };
import type { BulkAction, CommentRow, UiState } from './types';

export const NS = 'os-comments';

export function normalizeStatus( row: CommentRow ): string {
	const s = String( row.status );
	if ( s === 'approve' || s === 'approved' || s === '1' ) {
		return 'approved';
	}
	if ( s === 'hold' || s === '0' || s === 'unapproved' ) {
		return 'hold';
	}
	return s;
}

export function statusLabel( status: string ): string {
	switch ( status ) {
		case 'approved':
			return __( 'Approved' );
		case 'hold':
			return __( 'Pending' );
		case 'spam':
			return __( 'Spam' );
		case 'trash':
			return __( 'Trash' );
		default:
			return status;
	}
}

export function statusTone( status: string ): string {
	switch ( status ) {
		case 'approved':
			return 'success';
		case 'hold':
			return 'warning';
		case 'spam':
			return 'danger';
		default:
			return 'neutral';
	}
}

export function statusBadge( status: string, dotOnly = false ): TemplateResult {
	const label = statusLabel( status );
	if ( dotOnly ) {
		return html`<os-badge class="${ NS }__status" tone=${ statusTone( status ) } title=${ label }>
			<span class="screen-reader-text">${ label }</span>
		</os-badge>`;
	}
	return html`<os-badge class="${ NS }__msg-status" tone=${ statusTone( status ) }>${ label }</os-badge>`;
}

export function timestamp( gmt: string, className: string, compact = false ): TemplateResult {
	return html`<os-relative-time class=${ className } datetime=${ gmt } ?compact=${ compact }></os-relative-time>`;
}

export function plainText( row: CommentRow ): string {
	if ( typeof row.content?.raw === 'string' ) {
		return row.content.raw;
	}
	return decodeHTML( ( row.content?.rendered ?? '' ).replace( /<[^>]*>/g, ' ' ) );
}

export function snippet( row: CommentRow ): string {
	return plainText( row ).replace( /\s+/g, ' ' ).trim();
}

export function authorName( row: CommentRow | undefined ): string {
	return decodeHTML( row?.author_name ?? '' ) || __( 'Anonymous' );
}

export function avatar( row: CommentRow, size: number ): TemplateResult {
	const url = pickAvatarUrl( row.author_avatar_urls );
	return html`<os-avatar
		class="${ NS }__disc"
		name=${ decodeHTML( row.author_name ?? '' ) || '?' }
		size=${ size }
		alt=""
		data-avatar-src=${ url }
	></os-avatar>`;
}

export function externalIcon(): TemplateResult {
	return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="${ NS }__ext-icon">
		<path d="M19.5 4.5h-7V6h4.44l-5.97 5.97 1.06 1.06L18 7.06v4.44h1.5v-7Z"></path>
		<path d="M18 18v-5h1.5v5c0 .83-.67 1.5-1.5 1.5H6c-.83 0-1.5-.67-1.5-1.5V6c0-.83.67-1.5 1.5-1.5h5V6H6v12h12Z"></path>
	</svg>`;
}

export function emptyState( icon: string, heading: string, description = '' ): TemplateResult {
	return html`<os-empty-state
		class="${ NS }__placeholder"
		icon=${ icon }
		heading=${ heading }
		description=${ description }
	></os-empty-state>`;
}

export const DESTRUCTIVE: Partial<
	Record< BulkAction, { title: string; message: string; label: string; danger: boolean } >
> = {
	spam: {
		title: __( 'Mark as spam?' ),
		message: __(
			'This comment moves out of the conversation. You can restore it from the Spam tab.',
		),
		label: __( 'Mark as spam' ),
		danger: true,
	},
	trash: {
		title: __( 'Move to trash?' ),
		message: __(
			'This comment moves out of the conversation. You can restore it from the Trash tab.',
		),
		label: __( 'Move to trash' ),
		danger: true,
	},
};

export function actionResultLabel( action: BulkAction ): string {
	switch ( action ) {
		case 'approve':
			return __( 'Comment approved.' );
		case 'unapprove':
			return __( 'Comment unapproved.' );
		case 'spam':
			return __( 'Comment marked as spam.' );
		case 'unspam':
			return __( 'Comment restored from spam.' );
		case 'trash':
			return __( 'Comment moved to trash.' );
		case 'untrash':
			return __( 'Comment restored from trash.' );
	}
}

export function buildTree( rows: CommentRow[] ): Map< number, CommentRow[] > {
	const byParent = new Map< number, CommentRow[] >();
	rows.forEach( ( r ) => {
		const p = Number( r.parent ) || 0;
		const list = byParent.get( p ) ?? [];
		list.push( r );
		byParent.set( p, list );
	} );
	return byParent;
}

export function treeFor( ui: UiState, rows: CommentRow[] ): Map< number, CommentRow[] > {
	if ( ui.tree.rows !== rows ) {
		ui.tree = { rows, byParent: buildTree( rows ) };
	}
	return ui.tree.byParent;
}

export function bodyNode( ui: UiState, row: CommentRow ): HTMLElement {
	const rendered = row.content?.rendered ?? '';
	const cached = ui.bodies.get( row.id );
	if ( cached && cached.html === rendered ) {
		return cached.el;
	}
	const el = document.createElement( 'div' );
	el.className = `${ NS }__msg-text`;
	el.innerHTML = rendered;
	ui.bodies.set( row.id, { html: rendered, el } );
	return el;
}

export function pruneBodies( ui: UiState, rows: CommentRow[] ): void {
	const keep = new Set( rows.map( ( r ) => r.id ) );
	for ( const id of Array.from( ui.bodies.keys() ) ) {
		if ( ! keep.has( id ) ) {
			ui.bodies.delete( id );
		}
	}
}
