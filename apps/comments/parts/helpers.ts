/**
 * Comments app — small presentation helpers shared by the rail and
 * the conversation pane.
 *
 * Part of the `comments` client view: imported by the `comments.os.ts`
 * entry and its sibling parts.
 *
 * @public
 */

import { __, html, type TemplateResult } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import type { BulkAction, CommentRow, UiState } from './types';

/** CSS class prefix for everything the view renders. */
export const NS = 'os-comments';

/** wp-admin base URL, for building editor links the shell intercepts. */
export function adminUrl(): string {
	const desktop = ( window as unknown as {
		wp?: { os?: { config?: { adminUrl?: string } } };
	} ).wp?.os;
	return desktop?.config?.adminUrl || '/wp-admin/';
}

export function normalizeStatus( row: CommentRow ): string {
	const s = String( row.status );
	if ( s === 'approve' || s === 'approved' || s === '1' ) {
		return 'approved';
	}
	if ( s === 'hold' || s === '0' || s === 'unapproved' ) {
		return 'hold';
	}
	return s; // spam | trash
}

/** Human label for a moderation status. */
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

/** `<os-badge>` tone that reads the way the status feels. */
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

/**
 * Moderation status as a `<os-badge>`. `dotOnly` shrinks the pill to
 * its tone dot for the rail, where there's no room for a word — the
 * label rides along as screen-reader text, so the colour is never the
 * only carrier of the meaning, and the tooltip covers sighted users
 * who can't read the hue.
 */
export function statusBadge( status: string, dotOnly = false ): TemplateResult {
	const label = statusLabel( status );
	if ( dotOnly ) {
		return html`<os-badge class="${ NS }__status" tone=${ statusTone( status ) } title=${ label }>
			<span class="screen-reader-text">${ label }</span>
		</os-badge>`;
	}
	return html`<os-badge class="${ NS }__msg-status" tone=${ statusTone( status ) }>${ label }</os-badge>`;
}

/** A live timestamp for `date_gmt` — `<os-relative-time>` reads the MySQL form as UTC. */
export function timestamp( gmt: string, className: string, compact = false ): TemplateResult {
	return html`<os-relative-time class=${ className } datetime=${ gmt } ?compact=${ compact }></os-relative-time>`;
}

export function snippet( row: CommentRow ): string {
	const raw = row.content?.rendered ?? row.content?.raw ?? '';
	return decodeHTML( raw.replace( /<[^>]*>/g, ' ' ) ).replace( /\s+/g, ' ' ).trim();
}

export function authorName( row: CommentRow | undefined ): string {
	return row?.author_name || __( 'Anonymous' );
}

/**
 * The commenter's avatar. `<os-avatar>` owns the hue, the initials
 * fallback and the circular clip; the Gravatar URL rides as a data
 * attribute and `updated()` runs it through `applyAvatarSrc`, which
 * probes the address and REMOVES the src when it has no registered
 * avatar, so the initials tile shows instead of an empty circle.
 */
export function avatar( row: CommentRow, size: number ): TemplateResult {
	const url =
		row.author_avatar_urls?.[ '48' ] ??
		row.author_avatar_urls?.[ '96' ] ??
		row.author_avatar_urls?.[ '24' ] ??
		'';
	return html`<os-avatar
		class="${ NS }__disc"
		name=${ row.author_name || '?' }
		size=${ size }
		alt=""
		data-avatar-src=${ url }
	></os-avatar>`;
}

/**
 * The `external` glyph from `@wordpress/icons` — the same mark the
 * block editor puts on its own "View Post" link, so a link that leaves
 * OpenStation looks the same wherever WordPress offers it.
 */
export function externalIcon(): TemplateResult {
	return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="${ NS }__ext-icon">
		<path d="M19.5 4.5h-7V6h4.44l-5.97 5.97 1.06 1.06L18 7.06v4.44h1.5v-7Z"></path>
		<path d="M18 18v-5h1.5v5c0 .83-.67 1.5-1.5 1.5H6c-.83 0-1.5-.67-1.5-1.5V6c0-.83.67-1.5 1.5-1.5h5V6H6v12h12Z"></path>
	</svg>`;
}

/** The canonical "nothing selected / nothing here" shape. */
export function emptyState( icon: string, heading: string, description = '' ): TemplateResult {
	return html`<os-empty-state
		class="${ NS }__placeholder"
		icon=${ icon }
		heading=${ heading }
		description=${ description }
	></os-empty-state>`;
}

/** Spinner row — while a pane is fetching its first payload. */
export function loadingRow(): TemplateResult {
	return html`<div class="${ NS }__list-loading">
		<os-spinner size="24"></os-spinner>
		<span class="screen-reader-text">${ __( 'Loading…' ) }</span>
	</div>`;
}

/**
 * Confirmation copy for the two actions that take a comment out of
 * the conversation. Both are reversible from their own tab, so the
 * prompt says where it went rather than warning about permanence.
 */
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

/** Past-tense confirmation for the live region. */
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

/** Group thread rows by parent id — the tree the pane paints. */
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

/**
 * A comment's rendered body as a node the renderer keeps. The REST
 * `content.rendered` is trusted HTML (core's comment filters ran on
 * it); the kit's `html` tag would escape it, so it is set through
 * `innerHTML` on a node built once per id+content.
 */
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
