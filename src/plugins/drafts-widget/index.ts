import './styles.css';
import '../../ui/components/os-button/os-button';
import '../../ui/components/os-notice/os-notice';
import '../../ui/components/os-spinner/os-spinner';
import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import { RestError, restErrorFromResponse } from '../../core/api-client';
import { describeRestFailure, toastRestFailure } from '../../core/rest-failure';
import { shellToast } from '../../core/shell-toast';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { startVisibilityAwarePoller } from '../../widgets/poller';
import { adminBaseUrl as adminUrl, decodeHTML } from '../../utils';

interface DesktopApi {
	confirm?( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
	} ): Promise< boolean >;
}

function desktopApi(): DesktopApi | undefined {
	return ( window as unknown as { wp?: { os?: DesktopApi } } ).wp
		?.os;
}

function restRoot(): string {
	return (
		( window as unknown as { wpApiSettings?: { root?: string } } )
			.wpApiSettings?.root ?? '/wp-json/'
	).replace( /\/$/, '' );
}

function currentUserId(): number {
	const desktop = ( window as unknown as {
		wp?: { os?: { config?: { currentUserId?: number } } };
	} ).wp?.os;
	return Number( desktop?.config?.currentUserId ) || 0;
}

async function trashDraft( id: number ): Promise< void > {
	const res = await trackedFetch(
		`${ restRoot() }/wp/v2/posts/${ id }`,
		{ method: 'DELETE', credentials: 'same-origin' },
		{ source: 'desktop-mode/drafts' },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res );
	}
}

interface DraftSuggestions {
	titles: string[];
	excerpt: string;
	tags: string[];
	categories: string[];
	readiness: { summary: string; missing: string[] };
}

const PANEL_CLASS = 'dm-drafts__suggest';

function aiAvailable(): boolean {
	const win = window as unknown as {
		openStationConfig?: {
			aiAssistant?: { providerConfigured?: boolean };
		};
	};
	return win.openStationConfig?.aiAssistant?.providerConfigured === true;
}

type SuggestionsFailure = 'no-provider' | 'quota' | 'auth' | 'unavailable' | 'other';

class SuggestionsError extends RestError {
	readonly reason: SuggestionsFailure;

	constructor( base: RestError ) {
		super( base.message, {
			status: base.status,
			code: base.code,
			data: base.data,
			serverMessage: base.serverMessage,
		} );
		this.name = 'SuggestionsError';
		this.reason = suggestionsFailure( base );
	}
}

function suggestionsFailure( err: RestError ): SuggestionsFailure {
	if ( err.code === 'openstation_ai_unavailable' ) {
		return 'no-provider';
	}
	const reason = ( err.data as { reason?: unknown } | undefined )?.reason;
	return reason === 'quota' || reason === 'auth' || reason === 'unavailable'
		? reason
		: 'other';
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
		throw new SuggestionsError( await restErrorFromResponse( res ) );
	}
	return res.json() as Promise< DraftSuggestions >;
}

function connectorsUrl(): string {
	const win = window as unknown as {
		openStationConfig?: { aiAssistant?: { connectorsUrl?: string } };
	};
	return win.openStationConfig?.aiAssistant?.connectorsUrl ?? '';
}

interface ApplyFields {
	title?: string;
	excerpt?: string;
	tags?: string[];
	categories?: string[];
}

async function applyDraftField(
	id: number,
	fields: ApplyFields,
): Promise< void > {
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
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res );
	}
}

