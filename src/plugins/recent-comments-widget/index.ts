/**
 * Desktop Mode — Recent Comments Widget (lazy bundle).
 *
 * Shows a live feed of the latest comments with status badges,
 * commenter name, parent post title, and time-ago stamps.
 * A pending-count badge keeps moderators aware of their queue.
 *
 * Data: WP REST /wp/v2/comments (logged-in, no extra caps needed).
 * Refresh: every 60 seconds.
 *
 * @since 0.26.0
 */
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID  = 'desktop-mode/recent-comments';
const REFRESH_MS = 60_000;
const LIMIT      = 8;

interface CommentRow {
	id: number;
	status: 'approved' | 'hold' | 'spam' | 'trash';
	author_name: string;
	date: string;
	post: number;
	_embedded?: {
		up?: Array<{ title?: { rendered?: string } }>;
	};
}

const STATUS_META: Record< string, { label: string; color: string } > = {
	approved: { label: 'Approved', color: '#22c55e' },
	hold:     { label: 'Pending',  color: '#f59e0b' },
	spam:     { label: 'Spam',     color: '#ef4444' },
	trash:    { label: 'Trash',    color: '#9ca3af' },
};

function timeAgo( iso: string ): string {
	const secs = Math.floor( ( Date.now() - new Date( iso ).getTime() ) / 1000 );
	if ( secs < 60 )    return secs + 's ago';
	if ( secs < 3600 )  return Math.floor( secs / 60 ) + 'm ago';
	if ( secs < 86400 ) return Math.floor( secs / 3600 ) + 'h ago';
	return Math.floor( secs / 86400 ) + 'd ago';
}

async function fetchComments(): Promise< CommentRow[] > {
	const s = ( window as unknown as { wpApiSettings?: { root?: string; nonce?: string } } )
		.wpApiSettings ?? {};
	const res = await fetch(
		( s.root ?? '/wp-json/' ).replace( /\/$/, '' ) +
			`/wp/v2/comments?per_page=${ LIMIT }&orderby=date&order=desc&_embed=up`,
		{ headers: { 'X-WP-Nonce': s.nonce ?? '' }, credentials: 'same-origin' },
	);
	if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
	return res.json() as Promise< CommentRow[] >;
}

function render( container: HTMLElement, comments: CommentRow[] | null, error: boolean ): void {
	container.innerHTML = '';

	const header = document.createElement( 'div' );
	header.className = 'dm-comments__header';
	const title = document.createElement( 'span' );
	title.className = 'dm-comments__title';
	title.textContent = 'Recent Comments';
	const badge = document.createElement( 'span' );
	badge.className = 'dm-comments__badge';
	const pending = comments ? comments.filter( ( c ) => c.status === 'hold' ).length : 0;
	if ( pending > 0 ) {
		badge.textContent = pending + ' pending';
		badge.classList.add( 'dm-comments__badge--visible' );
	}
	header.appendChild( title );
	header.appendChild( badge );
	container.appendChild( header );

	if ( error ) {
		const err = document.createElement( 'div' );
		err.className = 'dm-comments__error';
		err.textContent = 'Could not load comments.';
		container.appendChild( err );
		return;
	}
	if ( ! comments || comments.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'dm-comments__empty';
		empty.textContent = 'No comments yet.';
		container.appendChild( empty );
		return;
	}

	const list = document.createElement( 'div' );
	list.className = 'dm-comments__list';
	for ( const c of comments ) {
		const row = document.createElement( 'div' );
		row.className = 'dm-comments__row';

		const avatar = document.createElement( 'div' );
		avatar.className = 'dm-comments__avatar';
		avatar.textContent = ( c.author_name || '?' ).trim().charAt( 0 ).toUpperCase();

		const body = document.createElement( 'div' );
		body.className = 'dm-comments__body';

		const meta = document.createElement( 'div' );
		meta.className = 'dm-comments__meta';

		const author = document.createElement( 'span' );
		author.className = 'dm-comments__author';
		author.textContent = c.author_name || 'Anonymous';

		const sm = STATUS_META[ c.status ] ?? STATUS_META.hold;
		const statusEl = document.createElement( 'span' );
		statusEl.className = 'dm-comments__status';
		statusEl.style.background = sm.color;
		statusEl.textContent = sm.label;

		const time = document.createElement( 'span' );
		time.className = 'dm-comments__time';
		time.textContent = timeAgo( c.date );

		meta.appendChild( author );
		meta.appendChild( statusEl );
		meta.appendChild( time );

		const postEl = document.createElement( 'div' );
		postEl.className = 'dm-comments__post';
		postEl.textContent = '\u21B3 ' + ( c._embedded?.up?.[ 0 ]?.title?.rendered ?? `Post #${ c.post }` );

		body.appendChild( meta );
		body.appendChild( postEl );
		row.appendChild( avatar );
		row.appendChild( body );
		list.appendChild( row );
	}
	container.appendChild( list );
}

const mount = async ( container: HTMLElement, _ctx: WidgetContext ): Promise< WidgetTeardown > => {
	let destroyed = false;
	let intervalId: ReturnType< typeof setInterval > | null = null;
	const refresh = async (): Promise< void > => {
		if ( destroyed ) return;
		try {
			const comments = await fetchComments();
			if ( ! destroyed ) render( container, comments, false );
		} catch {
			if ( ! destroyed ) render( container, null, true );
		}
	};
	await refresh();
	intervalId = setInterval( refresh, REFRESH_MS );
	return () => {
		destroyed = true;
		if ( intervalId !== null ) clearInterval( intervalId );
	};
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
