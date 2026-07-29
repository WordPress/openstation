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
import '../../ui/components/wpd-button/wpd-button';
import '../../ui/components/wpd-notice/wpd-notice';
import '../../ui/components/wpd-spinner/wpd-spinner';
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

interface DraftSuggestions {
	titles: string[];
	excerpt: string;
	tags: string[];
	categories: string[];
	readiness: { summary: string; missing: string[] };
}

/** Class on the panel; also the "is a panel open?" probe for the poller. */
const PANEL_CLASS = 'dm-drafts__suggest';

/** True when an AI provider is configured (Settings → Connectors). */
function aiAvailable(): boolean {
	const win = window as unknown as {
		desktopModeConfig?: {
			aiAssistant?: { providerConfigured?: boolean };
		};
	};
	return win.desktopModeConfig?.aiAssistant?.providerConfigured === true;
}

async function fetchSuggestions( id: number ): Promise< DraftSuggestions > {
	const res = await trackedFetch(
		`${ restRoot() }/desktop-mode/v1/draft-suggestions`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify( { post_id: id } ),
		},
		{ source: 'desktop-mode/drafts' },
	);
	if ( ! res.ok ) {
		throw new Error( `HTTP ${ res.status }` );
	}
	return res.json() as Promise< DraftSuggestions >;
}

interface ApplyFields {
	title?: string;
	excerpt?: string;
	tags?: string[];
	categories?: string[];
}

/** Write a chosen suggestion straight onto the draft. */
async function applyDraftField(
	id: number,
	fields: ApplyFields,
): Promise< boolean > {
	const res = await trackedFetch(
		`${ restRoot() }/desktop-mode/v1/draft-apply`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify( { post_id: id, ...fields } ),
		},
		{ source: 'desktop-mode/drafts' },
	);
	return res.ok;
}

function toast( message: string, type?: 'error' ): void {
	desktopApi()?.showToast?.( type ? { message, type } : { message } );
}

/**
 * Toggle the 💡 suggestions panel for a row (only one open at a time).
 *
 * The trigger owns `aria-expanded` / `aria-controls`, so the panel is
 * announced as the disclosure it is rather than as loose text that
 * appears out of nowhere.
 */
function toggleSuggestions(
	id: number,
	row: HTMLElement,
	trigger: HTMLElement,
): void {
	const list = row.parentElement;
	const next = row.nextElementSibling;
	const wasOwnOpen = !! next && next.classList.contains( PANEL_CLASS );

	// Collapse whatever was open, wherever it was, and reset its trigger.
	list?.querySelectorAll( `.${ PANEL_CLASS }` ).forEach( ( p ) => p.remove() );
	list?.querySelectorAll( '.dm-drafts__spark' ).forEach( ( t ) =>
		t.setAttribute( 'aria-expanded', 'false' ),
	);
	if ( wasOwnOpen ) {
		return; // second click closes it
	}

	const panel = document.createElement( 'div' );
	panel.className = PANEL_CLASS;
	panel.id = `dm-drafts-suggest-${ id }`;
	panel.setAttribute( 'role', 'group' );
	panel.setAttribute( 'aria-label', __( 'Writing suggestions' ) );
	panel.appendChild( loadingState() );
	row.after( panel );

	trigger.setAttribute( 'aria-expanded', 'true' );
	trigger.setAttribute( 'aria-controls', panel.id );

	void loadSuggestions( id, panel, row );
}

/** Spinner + label shown while the model is working. */
function loadingState(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'dm-drafts__suggest-loading';
	// `aria-live` so the eventual result is announced without the
	// screen-reader user having to go looking for it.
	wrap.setAttribute( 'aria-live', 'polite' );

	const spinner = document.createElement( 'wpd-spinner' );
	spinner.setAttribute( 'size', '18' );
	wrap.appendChild( spinner );

	const label = document.createElement( 'span' );
	label.textContent = __( 'Thinking…' );
	wrap.appendChild( label );

	return wrap;
}