function toggleSuggestions(
	id: number,
	row: HTMLElement,
	trigger: HTMLElement,
): void {
	const list = row.parentElement;
	const next = row.nextElementSibling;
	const wasOwnOpen = !! next && next.classList.contains( PANEL_CLASS );

	list?.querySelectorAll( `.${ PANEL_CLASS }` ).forEach( ( p ) => p.remove() );
	list?.querySelectorAll( '.dm-drafts__spark' ).forEach( ( t ) =>
		t.setAttribute( 'aria-expanded', 'false' ),
	);
	if ( wasOwnOpen ) {
		return;
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

function loadingState(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'dm-drafts__suggest-loading';

	wrap.setAttribute( 'aria-live', 'polite' );

	const spinner = document.createElement( 'os-spinner' );
	spinner.setAttribute( 'preset', 'inline' );
	spinner.setAttribute( 'size', '14' );
	wrap.appendChild( spinner );

	const label = document.createElement( 'span' );
	label.textContent = __( 'Thinking…' );
	wrap.appendChild( label );

	return wrap;
}

function notice( tone: string, message?: string, icon?: string ): HTMLElement {
	const el = document.createElement( 'os-notice' );
	el.className = 'dm-drafts__notice';
	el.setAttribute( 'tone', tone );
	el.setAttribute( 'not-dismissible', '' );
	if ( icon ) {
		el.setAttribute( 'icon', icon );
	}
	if ( message !== undefined ) {
		el.textContent = message;
	}
	return el;
}

function failureNotice( reason: SuggestionsFailure ): HTMLElement {
	const messages: Record< SuggestionsFailure, string > = {
		'no-provider': __( 'No AI provider is set up.' ),
		quota: __(
			'The AI provider has no credits left or is rate limiting this site. Check its plan and billing, or try again later.',
		),
		auth: __( 'The AI provider rejected this site’s API key.' ),
		unavailable: __( 'The AI provider could not be reached. Try again in a moment.' ),
		other: __( 'Could not get suggestions.' ),
	};
	const el = notice( 'error', messages[ reason ] );

	const url = connectorsUrl();
	if ( url && ( reason === 'no-provider' || reason === 'auth' ) ) {
		el.append( ' ' );
		const link = document.createElement( 'a' );
		link.href = url;
		link.textContent =
			reason === 'auth'
				? __( 'Check it in Connectors.' )
				: __( 'Add one in Connectors.' );
		link.dataset.osWindowTitle = __( 'Connectors' );
		el.appendChild( link );
	}
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
	} catch ( err ) {
		if ( panel.isConnected ) {
			panel.replaceChildren(
				failureNotice(
					err instanceof SuggestionsError ? err.reason : 'other',
				),
			);
		}
	}
}

function applyButton(
	id: number,
	text: string,
	variantClass: string,
	fields: ApplyFields,
	onOk?: () => void,
): HTMLElement {
	const btn = document.createElement( 'os-button' );
	btn.setAttribute( 'variant', 'ghost' );
	btn.className = variantClass;
	btn.textContent = text;
	btn.title = __( 'Apply to the draft' );
	btn.addEventListener( 'click', () => {
		if ( btn.hasAttribute( 'busy' ) || btn.classList.contains( 'is-applied' ) ) {
			return;
		}
		btn.setAttribute( 'busy', '' );
		void applyDraftField( id, fields )
			.then( () => {
				btn.removeAttribute( 'busy' );
				btn.setAttribute( 'aria-disabled', 'true' );
				btn.classList.add( 'is-applied' );
				const check = document.createElement( 'span' );
				check.className = 'dm-drafts__applied-check';
				check.setAttribute( 'aria-hidden', 'true' );
				check.textContent = '✓';
				btn.appendChild( check );

				const applied = document.createElement( 'span' );
				applied.className = 'screen-reader-text';
				applied.textContent = __( 'applied' );
				btn.appendChild( applied );
				onOk?.();
			} )
			.catch( ( err: unknown ) => {
				btn.removeAttribute( 'busy' );
				toastRestFailure( shellToast, err, {
					fallback: __( 'Could not apply the suggestion.' ),
				} );
			} );
	} );
	return btn;
}

function readinessNotice( readiness: DraftSuggestions[ 'readiness' ] ): HTMLElement {
	const missing = readiness.missing ?? [];
	const ready = missing.length === 0;
	const el = notice(
		ready ? 'success' : 'warning',
		undefined,
		ready ? 'dashicons-yes-alt' : 'dashicons-info-outline',
	);
	el.classList.add( 'dm-drafts__readiness' );

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
					shellToast( { message: __( 'Title updated.' ) } );
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
				() => shellToast( { message: __( 'Excerpt updated.' ) } ),
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
					() => shellToast( { message: __( 'Tag added.' ) } ),
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
					() => shellToast( { message: __( 'Category added.' ) } ),
				),
			);
		}
		g.appendChild( wrap );
	}
}

const WIDGET_ID = 'desktop-mode/drafts';
const REFRESH_MS = 60_000;

const POSTS_CHANGED_TOPIC = 'os.post.changed';
const LIMIT = 8;

interface DraftRow {
	id: number;
	title: { rendered?: string; raw?: string };

	modified_gmt: string;
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

	if ( secs < 3600 ) {
		return sprintf(

			__( '%dm ago' ),
			Math.floor( secs / 60 ),
		);
	}
	if ( secs < 86400 ) {
		return sprintf(

			__( '%dh ago' ),
			Math.floor( secs / 3600 ),
		);
	}
	return sprintf(

		__( '%dd ago' ),
		Math.floor( secs / 86400 ),
	);
}

async function fetchDrafts(): Promise< DraftRow[] > {
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
		throw await restErrorFromResponse( res );
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

function rowAction(
	className: string,
	dashicon: string,
	label: string,
): HTMLElement {
	const btn = document.createElement( 'os-button' );
	btn.className = className;
	btn.setAttribute( 'variant', 'ghost' );

	btn.title = label;

	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ dashicon }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	btn.appendChild( icon );

	const name = document.createElement( 'span' );
	name.className = 'screen-reader-text';
	name.textContent = label;
	btn.appendChild( name );
	return btn;
}

