import { doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import { addExternalTab } from './tabs';
import type { Window } from './index';
import { dispatchFromWindow, markWindowContentReady } from '../window-channels';
import { tryNativeUrlRemap } from '../native-url-remap';
import { createSharedStore } from '../shared-store';
import { matchDestructiveAdminAction } from '../destructive-admin-actions';
import { setWindowContent } from '../window-links/engine';
import { openUserFootprintWindow } from '../open-targets/footprint-target';

const INITIAL_ORIGIN = window.location.origin;

export interface AdminLinkDockEntry {
	title: string;

	selfLabel?: string;
	icon: string;

	url?: string;
	submenu?: { title: string; url: string; offSite?: boolean }[];
	multi?: boolean;
}

interface AdminLinkDispatchDeps {

	adminUrl: string;

	deriveSlug( url: string ): string;

	openWindow( config: {
		id: string;
		baseId: string;
		url: string;
		parentUrl?: string;
		title: string;
		titleFromPage?: boolean;
		icon: string;
		submenu?: { title: string; url: string; offSite?: boolean }[];
		selfLabel?: string;
		multi?: boolean;
	} ): void;

	findDockEntry( url: string ): AdminLinkDockEntry | null;

	openOtherAdmin?: ( url: string ) => void;
}

interface AdminLinkDepsState {
	deps: AdminLinkDispatchDeps | null;
}
const adminLinkDepsStore = createSharedStore< AdminLinkDepsState >(
	'desktop-mode/admin-link-deps',
	() => ( { deps: null } ),
);

export function bindAdminLinkDispatch(
	deps: AdminLinkDispatchDeps | null,
): void {
	adminLinkDepsStore.state.deps = deps;
}

export function handleWindowMessage( win: Window, event: MessageEvent ): void {
	if ( event.origin !== INITIAL_ORIGIN ) {
		return;
	}
	if ( ! win.iframe || event.source !== win.iframe.contentWindow ) {
		return;
	}

	const data = event.data;
	if ( ! data || typeof data.type !== 'string' ) {
		return;
	}

	if ( data.type === 'os-title-change' && typeof data.title === 'string' ) {
		win._hasExplicitTitle = true;
		win.setTitle( data.title );
	}

	if ( data.type === 'os-content-identity' ) {
		setWindowContent( win.id, data.identity ?? null, {
			source: 'bridge',
		} );
	}

	if (
		data.type === 'os-window-publish' &&
		typeof data.channel === 'string' &&
		data.channel !== ''
	) {
		dispatchFromWindow( win.id, data.channel, data.payload );
	}

	if ( typeof data.type === 'string' && data.type.startsWith( 'os-bridge-' ) ) {
		const bridge = (
			window as unknown as {
				__openStationConnectionBridge?: {
					routeIncomingFromIframe(
						msg: unknown,
						fromWindowId?: string,
					): void;
				};
			}
		).__openStationConnectionBridge;
		bridge?.routeIncomingFromIframe( data, win.id );
	}

	if ( data.type === 'os-iframe-navigated' ) {
		if (
			typeof data.url === 'string' &&
			! canReadFrameLocation( win ) &&
			handleFinishedScreenHandoff( win, data.url )
		) {
			return;
		}
		win._hasExplicitTitle = false;
		win._settleNavigationActivity();

		if ( typeof data.url === 'string' && data.url !== '' && win.iframe ) {
			win._reportedLocation = { url: data.url, src: win.iframe.src };
		}
	}

	if ( data.type === 'os-ready' ) {
		win._iframeBridgeReady = true;

		win._clearDeferredNavigation();

		if ( ! win._settleNavigationActivity( true ) ) {
			win._resetActivity();
		}

		markWindowContentReady( win.id );
		doAction( HOOKS.IFRAME_READY, { windowId: win.id } );
	}

	if ( data.type === 'os-iframe-unloading' ) {
		win._commitDeferredNavigation();
	}

	if ( data.type === 'os-bridge-beforeunload-response' ) {
		if ( win._isDestroyed ) {
			return;
		}
		if ( typeof data.requestId === 'string' && data.requestId !== '' ) {
			return;
		}
		win._closePending = false;
		if ( win._iframeCloseTimeout ) {
			clearTimeout( win._iframeCloseTimeout );
			win._iframeCloseTimeout = null;
		}
		if ( data.prevent ) {
			import( '../ui/components/os-confirm-dialog/os-confirm-dialog' )
				.then( ( { osConfirm } ) =>
					osConfirm( {
						title: typeof data.message === 'string' && data.message ? data.message : __( 'Unsaved changes' ),
						message: __( 'You have unsaved changes. Are you sure you want to close this window?' ),
						confirmLabel: __( 'Close window' ),
						danger: true,
					} ),
				)
				.then( ( confirmed ) => {
					if ( confirmed ) {
						win.destroy();
					}
				} )
				.catch( () => {
					win.destroy();
				} );
		} else {
			win.destroy();
		}
	}

	if (
		data.type === 'os-navigate' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		handleDesktopNavigate(
			win,
			data.url,
			data.target === 'new' ? 'new' : 'self',
		);
	}

	if (
		data.type === 'os-iframe-other-admin-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		adminLinkDepsStore.state.deps?.openOtherAdmin?.( data.url );
	}

	if (
		data.type === 'os-iframe-admin-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		const deps = adminLinkDepsStore.state.deps;
		if ( tryNativeUrlRemap( data.url ) ) {
			if ( data.newContext !== true ) {
				win.close();
			}
		} else if ( deps ) {
			const linkLabel =
				typeof data.label === 'string' ? data.label : '';
			handleCrossPageAdminLink(
				win,
				data.url,
				linkLabel,
				deps,
				data.newContext === true,
			);
		}
	}

	if (
		data.type === 'os-open-user-footprint' &&
		typeof data.userId === 'number' &&
		data.userId > 0
	) {
		openUserFootprintWindow( {
			userId: data.userId,
			userName: typeof data.userName === 'string' ? data.userName : '',
		} );
	}

	if (
		data.type === 'os-notification' &&
		typeof data.title === 'string' &&
		data.title !== ''
	) {
		handleDesktopNotification(
			data.title,
			typeof data.body === 'string' ? data.body : '',
		);
	}

	if ( data.type === 'os-focus-request' ) {
		if ( ! win.element.classList.contains( 'os-window--overview' ) ) {
			win.onFocusRequest?.( win );
		}
	}

	if ( data.type === 'os-screen-meta' && Array.isArray( data.panels ) ) {
		addScreenMetaButtons( win, data.panels as string[] );
	}

	if ( data.type === 'os-screen-meta-state' ) {
		setActiveScreenMetaPanel(
			win,
			typeof data.open === 'string' ? data.open : null,
		);
	}

	if (
		data.type === 'os-external-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		const label = typeof data.label === 'string' && data.label !== ''
			? data.label
			: data.url;
		addExternalTab( win, data.url, label );
	}

	if ( data.type === 'os-iframe-error' ) {
		doAction( HOOKS.IFRAME_ERROR, {
			windowId: win.id,
			kind: data.kind === 'unhandledrejection'
				? 'unhandledrejection'
				: 'error',
			message: typeof data.message === 'string' ? data.message : '',
			filename: typeof data.filename === 'string' ? data.filename : null,
			lineno: typeof data.lineno === 'number' ? data.lineno : null,
			colno: typeof data.colno === 'number' ? data.colno : null,
			stack: typeof data.stack === 'string' ? data.stack : null,
		} );
	}

	if (
		data.type === 'os-chrome-theme' &&
		data.tokens &&
		typeof data.tokens === 'object'
	) {
		try {
			win.setAppearanceTheme(
				data.tokens as Record< string, string >,
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-bridge-chrome-theme',
				windowId: win.id,
				error: err,
			} );
		}
	}

	if (
		data.type === 'os-chrome-controls' &&
		data.config &&
		typeof data.config === 'object'
	) {
		try {
			win.setAppearanceControls(
				data.config as import( '../types' ).WindowControlsConfig,
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-bridge-chrome-controls',
				windowId: win.id,
				error: err,
			} );
		}
	}

	if (
		data.type === 'os-chrome-slot' &&
		typeof data.slot === 'string' &&
		typeof data.html === 'string'
	) {
		try {
			win.setAppearanceSlot(
				data.slot as import( '../types' ).WindowSlotName,
				{ html: data.html },
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-bridge-chrome-slot',
				windowId: win.id,
				error: err,
			} );
		}
	}

	if ( data.type === 'os-iframe-activity' ) {
		if ( data.phase === 'start' ) {
			win._markActivityStart();

			if ( data.navigation ) {
				win._noteNavigationActivity();
			}
		} else if ( data.phase === 'end' ) {
			const failed = !! data.failed;
			const status = typeof data.status === 'number' ? data.status : 0;
			win._markActivitySettled(
				! failed,
				failed ? iframeActivityError( status ) : undefined,
			);
		}
	}

	if ( data.type === 'os-iframe-network' ) {
		const networkPayload: Record< string, unknown > = {
			windowId: win.id,
			method: typeof data.method === 'string' ? data.method : 'GET',
			url: typeof data.url === 'string' ? data.url : '',
			status: typeof data.status === 'number' ? data.status : 0,
			duration: typeof data.duration === 'number' ? data.duration : 0,
			failed: !! data.failed,
		};

		if ( data.requestHeaders && typeof data.requestHeaders === 'object' ) {
			networkPayload.requestHeaders = data.requestHeaders;
		}
		if ( data.responseHeaders && typeof data.responseHeaders === 'object' ) {
			networkPayload.responseHeaders = data.responseHeaders;
		}
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, networkPayload );
	}
}

