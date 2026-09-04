/**
 * Posts app — the cells the Pages mode adds: Parent, Template, Slug
 * (click to copy) and Comments.
 *
 * @public
 */

import { __, _n, copyText, sprintf } from '@openstation/app';
import { titleOf, type CellEnv } from './env';
import type { PostListItem } from '../types';

/**
 * Refresh the in-page parent-title roster from the page's rows. Pages
 * outside the roster show "↳ #42".
 */
export function refreshParentTitleRoster( env: CellEnv, rows: PostListItem[] ): void {
	env.parentTitles.clear();
	for ( const row of rows ) {
		env.parentTitles.set( row.id, titleOf( row ) );
	}
}

export function buildParentCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'span' );
	const pid = typeof row.parent === 'number' ? row.parent : 0;
	if ( pid === 0 ) {
		cell.textContent = '—';
		cell.setAttribute( 'aria-label', __( 'Top-level page' ) );
		return cell;
	}
	const known = env.parentTitles.get( pid );
	/* translators: %d is the numeric id of a parent page whose title isn't on the current page roster. */
	cell.textContent = known ? `↳ ${ known }` : sprintf( __( '↳ #%d' ), pid );
	return cell;
}

export function buildTemplateCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'span' );
	const slug = typeof row.template === 'string' ? row.template : '';
	const map = env.extra.pageTemplates ?? {};
	cell.textContent = map[ slug ] ?? ( slug === '' ? __( 'Default template' ) : slug );
	if ( slug !== '' ) {
		cell.title = slug;
	}
	return cell;
}

/** The URL slug with a click-to-copy affordance. */
export function buildSlugCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'button' );
	cell.type = 'button';
	const slug = typeof row.slug === 'string' ? row.slug : '';
	cell.textContent = slug || '—';
	cell.disabled = slug === '';
	cell.title = slug ? __( 'Click to copy slug' ) : '';
	Object.assign( cell.style, {
		appearance: 'none',
		background: 'transparent',
		border: 'none',
		padding: '2px 6px',
		font: 'inherit',
		color: 'inherit',
		cursor: slug ? 'copy' : 'default',
		textAlign: 'left',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
		fontSize: '12px',
		borderRadius: '4px',
		maxWidth: '100%',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	} as Partial< CSSStyleDeclaration > );
	cell.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( ! slug ) {
			return;
		}
		// `copyText` answers honestly — the async clipboard is undefined
		// on a plain-HTTP dev site, where the fallback path still works.
		void copyText( slug ).then( ( ok ) => {
			if ( ! ok ) {
				env.toast( __( 'Couldn’t copy the slug.' ), null );
				return;
			}
			cell.textContent = __( 'Copied!' );
			cell.style.color = 'var(--wp-admin-theme-color, #2271b1)';
			setTimeout( () => {
				cell.textContent = slug;
				cell.style.color = '';
			}, 1200 );
		} );
	} );
	return cell;
}

/** The `openstation_comment_count` REST field with a small icon. */
export function buildCommentsCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	Object.assign( cell.style, {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		fontVariantNumeric: 'tabular-nums',
	} as Partial< CSSStyleDeclaration > );

	const count = typeof row.openstation_comment_count === 'number' ? row.openstation_comment_count : null;
	if ( count === null ) {
		cell.textContent = '—';
		cell.style.color = 'var(--os-ui-fg-muted, #8c8f94)';
		return cell;
	}

	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-admin-comments';
	icon.setAttribute( 'aria-hidden', 'true' );
	Object.assign( icon.style, {
		fontSize: '16px',
		width: '16px',
		height: '16px',
		color: count > 0 ? 'var(--wp-admin-theme-color, #2271b1)' : 'var(--os-ui-fg-muted, #8c8f94)',
	} as Partial< CSSStyleDeclaration > );

	const label = document.createElement( 'span' );
	label.textContent = String( count );
	if ( count === 0 ) {
		label.style.color = 'var(--os-ui-fg-muted, #8c8f94)';
	}

	cell.appendChild( icon );
	cell.appendChild( label );
	/* translators: %d is the comment count for a row. */
	cell.setAttribute( 'aria-label', sprintf( _n( '%d comment', '%d comments', count ), count ) );
	return cell;
}