/** A dismissal-free `<wpd-notice>` carrying a single line of text. */
function notice( tone: string, message: string, icon?: string ): HTMLElement {
	const el = document.createElement( 'wpd-notice' );
	el.setAttribute( 'tone', tone );
	el.setAttribute( 'not-dismissible', '' );
	if ( icon ) {
		el.setAttribute( 'icon', icon );
	}
	el.textContent = message;
	return el;
}

async function loadSuggestions(
	id: number,
	panel: HTMLElement,
	row: HTMLElement,
): Promise< void > {
	try {
		const data = await fetchSuggestions( id );
		if ( panel.isConnected ) {
			renderSuggestions( panel, data, id, row );
		}
	} catch {
		if ( panel.isConnected ) {
			panel.replaceChildren(
				notice( 'error', __( 'Could not get suggestions.' ) ),
			);
		}
	}
}

/**
 * Build one tap-to-apply suggestion as a `<wpd-button>`.
 *
 * `busy` while the write is in flight (the component disables itself and
 * paints its own spinner), `disabled` + `is-applied` once it lands, so a
 * suggestion can't be applied twice by an impatient double-click.
 */
function applyButton(
	id: number,
	text: string,
	variantClass: string,
	fields: ApplyFields,
	onOk?: () => void,
): HTMLElement {
	const btn = document.createElement( 'wpd-button' );
	btn.setAttribute( 'variant', 'ghost' );
	btn.className = variantClass;
	btn.textContent = text;
	btn.title = __( 'Apply to the draft' );
	btn.addEventListener( 'click', () => {
		if ( btn.hasAttribute( 'busy' ) || btn.hasAttribute( 'disabled' ) ) {
			return;
		}
		btn.setAttribute( 'busy', '' );
		void applyDraftField( id, fields ).then( ( ok ) => {
			btn.removeAttribute( 'busy' );
			if ( ok ) {
				btn.setAttribute( 'disabled', '' );
				btn.classList.add( 'is-applied' );
				const check = document.createElement( 'span' );
				check.className = 'dm-drafts__applied-check';
				check.setAttribute( 'aria-hidden', 'true' );
				check.textContent = '✓';
				btn.appendChild( check );
				onOk?.();
			} else {
				toast( __( 'Could not apply the suggestion.' ), 'error' );
			}
		} );
	} );
	return btn;
}

/** Readiness verdict as a tone-coded `<wpd-notice>`. */
function readinessNotice( readiness: DraftSuggestions[ 'readiness' ] ): HTMLElement {
	const missing = readiness.missing ?? [];
	const ready = missing.length === 0;
	const el = document.createElement( 'wpd-notice' );
	el.setAttribute( 'tone', ready ? 'success' : 'warning' );
	el.setAttribute( 'not-dismissible', '' );
	el.setAttribute(
		'icon',
		ready ? 'dashicons-yes-alt' : 'dashicons-info-outline',
	);
	el.className = 'dm-drafts__readiness';

	if ( readiness.summary ) {
		const summary = document.createElement( 'div' );
		summary.className = 'dm-drafts__readiness-summary';
		summary.textContent = readiness.summary;
		el.appendChild( summary );
	}
	if ( missing.length > 0 ) {
		const ul = document.createElement( 'ul' );
		ul.className = 'dm-drafts__readiness-missing';
		for ( const m of missing ) {
			const li = document.createElement( 'li' );
			li.textContent = m;
			ul.appendChild( li );
		}
		el.appendChild( ul );
	}
	return el;
}

