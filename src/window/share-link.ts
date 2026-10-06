/**
 * Window addresses, painted in an optional status bar along each window's
 * bottom edge, and the shell's one-shot `app` boot instruction.
 *
 * An address is as canonical as the window allows. An iframe window's is
 * the page's own URL, minus shell flags and nonces: a plain admin URL
 * already opens as a window for anyone in OpenStation (the plain-admin
 * redirect in `includes/portal.php`) and as the classic page for anyone
 * else. A native window has no page of its own, so its address names the
 * app on the shell screen: `admin.php?page=openstation&app=<id>`.
 */
import type { WindowConfig } from '../types';
import type { Window } from './index';
import { HOOKS, applyFilters } from '../hooks';
import { SHELL_PAGE_SLUG, isShellDocumentUrl } from '../shell-url';
import { __ } from '../i18n';
import { copyText } from '../app-runtime/clipboard';
import { showToast } from '../toast';

/** Query arg on the shell screen naming the native app to open. */
export const SHELL_APP_ARG = 'app';

export type AppLinkTarget = { app: string };

const APP_ID = /^[a-zA-Z0-9_/-]+$/;
const PRIVATE_ARGS = [
	'openstation_chromeless',
	'desktop_mode_portal',
	'desktop_mode_detach',
	'openstation_solo',
	'_wpnonce',
	'_ajax_nonce',
];

/** Strip shell flags and request credentials from a same-origin page address. */
function pageAddress( raw: string, adminUrl: string ): URL | null {
	try {
		const url = new URL( raw, adminUrl );
		if (
			url.origin !== new URL( adminUrl ).origin ||
			! [ 'http:', 'https:' ].includes( url.protocol ) ||
			url.username || url.password || isShellDocumentUrl( url )
		) {
			return null;
		}
		// Only re-serialise a query that carried something to drop, so
		// the page's own spelling of its args survives untouched.
		if ( PRIVATE_ARGS.some( ( key ) => url.searchParams.has( key ) ) ) {
			PRIVATE_ARGS.forEach( ( key ) => url.searchParams.delete( key ) );
		}
		// The Dashboard is the admin root, not its file.
		const root = new URL( adminUrl );
		if ( url.pathname === `${ root.pathname }index.php` && ! url.search ) {
			url.pathname = root.pathname;
		}
		return url;
	} catch {
		return null;
	}
}

/** Build the canonical address of this window; '' when it has none. */
export function buildAppLink(
	config: Pick< WindowConfig, 'id' | 'baseId' | 'native' >,
	currentUrl: string,
	adminUrl: string,
): string {
	if ( config.native ) {
		const id = config.baseId || config.id;
		// The id alphabet is query-safe, so it is written as-is rather
		// than percent-encoding its slashes.
		return APP_ID.test( id )
			? new URL( `admin.php?page=${ SHELL_PAGE_SLUG }&${ SHELL_APP_ARG }=${ id }`, adminUrl ).href
			: '';
	}
	return pageAddress( currentUrl, adminUrl )?.href ?? '';
}

/** Read the shell screen's `app` instruction, when it carries a valid one. */
export function readAppLink( address: string ): AppLinkTarget | null {
	let shell: URL;
	try {
		shell = new URL( address );
	} catch {
		return null;
	}
	if ( ! isShellDocumentUrl( shell ) ) {
		return null;
	}
	const app = shell.searchParams.get( SHELL_APP_ARG );
	return app && APP_ID.test( app ) ? { app } : null;
}

const COPY_ICON =
	'<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">' +
	'<rect x="5.5" y="5.5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
	'<path d="M3.5 10.5h-.5A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h5A1.5 1.5 0 0 1 9.5 3v.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
	'</svg>';
const COPIED_ICON =
	'<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">' +
	'<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
	'</svg>';
/** How long the copied tick stays before the copy glyph returns. */
const COPIED_MS = 1200;

/**
 * The copy affordance: a bare glyph, not an `<os-window-button>`, whose
 * 30px title-bar box would double the height of a one-line status bar.
 * Confirms in place with a tick; only a failure raises a toast.
 */
function createCopyButton( text: HTMLElement ): HTMLButtonElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'os-window__app-link-copy';
	button.innerHTML = COPY_ICON;
	button.setAttribute( 'aria-label', __( 'Copy link' ) );
	button.title = __( 'Copy link' );
	let timer = 0;
	button.addEventListener( 'click', async () => {
		if ( ! await copyText( text.textContent ?? '' ) ) {
			showToast( { message: __( 'Could not copy the link.' ) } );
			return;
		}
		window.clearTimeout( timer );
		button.innerHTML = COPIED_ICON;
		button.classList.add( 'is-copied' );
		button.setAttribute( 'aria-label', __( 'Link copied' ) );
		button.title = __( 'Link copied' );
		timer = window.setTimeout( () => {
			button.innerHTML = COPY_ICON;
			button.classList.remove( 'is-copied' );
			button.setAttribute( 'aria-label', __( 'Copy link' ) );
			button.title = __( 'Copy link' );
		}, COPIED_MS );
	} );
	return button;
}

/** Paint the address as plain selectable text in a status bar below the content. */
export function mountAppLink( win: Window ): void {
	let row = win.element.querySelector< HTMLElement >( ':scope > .os-window__app-link' );
	if ( ! row ) {
		row = document.createElement( 'div' );
		row.className = 'os-window__app-link';
		const text = document.createElement( 'span' );
		text.className = 'os-window__app-link-text';
		text.tabIndex = 0;
		text.setAttribute( 'role', 'textbox' );
		text.setAttribute( 'aria-readonly', 'true' );
		text.setAttribute( 'aria-label', __( 'App link' ) );
		// Keep text selection out of the window's bubbling keyboard shortcuts.
		text.addEventListener( 'keydown', ( event ) => {
			if ( ( event.metaKey || event.ctrlKey ) && event.key.toLowerCase() === 'a' ) {
				event.preventDefault();
				event.stopPropagation();
				const range = document.createRange();
				range.selectNodeContents( text );
				const selection = text.ownerDocument.defaultView?.getSelection();
				selection?.removeAllRanges();
				selection?.addRange( range );
			}
		} );
		row.append( createCopyButton( text ), text );
		const body = win.element.querySelector( ':scope > .os-window__body' );
		win.element.insertBefore( row, body ? body.nextSibling : null );
	}
	paintAppLink( win, win.config.url );
}

/** Refresh an existing row; a custom chrome may deliberately remove it. */
export function paintAppLink( win: Window, currentUrl?: string ): void {
	const row = win.element.querySelector< HTMLElement >( ':scope > .os-window__app-link' );
	const text = row?.querySelector< HTMLElement >( '.os-window__app-link-text' );
	if ( ! row || ! text ) {
		return;
	}
	const contentUrl = currentUrl ?? win.getCurrentUrl();
	const adminUrl = ( window as unknown as {
		openStationConfig?: { adminUrl?: string };
	} ).openStationConfig?.adminUrl ?? new URL( '.', window.location.href ).href;
	const url = buildAppLink( win.config, contentUrl, adminUrl );
	const filtered = applyFilters< string, [ { windowId: string; config: WindowConfig; url: string } ] >(
		HOOKS.WINDOW_SHARE_URL, url, { windowId: win.id, config: win.config, url: contentUrl },
	);
	text.textContent = typeof filtered === 'string' ? filtered : '';
	text.title = text.textContent;
	row.hidden = ! text.textContent;
}