function iframeActivityError( status: number ): string {
	if ( status <= 0 ) {
		return __( 'Request failed.' );
	}

	return sprintf( __( 'Request failed (HTTP %d).' ), status );
}

function handleDesktopNavigate(
	win: Window,
	rawUrl: string,
	target: 'self' | 'new',
): void {
	let url: URL;
	try {
		url = new URL( rawUrl, INITIAL_ORIGIN );
	} catch {
		return;
	}
	if ( url.origin !== INITIAL_ORIGIN ) {
		return;
	}

	if ( target === 'new' ) {
		window.open( url.toString(), '_blank', 'noopener,noreferrer' );
		return;
	}

	if ( win.iframe ) {
		win.iframe.src = url.toString();
	}
}

const DESTRUCTIVE_ADMIN_ACTIONS: ReadonlySet< string > = new Set( [

	'trash',
	'untrash',
	'delete',

	'spam',
	'unspam',
	'spamcomment',
	'unspamcomment',
	'trashcomment',
	'untrashcomment',
	'deletecomment',
	'approvecomment',
	'unapprovecomment',
] );

function isDestructiveActionUrl( url: URL ): boolean {
	const action = url.searchParams.get( 'action' );
	if ( action && DESTRUCTIVE_ADMIN_ACTIONS.has( action ) ) {
		if (
			url.searchParams.has( '_wpnonce' ) ||
			url.searchParams.has( '_wp_nonce' )
		) {
			return true;
		}
	}

	return matchDestructiveAdminAction( url.toString(), url ) !== null;
}