function renderSuggestions(
	panel: HTMLElement,
	data: DraftSuggestions,
	id: number,
	row: HTMLElement,
): void {
	panel.replaceChildren();

	// Readiness check — read-only diagnosis at the top.
	if (
		data.readiness &&
		( data.readiness.summary || data.readiness.missing?.length )
	) {
		panel.appendChild( readinessNotice( data.readiness ) );
	}

	const hint = document.createElement( 'div' );
	hint.className = 'dm-drafts__suggest-hint';
	hint.textContent = __( 'Tap a suggestion to apply it to the draft.' );
	panel.appendChild( hint );

	const group = ( label: string ): HTMLElement => {
		const g = document.createElement( 'div' );
		g.className = 'dm-drafts__suggest-group';
		const h = document.createElement( 'div' );
		h.className = 'dm-drafts__suggest-label';
		h.textContent = label;
		g.appendChild( h );
		panel.appendChild( g );
		return g;
	};

	if ( data.titles && data.titles.length > 0 ) {
		const g = group( __( 'Title ideas' ) );
		for ( const t of data.titles ) {
			g.appendChild(
				applyButton( id, t, 'dm-drafts__suggest-item', { title: t }, () => {
					const name = row.querySelector( '.dm-drafts__name' );
					if ( name ) {
						name.textContent = t;
					}
					toast( __( 'Title updated.' ) );
				} ),
			);
		}
	}
	if ( data.excerpt ) {
		const g = group( __( 'Excerpt' ) );
		g.appendChild(
			applyButton(
				id,
				data.excerpt,
				'dm-drafts__suggest-item',
				{ excerpt: data.excerpt },
				() => toast( __( 'Excerpt updated.' ) ),
			),
		);
	}
	if ( data.tags && data.tags.length > 0 ) {
		const g = group( __( 'Tags' ) );
		const wrap = document.createElement( 'div' );
		wrap.className = 'dm-drafts__suggest-tags';
		for ( const tag of data.tags ) {
			wrap.appendChild(
				applyButton(
					id,
					tag,
					'dm-drafts__suggest-tag',
					{ tags: [ tag ] },
					() => toast( __( 'Tag added.' ) ),
				),
			);
		}
		g.appendChild( wrap );
	}
	if ( data.categories && data.categories.length > 0 ) {
		const g = group( __( 'Categories' ) );
		const wrap = document.createElement( 'div' );
		wrap.className = 'dm-drafts__suggest-tags';
		for ( const cat of data.categories ) {
			wrap.appendChild(
				applyButton(
					id,
					cat,
					'dm-drafts__suggest-tag',
					{ categories: [ cat ] },
					() => toast( __( 'Category added.' ) ),
				),
			);
		}
		g.appendChild( wrap );
	}
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

/**
 * One hover-revealed, icon-only action at the end of a draft row.
 *
 * `<wpd-button>` rather than a bare `<button>`: the component carries the
 * framework's focus ring, disabled semantics and theming tokens, and keeps
 * the two row actions visually identical. The Dashicon is slotted as a
 * light-DOM child because the global icon font can't cross the component's
 * shadow boundary.
 */
function rowAction(
	className: string,
	dashicon: string,
	label: string,
): HTMLElement {
	const btn = document.createElement( 'wpd-button' );
	btn.className = className;
	btn.setAttribute( 'variant', 'ghost' );
	btn.title = label;
	btn.setAttribute( 'aria-label', label );
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ dashicon }`;
	btn.appendChild( icon );
	return btn;
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

		// Trash button. The inner Dashicon is a light-DOM child so the
		// global icon font reaches it, and pointer-events:none so the
		// click always lands on the control itself.
		const trash = rowAction(
			'dm-drafts__trash',
			'dashicons-trash',
			__( 'Move to Trash' ),
		);
		trash.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			void onTrash( d, row, onChange );
		} );

		row.appendChild( link );
		// 💡 AI suggestions — only when an AI provider is configured.
		if ( aiAvailable() ) {
			const spark = rowAction(
				'dm-drafts__spark',
				'dashicons-lightbulb',
				__( 'Suggest title, excerpt & tags' ),
			);
			spark.setAttribute( 'aria-expanded', 'false' );
			spark.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				e.stopPropagation();
				toggleSuggestions( d.id, row, spark );
			} );
			row.appendChild( spark );
		}
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
		// Don't rebuild the list while an AI suggestions panel is open —
		// the round-trip takes a few seconds and a poll/blur refresh would
		// otherwise wipe the panel out from under the user.
		if ( container.querySelector( `.${ PANEL_CLASS }` ) ) {
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
