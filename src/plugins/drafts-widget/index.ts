/**
 * Desktop Mode — Drafts Widget (lazy bundle).
 *
 * A quick list of your unfinished posts: the most recently edited
 * drafts, each a click away from reopening in the editor. Add it from
 * the widget picker to jump back into whatever you left half-written.
 *
 * Data: WP REST /wp/v2/posts?status=draft (edit context — returns the
 * drafts the current user can edit). Refresh: every 60s, plus an
 * immediate refresh when the user closes the editor or switches back to
 * the desktop (window closed/blurred), so a just-saved draft shows up
 * without waiting for the poll. Clicking a row links to
 * post.php?action=edit; the shell's link interceptor opens it as a
 * native window.
 */
import './styles.css';
import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { startVisibilityAwarePoller } from '../../widgets/poller';
import { decodeHTML } from '../../utils';

interface DesktopApi {
	confirm?( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
	} ): Promise< boolean >;
	showToast?( opts: { message: string; type?: string } ): unknown;
}

function desktopApi(): DesktopApi | undefined {
	return ( window as unknown as { wp?: { desktop?: DesktopApi } } ).wp
		?.desktop;
}

function restRoot(): string {
	return (
		( window as unknown as { wpApiSettings?: { root?: string } } )
			.wpApiSettings?.root ?? '/wp-json/'
	).replace( /\/$/, '' );
}

/**
 * Numeric id of the viewer, or 0 when the shell hasn't published one.
 * Used to scope the draft list to the current user.
 */
function currentUserId(): number {
	const desktop = ( window as unknown as {
		wp?: { desktop?: { config?: { currentUserId?: number } } };
	} ).wp?.desktop;
	return Number( desktop?.config?.currentUserId ) || 0;
}

/** Move a draft to the Trash (reversible — not a permanent delete). */
async function trashDraft( id: number ): Promise< boolean > {
	const res = await trackedFetch(
		`${ restRoot() }/wp/v2/posts/${ id }`,
		{ method: 'DELETE', credentials: 'same-origin' },
		{ source: 'desktop-mode/drafts' },
	);
	return res.ok;
}

const WIDGET_ID = 'desktop-mode/drafts';
const REFRESH_MS = 60_000;
const LIMIT = 8;

interface DraftRow {
	id: number;
	title: { rendered?: string; raw?: string };
	// UTC timestamp; use for the "edited …" stamp regardless of the
	// site's timezone.
	modified_gmt: string;
}

/** Base admin URL, e.g. `http://site/wp-admin/` (trailing slash). */
function adminUrl(): string {
	const desktop = ( window as unknown as {
		wp?: { desktop?: { config?: { adminUrl?: string } } };
	} ).wp?.desktop;
	return desktop?.config?.adminUrl || '/wp-admin/';
}

function editUrl( id: number ): string {
	return `${ adminUrl() }post.php?post=${ id }&action=edit`;
}

function timeAgo( isoUtc: string ): string {
	const ts = isoUtc.endsWith( 'Z' ) ? isoUtc : isoUtc + 'Z';
	const secs = Math.floor( ( Date.now() - new Date( ts ).getTime() ) / 1000 );
	if ( secs < 60 ) {
		return __( 'just now' );
	}
	// Whole placeholders rather than `count + __( 'm ago' )`: a
	// concatenated fragment reaches translators without context and
	// can't be reordered — many locales put the unit before the number.
	if ( secs < 3600 ) {
		return sprintf(
			/* translators: %d: whole minutes since the draft was last edited. */
			__( '%dm ago' ),
			Math.floor( secs / 60 ),
		);
	}
	if ( secs < 86400 ) {
		return sprintf(
			/* translators: %d: whole hours since the draft was last edited. */
			__( '%dh ago' ),
			Math.floor( secs / 3600 ),
		);
	}
	return sprintf(
		/* translators: %d: whole days since the draft was last edited. */
		__( '%dd ago' ),
		Math.floor( secs / 86400 ),
	);
}

async function fetchDrafts(): Promise< DraftRow[] > {
	// trackedFetch routes through the framework (loading spinner + activity
	// bus) and injects the REST nonce automatically. `context=edit` is what
	// returns draft posts (and their titles) for a user who can edit them —
	// but on its own that means *every* draft the viewer can edit, so an
	// editor or admin would see the whole site's. This widget is "your
	// unfinished posts", so scope it to the viewer whenever the shell has
	// published their id.
	const uid = currentUserId();
	const res = await trackedFetch(
		restRoot() +
			`/wp/v2/posts?status=draft&orderby=modified&order=desc&per_page=${ LIMIT }` +
			'&context=edit&_fields=id,title,modified_gmt' +
			( uid > 0 ? `&author=${ uid }` : '' ),
		{ credentials: 'same-origin' },
		{ source: 'desktop-mode/drafts', silent: true },
	);
	if ( ! res.ok ) {
		throw new Error( `HTTP ${ res.status }` );
	}
	return res.json() as Promise< DraftRow[] >;
}

function draftTitle( row: DraftRow ): string {
	const rendered = row.title?.rendered
		? decodeHTML( row.title.rendered ).trim()
		: '';
	if ( rendered ) {
		return rendered;
	}
	const raw = ( row.title?.raw ?? '' ).trim();
	return raw || __( '(no title)' );
}