function stampSourceReferer( url: URL, win: Window ): URL {
	if ( url.searchParams.has( '_wp_http_referer' ) ) {
		return url;
	}
	let sourceHref = '';
	try {
		sourceHref = win.iframe?.contentWindow?.location.href ?? '';
	} catch {

	}
	if ( ! sourceHref ) {
		sourceHref = win.config.url || '';
	}
	if ( ! sourceHref ) {
		return url;
	}
	try {
		const sourceUrl = new URL( sourceHref, INITIAL_ORIGIN );
		if ( sourceUrl.origin !== INITIAL_ORIGIN ) {
			return url;
		}
		const out = new URL( url.href );

		const cleaned = new URL( sourceUrl.href );
		cleaned.searchParams.delete( 'openstation_chromeless' );
		out.searchParams.set(
			'_wp_http_referer',
			cleaned.pathname + ( cleaned.search ? cleaned.search : '' ),
		);
		return out;
	} catch {
		return url;
	}
}

function readLiveSlug( win: Window, deps: AdminLinkDispatchDeps ): string {
	let href = '';
	try {
		href = win.getCurrentUrl?.() ?? '';
	} catch {
		return '';
	}
	if ( ! href || href.startsWith( '#' ) || href === 'about:blank' ) {
		return '';
	}
	try {
		const parsed = new URL( href, deps.adminUrl );
		if ( parsed.origin !== INITIAL_ORIGIN ) {
			return '';
		}
		return deps.deriveSlug( parsed.toString() );
	} catch {
		return '';
	}
}