function renderList(
	container: HTMLElement,
	drafts: DraftRow[] | null,
	error: string | null,
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
		err.textContent = error;
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

		row.dataset.draftId = String( d.id );

		const link = document.createElement( 'a' );
		link.className = 'dm-drafts__link';
		link.href = editUrl( d.id );

		const titleText = draftTitle( d );

		const name = document.createElement( 'span' );
		name.className = 'dm-drafts__name';
		name.textContent = titleText;

		const time = document.createElement( 'span' );
		time.className = 'dm-drafts__time';
		time.textContent = timeAgo( d.modified_gmt );

		link.appendChild( name );
		link.appendChild( time );

		link.dataset.osWindowTitle = titleText;

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

async function onTrash(
	draft: DraftRow,
	row: HTMLElement,
	onChange: () => void,
): Promise< void > {
	const api = desktopApi();

	if ( ! api?.confirm ) {
		return;
	}
	const ok = await api.confirm( {
		title: __( 'Move to Trash?' ),
		message: sprintf(

			__( '“%s” will be moved to the Trash. You can restore it later.' ),
			draftTitle( draft ),
		),
		confirmLabel: __( 'Move to Trash' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}

	row.classList.add( 'is-trashing' );
	try {
		await trashDraft( draft.id );
		shellToast( { message: __( 'Draft moved to Trash.' ) } );
		onChange();
	} catch ( err ) {
		row.classList.remove( 'is-trashing' );
		toastRestFailure( shellToast, err, {
			fallback: __( 'Could not move the draft to Trash.' ),
		} );
	}
}

interface FocusMark {
	id: number;
	control: string;
	index: number;
}

function markFocus( container: HTMLElement ): FocusMark | null {
	const active = container.ownerDocument.activeElement;
	if ( ! ( active instanceof HTMLElement ) || ! container.contains( active ) ) {
		return null;
	}
	const row = active.closest< HTMLElement >( '.dm-drafts__row' );
	if ( ! row?.dataset.draftId ) {
		return null;
	}
	const rows = Array.from( container.querySelectorAll( '.dm-drafts__row' ) );
	const control = [ 'dm-drafts__trash', 'dm-drafts__spark' ].find( ( c ) =>
		active.classList.contains( c ),
	);
	return {
		id: Number( row.dataset.draftId ),
		control: control ?? 'dm-drafts__link',
		index: rows.indexOf( row ),
	};
}

function restoreFocus( container: HTMLElement, mark: FocusMark | null ): void {
	const doc = container.ownerDocument;
	const active = doc.activeElement;
	if ( ! mark || ( active && active !== doc.body ) ) {
		return;
	}
	const rows = Array.from(
		container.querySelectorAll< HTMLElement >( '.dm-drafts__row' ),
	);
	const row =
		rows.find( ( r ) => Number( r.dataset.draftId ) === mark.id ) ??
		rows[ Math.min( mark.index, rows.length - 1 ) ];
	const target =
		row?.querySelector< HTMLElement >( `.${ mark.control }` ) ??
		row?.querySelector< HTMLElement >( '.dm-drafts__link' );
	target?.focus( { preventScroll: true } );
}

function render(
	container: HTMLElement,
	drafts: DraftRow[] | null,
	error: string | null,
	onChange: () => void,
): void {
	const mark = markFocus( container );
	renderList( container, drafts, error, onChange );
	restoreFocus( container, mark );
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

		if ( container.querySelector( `.${ PANEL_CLASS }` ) ) {
			return;
		}
		try {
			const drafts = await fetchDrafts();
			if ( ! destroyed ) {
				render( container, drafts, null, refresh );
			}
		} catch ( err ) {
			if ( ! destroyed ) {
				render(
					container,
					null,
					describeRestFailure( err, { fallback: __( 'Could not load drafts.' ) } ).message,
					refresh,
				);
			}
		}
	};
	await refresh();
	const poller = startVisibilityAwarePoller( refresh, REFRESH_MS );

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
	const onBroadcast = ( e: Event ): void => {
		const topic = ( e as CustomEvent< { topic?: string } | null > ).detail?.topic;
		if ( topic === POSTS_CHANGED_TOPIC ) {
			nudge();
		}
	};
	document.addEventListener( 'os-window-closed', nudge );
	document.addEventListener( 'os-window-blurred', nudge );
	document.addEventListener( 'os-broadcast', onBroadcast );

	return () => {
		destroyed = true;
		poller.stop();
		if ( nudgeTimer !== null ) {
			clearTimeout( nudgeTimer );
		}
		document.removeEventListener( 'os-window-closed', nudge );
		document.removeEventListener( 'os-window-blurred', nudge );
		document.removeEventListener( 'os-broadcast', onBroadcast );
	};
};

const w = window as unknown as {
	openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
