/**
 * OpenStation — the address a window's "Copy link" hands out.
 *
 * The link is the page's own wp-admin URL with the shell's flags and
 * the request's nonces removed. No new routing is needed to open it:
 * for someone in OpenStation the plain-admin redirect forwards it into
 * the shell as a window, anyone else gets the classic page, a signed-out
 * visitor goes through `wp-login.php` first, and the page's own
 * capability check refuses anyone without access.
 *
 * A native window has no page of its own, but two kinds of them still
 * show one, and those share it the same way:
 *
 *   1. An admin page embedded in the window (`wp.os.embedAdminPage()`,
 *      or a window registered with `iframeContent`): the editor in
 *      Posts → Add Post is the real `post-new.php`, so its link is
 *      the draft's own URL once saved.
 *   2. A window that declared a menu (`App::menu()`): each tab stands
 *      for a wp-admin screen, so the visible tab shares that screen.
 *      It opens the same tab for anyone in OpenStation, through the
 *      remap that claims those pages, and the classic screen for
 *      anyone else.
 *
 * Anything else has no address anyone else could open, and no link.
 */
import { getSyntheticIframe } from '../connection';
import { isShellDocumentUrl } from '../shell-url';
import { createSharedStore } from '../shared-store';

import type { Window } from './index';

/** Query args that belong to this session or this request, never to the page. */
const PRIVATE_ARGS = [
	'openstation_chromeless',
	'openstation_solo',
	'desktop_mode_portal',
	'desktop_mode_portal_intent',
	'desktop_mode_classic',
	'_wpnonce',
	'_ajax_nonce',
	'_wp_http_referer',
	'preview_nonce',
];

/**
 * The shareable form of `raw`, or `''` when there is nothing safe to
 * share: another origin, a non-web scheme, embedded credentials, or the
 * shell screen itself.
 */
export function shareableUrl( raw: string, origin: string ): string {
	let url: URL;
	try {
		url = new URL( raw, origin );
	} catch {
		return '';
	}
	if (
		url.origin !== new URL( origin ).origin ||
		! [ 'http:', 'https:' ].includes( url.protocol ) ||
		url.username ||
		url.password ||
		isShellDocumentUrl( url )
	) {
		return '';
	}
	// Re-serialise only a query that carried something to drop, so the
	// page's own spelling of its args survives untouched.
	if ( PRIVATE_ARGS.some( ( key ) => url.searchParams.has( key ) ) ) {
		PRIVATE_ARGS.forEach( ( key ) => url.searchParams.delete( key ) );
	}
	return url.href;
}

/** One tab of a window that declared a menu, and the screen it stands for. */
export interface MenuPage {
	id: string;
	page: string;
}

/**
 * Each native window's menu pages, by window id. Written by the
 * native-window sync in the shell bundle, read by the ⋯ menu in the
 * window bundle, so it lives in a shared store (AGENTS.md,
 * "Cross-bundle state").
 */
const menuPagesStore = createSharedStore< { pages: Map< string, MenuPage[] > } >(
	'desktop-mode/window-menu-pages',
	() => ( { pages: new Map() } ),
);

/**
 * Record the admin pages a native window answers for. An empty list
 * forgets them: the window is no longer the one in charge of its menu.
 *
 * @param windowId Native window id.
 * @param pages    The window's menu pages.
 */
export function setWindowMenuPages( windowId: string, pages: MenuPage[] ): void {
	if ( pages.length ) {
		menuPagesStore.state.pages.set( windowId, pages );
	} else {
		menuPagesStore.state.pages.delete( windowId );
	}
}

/**
 * Remember where an embedded admin page says it is. The block editor
 * is sent with `Document-Isolation-Policy` in Chromium, so the shell
 * cannot read the frame and only knows what the frame reports
 * (`os-iframe-navigated`, `os-iframe-location`). Kept on the element,
 * with the `src` it was reported under: a report stops applying once
 * the shell points the frame somewhere else.
 *
 * @param iframe The embedded frame.
 * @param url    The URL it reported.
 */
export function recordFrameLocation( iframe: HTMLIFrameElement, url: string ): void {
	iframe.dataset.osLocation = url;
	iframe.dataset.osLocationSrc = iframe.src;
}

/** Where an embedded frame is now: its own location, its report, or its `src`. */
function frameLocation( iframe: HTMLIFrameElement ): string {
	try {
		const href = iframe.contentWindow?.location.href;
		if ( href && href !== 'about:blank' ) {
			return href;
		}
	} catch {
		// Isolated: fall through to what it reported.
	}
	const { osLocation, osLocationSrc } = iframe.dataset;
	return osLocation && osLocationSrc === iframe.src ? osLocation : iframe.src;
}

/**
 * The screen a menu window's visible tab stands for: the page of the
 * first tab strip value that names one of its tabs, or the only page
 * when the window has just one. `''` when neither answers.
 *
 * @param pages     The window's menu pages.
 * @param tabValues The values of the tab strips in the window.
 */
export function menuPageFor( pages: MenuPage[], tabValues: string[] ): string {
	const active = tabValues
		.map( ( value ) => pages.find( ( page ) => page.id === value ) )
		.find( Boolean );
	if ( active ) {
		return active.page;
	}
	return pages.length === 1 ? pages[ 0 ].page : '';
}

/**
 * The shareable link of a native window, or `''` when it has none.
 *
 * @param win    The native window.
 * @param origin The shell's origin.
 */
export function nativeShareableUrl( win: Window, origin: string ): string {
	// A visible embedded page wins: it is what the window is showing.
	// One left mounted in a hidden tab is not.
	const frame = getSyntheticIframe( win.id );
	if ( frame && frame.isConnected && frame.getClientRects().length > 0 ) {
		const link = shareableUrl( frameLocation( frame ), origin );
		if ( link ) {
			return link;
		}
	}
	const pages = menuPagesStore.state.pages.get( win.config.baseId || win.id ) ?? [];
	if ( ! pages.length ) {
		return '';
	}
	const tabValues = Array.from(
		win.element.querySelectorAll< HTMLElement & { value?: unknown } >( 'os-tabs' ),
		( strip ) => String( strip.value ?? strip.getAttribute( 'value' ) ?? '' ),
	);
	const page = menuPageFor( pages, tabValues );
	// Menu pages are relative to the admin the shell is served from,
	// which is the network admin for a network window.
	return page ? shareableUrl( new URL( page, new URL( '.', window.location.href ) ).href, origin ) : '';
}