function isSamePageSlug(
	win: Window,
	targetSlug: string,
	deps: AdminLinkDispatchDeps,
): boolean {
	if ( targetSlug === ( win.config.baseId || win.id ) ) {
		return true;
	}
	const liveSlug = readLiveSlug( win, deps );
	return liveSlug !== '' && liveSlug === targetSlug;
}

function handleCrossPageAdminLink(
	win: Window,
	rawUrl: string,
	linkLabel: string,
	deps: AdminLinkDispatchDeps,
	newContext = false,
): void {
	let url: URL;
	try {
		url = new URL( rawUrl, deps.adminUrl );
	} catch {
		return;
	}
	if ( url.origin !== INITIAL_ORIGIN ) {
		return;
	}

	if ( newContext ) {
		openAdminUrlInOwnWindow( win, url, linkLabel, deps );
		return;
	}

	const absolute = url.toString();
	const targetSlug = deps.deriveSlug( absolute );
	const samePage = isSamePageSlug( win, targetSlug, deps );

	if ( ! samePage && isDestructiveActionUrl( url ) ) {
		const trashUrl = stampSourceReferer( url, win );
		const inner = win.iframe?.contentWindow;
		if ( inner ) {
			try {
				inner.location.assign( trashUrl.href );
			} catch {
				if ( win.iframe ) {
					win.iframe.src = trashUrl.href;
				}
			}
		}
		return;
	}

	if ( samePage ) {
		const inner = win.iframe?.contentWindow;
		if ( inner ) {
			try {
				inner.location.assign( absolute );
			} catch {
				if ( win.iframe ) {
					win.iframe.src = absolute;
				}
			}
		}
		return;
	}

	openAdminUrlInOwnWindow( win, url, linkLabel, deps );
}

function openAdminUrlInOwnWindow(
	win: Window,
	url: URL,
	linkLabel: string,
	deps: AdminLinkDispatchDeps,
): void {
	const absolute = url.toString();
	const targetSlug = deps.deriveSlug( absolute );
	const entry = deps.findDockEntry( absolute );
	const trimmedLabel = linkLabel.trim();
	const title =
		entry?.title || ( trimmedLabel !== '' ? trimmedLabel : targetSlug );

	const urlWithReferer = stampSourceReferer( url, win );

	deps.openWindow( {
		id: targetSlug,
		baseId: targetSlug,
		url: urlWithReferer.toString(),
		parentUrl: entry?.url ?? absolute,
		title,
		titleFromPage: ! entry,
		icon: entry?.icon ?? 'dashicons-admin-generic',
		submenu: entry?.submenu,
		selfLabel: entry?.selfLabel,
		multi: entry?.multi,
	} );
}

function adminFileName( url: string ): string {
	if ( ! url || url.startsWith( '#' ) ) {
		return '';
	}
	try {
		const parsed = new URL( url, INITIAL_ORIGIN );
		if ( parsed.origin !== INITIAL_ORIGIN ) {
			return '';
		}
		return parsed.pathname.split( '/' ).pop() ?? '';
	} catch {
		return '';
	}
}

const HANDOFF_SCREENS: ReadonlySet< string > = new Set( [ 'revision.php' ] );

