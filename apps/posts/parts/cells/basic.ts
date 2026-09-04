/**
 * Posts app — the cells both modes render: the title (with its lock,
 * status and reading-page badges and the Pages "View" link), the
 * author, the date, and the expanded sub-row.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { applyAvatarSrc } from '../../../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../../../src/utils';
import '../../../../src/ui/components/os-avatar/os-avatar';
import '../../../../src/ui/components/os-relative-time/os-relative-time';
import {
	STATUS_LABELS,
	authorOf,
	buildEditPostUrl,
	featuredMediaOf,
	pill,
	statusBadgeColor,
	titleOf,
	type CellEnv,
} from './env';
import type { PostListItem } from '../types';

function dashicon( name: string, size = 13 ): HTMLElement {
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ name }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	icon.style.cssText = `font-size:${ size }px;width:${ size }px;height:${ size }px;line-height:1;`;
	return icon;
}

/**
 * The lock glyph: document-level dashicon rules do not pierce the
 * table's shadow root, but the @font-face is document-wide — set the
 * family inline and emit the glyph (U+F160, "lock") as text.
 */
function lockGlyph(): HTMLElement {
	const icon = document.createElement( 'span' );
	icon.setAttribute( 'aria-hidden', 'true' );
	icon.style.cssText = 'font-family:dashicons;font-size:14px;line-height:1;display:inline-block;speak:none;-webkit-font-smoothing:antialiased';
	icon.textContent = '';
	return icon;
}

function underlineOnHover( link: HTMLAnchorElement ): void {
	link.addEventListener( 'mouseenter', () => {
		link.style.textDecoration = 'underline';
	} );
	link.addEventListener( 'mouseleave', () => {
		link.style.textDecoration = 'none';
	} );
}

export function buildTitleCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;';
	const titleRow = document.createElement( 'span' );
	titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

	const link = document.createElement( 'a' );
	link.href = buildEditPostUrl( env.extra, row.id );
	link.setAttribute( 'data-noclick', '' );
	const title = titleOf( row ) || __( '(no title)' );
	link.textContent = title;
	link.title = title;
	link.style.cssText =
		'font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;';
	underlineOnHover( link );
	link.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		env.openUrl( link.href, title, 'dashicons-admin-post' );
	} );
	titleRow.appendChild( link );

	// Another user is editing this row right now (the `openstation_lock`
	// REST field).
	const lock = row.openstation_lock ?? null;
	if ( lock ) {
		titleRow.appendChild(
			pill( lock.userName, { fg: '#b32d2e', bg: 'rgba(179, 45, 46, 0.1)' }, {
				icon: lockGlyph(),
				/* translators: %s is the user name currently editing the post. */
				title: sprintf( __( '%s is currently editing' ), lock.userName ),
			} ),
		);
	}

	// Pages: the rows the reading settings point at.
	const isPages = env.extra.mode === 'pages';
	if ( isPages && typeof env.extra.frontPageId === 'number' && env.extra.frontPageId === row.id ) {
		titleRow.appendChild(
			pill( __( 'Front page' ), { fg: '#0a4b78', bg: 'rgba(34,113,177,0.12)' }, { icon: dashicon( 'dashicons-admin-home' ) } ),
		);
	}
	if ( isPages && typeof env.extra.postsPageId === 'number' && env.extra.postsPageId === row.id ) {
		titleRow.appendChild(
			pill( __( 'Posts page' ), { fg: '#5b3aa0', bg: 'rgba(91,58,160,0.12)' }, { icon: dashicon( 'dashicons-admin-post' ) } ),
		);
	}

	if ( row.status && row.status !== 'publish' ) {
		titleRow.appendChild( pill( STATUS_LABELS[ row.status ] ?? row.status, statusBadgeColor( row.status ), { uppercase: true } ) );
	}

	// Pages: a "View" link to the public URL, in a new tab so the user
	// keeps the table state.
	if ( isPages && typeof row.link === 'string' && row.link && row.status === 'publish' ) {
		const view = document.createElement( 'a' );
		view.href = row.link;
		view.target = '_blank';
		view.rel = 'noreferrer noopener';
		view.textContent = __( 'View' );
		view.title = row.link;
		view.setAttribute( 'data-noclick', '' );
		view.style.cssText = 'font-size:11px;color:var(--wp-admin-theme-color, #2271b1);text-decoration:none;flex-shrink:0;';
		view.addEventListener( 'click', ( e ) => e.stopPropagation() );
		underlineOnHover( view );
		titleRow.appendChild( view );
	}

	cell.appendChild( titleRow );
	return cell;
}

export function buildAuthorCell( row: PostListItem ): HTMLElement {
	const a = authorOf( row );
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;min-width:0;';

	// `<os-avatar>`: initials fallback, hue-by-name, the hover effect.
	// The Gravatar URL is probed through the shared helper so an email
	// with no registered avatar drops to initials without a 404.
	const avatar = document.createElement( 'os-avatar' );
	avatar.setAttribute( 'size', '24' );
	if ( a.name ) {
		avatar.setAttribute( 'name', a.name );
	}
	if ( a.id > 0 ) {
		avatar.setAttribute( 'user-id', String( a.id ) );
	}
	if ( a.avatar ) {
		applyAvatarSrc( avatar, a.avatar );
	}
	wrap.appendChild( avatar );

	const name = document.createElement( 'span' );
	name.textContent = a.name;
	name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	wrap.appendChild( name );
	return wrap;
}

export function buildDateCell( row: PostListItem ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:flex;flex-direction:column;line-height:1.2;';
	const time = document.createElement( 'os-relative-time' );
	// `date_gmt`, not `date`: neither carries a designator and
	// `<os-relative-time>` reads an undesignated value as UTC.
	time.setAttribute( 'datetime', row.date_gmt || row.date );
	wrap.appendChild( time );
	if ( row.modified_gmt && row.modified_gmt !== row.date_gmt ) {
		const meta = document.createElement( 'span' );
		meta.textContent = __( 'modified' );
		meta.style.cssText = 'font-size:11px;color:#646970;';
		wrap.appendChild( meta );
	}
	return wrap;
}

/** The expanded sub-row: featured image + plain-text excerpt. */
export function buildSubRow( row: PostListItem ): Node {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = 'display:flex;gap:16px;padding:12px 16px;background:#fafafa;align-items:flex-start;';

	const featured = featuredMediaOf( row );
	if ( featured ) {
		const img = document.createElement( 'img' );
		img.src = featured.url;
		img.alt = featured.alt;
		img.loading = 'lazy';
		img.style.cssText = 'width:96px;height:96px;border-radius:6px;object-fit:cover;flex-shrink:0;';
		wrap.appendChild( img );
	}

	const text = document.createElement( 'div' );
	text.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;';
	const heading = document.createElement( 'div' );
	heading.style.cssText = 'font-size:13px;color:#646970;text-transform:uppercase;letter-spacing:0.04em;';
	heading.textContent = __( 'Excerpt' );
	text.appendChild( heading );

	const excerpt = document.createElement( 'div' );
	excerpt.style.cssText = 'color:#1d2327;line-height:1.5;';
	const raw = row.excerpt?.rendered ?? '';
	if ( raw ) {
		excerpt.textContent = decodeHTML( raw.replace( /<[^>]+>/g, '' ).trim() ) || __( '(no excerpt)' );
	} else {
		excerpt.textContent = __( '(no excerpt)' );
		excerpt.style.color = '#a7aaad';
	}
	text.appendChild( excerpt );
	wrap.appendChild( text );
	return wrap;
}