function render(
	container: HTMLElement,
	drafts: DraftRow[] | null,
	error: boolean,
	onChange: () => void,
): void {
	container.innerHTML = '';

	const header = document.createElement( 'div' );
	header.className = 'dm-drafts__header';
	const title = document.createElement( 'span' );
	title.className = 'dm-drafts__title';
	title.textContent = __( 'Drafts' );
	const badge = document.createElement( 'span' );
	badge.className = 'dm-drafts__badge';
	if ( drafts && drafts.length > 0 ) {
		badge.textContent = String( drafts.length );
		badge.classList.add( 'dm-drafts__badge--visible' );
	}
	header.appendChild( title );
	header.appendChild( badge );
	container.appendChild( header );

	if ( error ) {
		const err = document.createElement( 'div' );
		err.className = 'dm-drafts__empty';
		err.textContent = __( 'Could not load drafts.' );
		container.appendChild( err );
		return;
	}
	if ( ! drafts || drafts.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'dm-drafts__empty';
		empty.textContent = __( 'No drafts — all caught up.' );
		container.appendChild( empty );
		return;
	}

	const list = document.createElement( 'div' );
	list.className = 'dm-drafts__list';
	for ( const d of drafts ) {
		const row = document.createElement( 'div' );
		row.className = 'dm-drafts__row';

		// A real anchor so the shell's admin-link interceptor opens the
		// editor as a native window (and middle-click / modifiers behave).
		const link = document.createElement( 'a' );
		link.className = 'dm-drafts__link';
		link.href = editUrl( d.id );

		const name = document.createElement( 'span' );
		name.className = 'dm-drafts__name';
		name.textContent = draftTitle( d );

		const time = document.createElement( 'span' );
		time.className = 'dm-drafts__time';
		time.textContent = timeAgo( d.modified_gmt );

		link.appendChild( name );
		link.appendChild( time );

		// Trash button — native <button> (the widgets layer only fires
		// native controls). The inner icon is pointer-events:none so the
		// click always lands on the button.
		const trash = document.createElement( 'button' );
		trash.type = 'button';
		trash.className = 'dm-drafts__trash';
		trash.title = __( 'Move to Trash' );
		trash.setAttribute( 'aria-label', __( 'Move to Trash' ) );
		const icon = document.createElement( 'span' );
		icon.className = 'dashicons dashicons-trash';
		trash.appendChild( icon );
		trash.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			void onTrash( d, row, onChange );
		} );

		row.appendChild( link );
		row.appendChild( trash );
		list.appendChild( row );
	}
	container.appendChild( list );
}

/** Confirm, trash the draft, then refresh the list. */
async function onTrash(
	draft: DraftRow,
	row: HTMLElement,
	onChange: () => void,
): Promise< void > {
	const api = desktopApi();
	// No confirm dialog available means we can't get consent — refuse
	// rather than trashing unprompted. `wp.desktop.confirm` is a stable
	// part of the shell API, so this only trips outside the shell.
	if ( ! api?.confirm ) {
		return;
	}
	const ok = await api.confirm( {
		title: __( 'Move to Trash?' ),
		message: sprintf(
			/* translators: %s: draft title. */
			__( '“%s” will be moved to the Trash. You can restore it later.' ),
			draftTitle( draft ),
		),
		confirmLabel: __( 'Move to Trash' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}
	// Optimistic: dim the row while the request is in flight.
	row.classList.add( 'is-trashing' );
	try {
		const done = await trashDraft( draft.id );
		if ( ! done ) {
			throw new Error( 'trash failed' );
		}
		api?.showToast?.( { message: __( 'Draft moved to Trash.' ) } );
		onChange();
	} catch {
		row.classList.remove( 'is-trashing' );
		api?.showToast?.( {
			message: __( 'Could not move the draft to Trash.' ),
			type: 'error',
		} );
	}
}

const mount = async (
	container: HTMLElement,
	_ctx: WidgetContext,
): Promise< WidgetTeardown > => {
	let destroyed = false;
	const refresh = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const drafts = await fetchDrafts();
			if ( ! destroyed ) {
				render( container, drafts, false, refresh );
			}
		} catch {
			if ( ! destroyed ) {
				render( container, null, true, refresh );
			}
		}
	};
	await refresh();
	const poller = startVisibilityAwarePoller( refresh, REFRESH_MS );

	// There is no dedicated "post saved" event (the editor is a chromeless
	// iframe), so we lean on window lifecycle: when the user closes the
	// editor or switches back to the desktop after saving a draft, refresh
	// so the new/edited draft shows up immediately instead of on the next
	// poll. Debounced to coalesce bursts (a blur + focus during a switch).
	let nudgeTimer: ReturnType< typeof setTimeout > | null = null;
	const nudge = (): void => {
		if ( nudgeTimer !== null ) {
			clearTimeout( nudgeTimer );
		}
		nudgeTimer = setTimeout( () => {
			nudgeTimer = null;
			void refresh();
		}, 600 );
	};
	document.addEventListener( 'desktop-mode-window-closed', nudge );
	document.addEventListener( 'desktop-mode-window-blurred', nudge );

	return () => {
		destroyed = true;
		poller.stop();
		if ( nudgeTimer !== null ) {
			clearTimeout( nudgeTimer );
		}
		document.removeEventListener( 'desktop-mode-window-closed', nudge );
		document.removeEventListener( 'desktop-mode-window-blurred', nudge );
	};
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