function navigatedUrl( win: Window, href: string ): string {
	try {
		const timing = win.iframe?.contentWindow?.performance
			?.getEntriesByType?.( 'navigation' );
		const name = timing?.[ 0 ]?.name ?? '';
		if ( name && adminFileName( name ) === adminFileName( href ) ) {
			return name;
		}
	} catch {

	}
	return href;
}

function canReadFrameLocation( win: Window ): boolean {
	try {
		return !! win.iframe?.contentWindow?.location.href;
	} catch {
		return false;
	}
}

export function handleFinishedScreenHandoff(
	win: Window,
	href: string,
): boolean {
	const opened = adminFileName( win.config.url ?? '' );
	if ( ! opened || ! HANDOFF_SCREENS.has( opened ) ) {
		return false;
	}
	const landed = adminFileName( href );
	if ( ! landed || landed === opened ) {
		return false;
	}
	if ( tryNativeUrlRemap( href ) ) {
		win.close();
		return true;
	}
	const deps = adminLinkDepsStore.state.deps;
	if ( ! deps ) {
		return false;
	}
	let url: URL;
	try {
		url = new URL( navigatedUrl( win, href ), deps.adminUrl );
	} catch {
		return false;
	}
	if ( url.origin !== INITIAL_ORIGIN ) {
		return false;
	}

	openAdminUrlInOwnWindow( win, url, '', deps );
	win.close();
	return true;
}

export function adoptPageTitle( win: Window ): void {
	if ( ! win.config.titleFromPage || win._hasExplicitTitle ) {
		return;
	}
	let documentTitle = '';
	try {
		documentTitle = win.iframe?.contentDocument?.title ?? '';
	} catch {
		return;
	}
	const name = adminScreenName( documentTitle );
	if ( name !== '' && name !== win.config.title ) {
		win.setTitle( name );
	}
}

function adminScreenName( documentTitle: string ): string {
	const trimmed = documentTitle.trim();
	const cut = trimmed.indexOf( ' ‹ ' );
	return ( cut > 0 ? trimmed.slice( 0, cut ) : trimmed ).trim();
}

function handleDesktopNotification( title: string, body: string ): void {
	const message = body !== '' ? `${ title } — ${ body }` : title;
	showToast( { message } );
}

export function addScreenMetaButtons( win: Window, panels: string[] ): void {
	const container = win.element.querySelector( '.os-window__screen-meta' );
	if ( ! container ) {
		return;
	}
	container.innerHTML = '';

	const panelConfig: Record<string, { icon: string; label: string }> = {
		'screen-options': { icon: 'dashicons-admin-generic', label: 'Screen Options' },
		help: { icon: 'dashicons-editor-help', label: 'Help' },
	};

	for ( const panel of panels ) {
		const cfg = panelConfig[ panel ];
		if ( ! cfg ) {
			continue;
		}

		const btn = document.createElement( 'button' );
		btn.className = 'os-window__meta-btn';
		btn.setAttribute( 'type', 'button' );
		btn.setAttribute( 'aria-label', cfg.label );
		btn.setAttribute( 'aria-pressed', 'false' );
		btn.dataset.panel = panel;
		btn.innerHTML = `<span class="dashicons ${ cfg.icon }" aria-hidden="true"></span>`;

		btn.addEventListener( 'click', ( e: Event ) => {
			e.stopPropagation();
			win.iframe?.contentWindow?.postMessage(
				{ type: 'os-toggle-panel', panel },
				INITIAL_ORIGIN,
			);
		} );

		container.appendChild( btn );
	}
}

export function setActiveScreenMetaPanel( win: Window, panel: string | null ): void {
	const container = win.element.querySelector( '.os-window__screen-meta' );
	if ( ! container ) {
		return;
	}
	container.querySelectorAll<HTMLElement>( '.os-window__meta-btn' ).forEach( ( btn ) => {
		const isActive = btn.dataset.panel === panel;
		btn.classList.toggle( 'os-window__meta-btn--active', isActive );
		btn.setAttribute( 'aria-pressed', isActive ? 'true' : 'false' );
	} );
}
