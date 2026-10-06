/**
 * OpenStation — the "Share" title-bar button.
 *
 * A window is a WordPress page, and a WordPress page already has an
 * address anyone can be sent: its own wp-admin URL. The portal turns a
 * plain admin GET into "open this page in the desktop"
 * (`openstation_redirect_plain_admin_to_portal()`), WordPress sends a
 * signed-out visitor through the login screen and back, and the page
 * itself decides whether the visitor may see it. So sharing a window
 * needs no token and no new route — only the window's current URL with
 * the shell's own plumbing taken off it, shown where it can be copied.
 *
 * Registered through the public `registerTitleBarButton` surface as
 * `desktop-mode/share-url`, on every window whose page has such an
 * address: same-origin iframe windows. Native windows have no URL of
 * their own, and a cross-origin page is not "this window" for anyone
 * else.
 */

import { copyText } from '../app-runtime/clipboard';
import { __ } from '../i18n';
import { isShellDocumentUrl } from '../shell-url';
import { registerTitleBarButton } from '../title-bar-buttons/registry';

import type { Window as DesktopWindow } from '../window';

/**
 * Query args that belong to the session that loaded the page, not to
 * the page. The first four are OpenStation's own flags — a URL
 * carrying `desktop_mode_classic` would open the recipient in classic
 * wp-admin, and `openstation_chromeless` would render the page without
 * its admin chrome. The nonces are bound to the sender's user and
 * session: worthless to anyone else, and not something to hand out.
 *
 * Core's transient notice args (`message`, `updated`, …) need no entry
 * here: `wp_admin_canonical_url()` already `replaceState`s them out of
 * every admin page's own address.
 */
const SESSION_ARGS = [
	'openstation_chromeless',
	'desktop_mode_portal',
	'desktop_mode_portal_intent',
	'desktop_mode_classic',
	'_wpnonce',
	'_wp_http_referer',
	'preview_nonce',
];

/**
 * The address to hand someone else for a window showing `raw`, or
 * `null` when the page has none worth sharing.
 *
 * @param raw    The window's current URL.
 * @param origin The shell's own origin.
 */
export function shareableUrl( raw: string, origin: string ): string | null {
	let url: URL;
	try {
		url = new URL( raw, origin );
	} catch {
		return null;
	}
	if ( url.origin !== origin || isShellDocumentUrl( url ) ) {
		return null;
	}
	for ( const arg of SESSION_ARGS ) {
		url.searchParams.delete( arg );
	}
	return url.href;
}

/** The window's shareable address, or `null`. */
function shareableUrlOf( win: DesktopWindow ): string | null {
	if ( win.config.native ) {
		return null;
	}
	return shareableUrl( win.getCurrentUrl(), window.location.origin );
}

/** A Share panel with its close routine attached. */
type SharePanelElement = HTMLElement & { _osShareClose?: () => void };

/** Close any open Share panel inside a window's element. */
function closePanels( root: HTMLElement | undefined ): void {
	root
		?.querySelectorAll< SharePanelElement >( '.os-window__share-panel' )
		.forEach( ( el ) => {
			if ( el._osShareClose ) {
				el._osShareClose();
			} else {
				el.remove();
			}
		} );
}

/** Select the whole value of an `<os-text-field>`'s inner input. */
function selectField( field: HTMLElement ): void {
	const input = field.shadowRoot?.querySelector( 'input' );
	if ( input ) {
		input.focus( { preventScroll: true } );
		input.select();
	}
}

/**
 * Open the Share panel under the button, wiring outside-pointerdown
 * dismissal and Escape-to-close — the recipe the Related and ⋯ menus
 * use. The URL is read now rather than at paint time, so a window that
 * navigated since the title bar last repainted shares where it is.
 */
function openSharePanel( host: HTMLElement, win: DesktopWindow ): void {
	const titleBar = host.closest< HTMLElement >( '.os-window__titlebar' );
	const url = shareableUrlOf( win );
	if ( ! titleBar || ! url ) {
		return;
	}

	const panel: SharePanelElement = document.createElement( 'div' );
	// `menu-panel` carries the dropdown positioning AND the title-bar
	// drag tracker's exclusion (`src/window/pointer.ts`); without it a
	// pointerdown in the field starts a window drag.
	panel.classList.add( 'os-window__menu-panel', 'os-window__share-panel' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-label', __( 'Share link' ) );

	const hint = document.createElement( 'p' );
	hint.className = 'os-window__share-hint';
	hint.textContent = __(
		'Anyone with access to this page can open it with this link.',
	);

	const row = document.createElement( 'div' );
	row.className = 'os-window__share-row';

	const field = document.createElement( 'os-text-field' );
	field.setAttribute( 'label', __( 'Link' ) );
	field.setAttribute( 'hide-label', '' );
	field.setAttribute( 'readonly', '' );
	field.setAttribute( 'value', url );
	field.addEventListener( 'focusin', () => selectField( field ) );

	const copy = document.createElement( 'os-button' );
	copy.setAttribute( 'variant', 'primary' );
	copy.textContent = __( 'Copy' );

	// Spoken confirmation. The button's own relabel is not announced
	// reliably, and a toast would land far from where the user looks.
	const status = document.createElement( 'span' );
	status.className = 'screen-reader-text';
	status.setAttribute( 'role', 'status' );

	let resetLabel: ReturnType< typeof setTimeout > | null = null;
	copy.addEventListener( 'click', async () => {
		const copied = await copyText( url );
		copy.textContent = copied ? __( 'Copied' ) : __( 'Copy' );
		status.textContent = copied
			? __( 'Link copied to the clipboard.' )
			: __( 'Could not copy. Select the link and copy it yourself.' );
		if ( ! copied ) {
			selectField( field );
		}
		if ( resetLabel ) {
			clearTimeout( resetLabel );
		}
		resetLabel = setTimeout( () => {
			copy.textContent = __( 'Copy' );
		}, 2000 );
	} );

	row.append( field, copy );
	panel.append( hint, row, status );

	let onDocPointerDown: ( ( e: PointerEvent ) => void ) | null = null;
	const close = (): void => {
		if ( onDocPointerDown ) {
			document.removeEventListener( 'pointerdown', onDocPointerDown, true );
			onDocPointerDown = null;
		}
		if ( resetLabel ) {
			clearTimeout( resetLabel );
		}
		titleBar.removeEventListener( 'keydown', onTitleBarKeydown );
		panel.remove();
		host.setAttribute( 'aria-expanded', 'false' );
	};

	// Bound on the title bar so Escape is seen whether focus is on the
	// trigger or inside the panel.
	const onTitleBarKeydown = ( e: Event ): void => {
		if ( ( e as KeyboardEvent ).key === 'Escape' ) {
			e.stopPropagation();
			close();
			host.focus();
		}
	};

	panel._osShareClose = close;
	titleBar.appendChild( panel );
	titleBar.addEventListener( 'keydown', onTitleBarKeydown );
	host.setAttribute( 'aria-expanded', 'true' );

	onDocPointerDown = ( e: PointerEvent ) => {
		const target = e.target as Node | null;
		if ( ! target || panel.contains( target ) || host.contains( target ) ) {
			return;
		}
		close();
	};
	// Next tick, so the pointerdown that opened the panel doesn't close it.
	setTimeout( () => {
		if ( onDocPointerDown ) {
			document.addEventListener( 'pointerdown', onDocPointerDown, true );
		}
	}, 0 );

	// The field renders on connect; select once it has.
	requestAnimationFrame( () => selectField( field ) );
}

/**
 * Register the built-in Share title-bar button. Called once from the
 * `desktop.ts` boot.
 */
export function bootShareUrl(): void {
	registerTitleBarButton( {
		id: 'desktop-mode/share-url',
		label: __( 'Share link' ),
		icon: 'dashicons-share',
		placement: 'right',
		order: 50, // Before Preview (55) and Related (60).
		match: ( win ) => shareableUrlOf( win ) !== null,
		render: ( host, win ) => {
			// Repaints replace the host element; a panel left open would
			// keep a close routine pointing at the detached one.
			closePanels( win.element );
			host.setAttribute( 'aria-haspopup', 'dialog' );
			host.setAttribute( 'aria-expanded', 'false' );
			host.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				if ( win.element?.querySelector( '.os-window__share-panel' ) ) {
					closePanels( win.element );
					return;
				}
				openSharePanel( host, win );
			} );
		},
	} );
}
