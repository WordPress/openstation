/**
 * Desktop Mode — Window iframe postMessage bridge.
 *
 * Handles the parent → chromeless-iframe → parent message bus. The
 * iframe sends title changes, focus requests, external-link intents,
 * and available screen-meta panels; we route each to the appropriate
 * Window method. All messages are origin-gated to the origin captured
 * at module-init time — the chromeless iframe is always same-origin.
 *
 * @since 0.8.1
 */

import { doAction, HOOKS } from '../hooks';
import { showToast } from '../toast';
import { addExternalTab } from './tabs';
import type { Window } from './index';

/**
 * Origin snapshot taken once at module load. Any subsequent mutation
 * of `window.location` (e.g., by a misbehaving plugin script) cannot
 * relax the same-origin check — we always compare against the value
 * that was valid when the shell booted.
 *
 * @since 0.11.0
 */
const INITIAL_ORIGIN = window.location.origin;

/**
 * Entry point for the `message` event listener the Window binds
 * during `bindEvents`. Filters out foreign-origin and foreign-source
 * events, then dispatches on the `data.type` payload string.
 */
export function handleWindowMessage( win: Window, event: MessageEvent ): void {
	// Only accept same-origin messages from our own iframe.
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

	if ( data.type === 'wp-desktop-title-change' && typeof data.title === 'string' ) {
		win.setTitle( data.title );
	}

	// Cross-window connection bridge — route any `wp-desktop-bridge-*`
	// message to the parent-side connection registry. The bridge is
	// installed on `window` by `desktop.ts` so individual Window
	// instances don't need to know about it; null-check guards
	// startup ordering (the listener runs before `init()` in tests).
	if ( typeof data.type === 'string' && data.type.startsWith( 'wp-desktop-bridge-' ) ) {
		const bridge = (
			window as unknown as {
				__wpDesktopConnectionBridge?: {
					routeIncomingFromIframe(
						msg: unknown,
						fromWindowId?: string,
					): void;
				};
			}
		).__wpDesktopConnectionBridge;
		bridge?.routeIncomingFromIframe( data, win.id );
	}

	// Iframe boot signal — the chromeless bridge script posts this
	// once its message listeners are attached. Fires
	// `HOOKS.IFRAME_READY` so plugin authors get a reliable
	// "safe to talk to this iframe" signal (the browser's native
	// `load` event fires BEFORE our bridge attaches, which makes
	// listener-timing a known footgun otherwise).
	if ( data.type === 'wp-desktop-ready' ) {
		doAction( HOOKS.IFRAME_READY, { windowId: win.id } );
	}

	// Iframe-initiated navigation. Two modes:
	//   - `target: 'new'` opens the URL in a fresh browser tab with
	//     `noopener,noreferrer` to prevent tab-nabbing.
	//   - `target: 'self'` (default) navigates the iframe in place.
	// Every URL passes a same-origin check against `INITIAL_ORIGIN`
	// before we act on it — cross-origin navigations are silently
	// refused so the iframe can't break itself out of the shell.
	if (
		data.type === 'wp-desktop-navigate' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		handleDesktopNavigate(
			win,
			data.url,
			data.target === 'new' ? 'new' : 'self',
		);
	}

	// Iframe-initiated toast. Plugin pages inside iframes use this
	// to raise persistent user-visible feedback — a "Settings saved"
	// toast stays visible even after the iframe closes.
	if (
		data.type === 'wp-desktop-notification' &&
		typeof data.title === 'string' &&
		data.title !== ''
	) {
		handleDesktopNotification(
			data.title,
			typeof data.body === 'string' ? data.body : '',
		);
	}

	if ( data.type === 'wp-desktop-focus-request' ) {
		// Sent from the chromeless bridge on every pointerdown inside
		// the iframe — covers the "click inside iframe should focus
		// this window" UX that isn't reachable via parent-side
		// listeners (the click doesn't cross the browsing-context
		// boundary).
		if ( ! win.element.classList.contains( 'wp-desktop-window--overview' ) ) {
			win.onFocusRequest?.( win );
		}
	}

	if ( data.type === 'wp-desktop-screen-meta' && Array.isArray( data.panels ) ) {
		addScreenMetaButtons( win, data.panels as string[] );
	}

	if ( data.type === 'wp-desktop-screen-meta-state' ) {
		setActiveScreenMetaPanel(
			win,
			typeof data.open === 'string' ? data.open : null,
		);
	}

	if (
		data.type === 'wp-desktop-external-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		const label = typeof data.label === 'string' && data.label !== ''
			? data.label
			: data.url;
		addExternalTab( win, data.url, label );
	}

	// Iframe error relay — the chromeless bridge posts
	// `wp-desktop-iframe-error` from inside the iframe's error +
	// unhandledrejection handlers. We annotate with the owning
	// windowId and dispatch the hook, where monitor widgets pick it
	// up. Shape matches `HOOKS.IFRAME_ERROR`.
	if ( data.type === 'wp-desktop-iframe-error' ) {
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

	// Iframe network completion — bridged from the fetch + XHR
	// wrappers inside the chromeless iframe. Every completed call
	// (success or failure) fires here. `status === 0` indicates a
	// network-level failure before a response arrived; `failed` is
	// pre-computed server-side so subscribers don't have to re-derive
	// the success / 4xx / 5xx / network boundary.
	if ( data.type === 'wp-desktop-iframe-network' ) {
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, {
			windowId: win.id,
			method: typeof data.method === 'string' ? data.method : 'GET',
			url: typeof data.url === 'string' ? data.url : '',
			status: typeof data.status === 'number' ? data.status : 0,
			duration: typeof data.duration === 'number' ? data.duration : 0,
			failed: !! data.failed,
		} );
	}
}

/**
 * Handle a `wp-desktop-navigate` message.
 *
 * Validates the URL against the origin snapshot taken at module
 * load, then either opens a new tab (with `noopener,noreferrer`)
 * or replaces the iframe's `src`. Any URL that fails the origin
 * check is silently refused.
 */
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
		// `noopener` severs the new tab's `window.opener` reference
		// — no tab-nabbing even though the destination is same-origin
		// today.
		window.open( url.toString(), '_blank', 'noopener,noreferrer' );
		return;
	}

	// In-place iframe navigation. Assignment to `src` fires a fresh
	// load, so the iframe's `load` handler / readiness signal
	// re-runs for the new page.
	if ( win.iframe ) {
		win.iframe.src = url.toString();
	}
}

/**
 * Handle a `wp-desktop-notification` message.
 *
 * The payload lives at the parent-shell level (surviving the
 * iframe's lifecycle), which is the whole reason an iframe reaches
 * for this message in the first place. Title + optional body are
 * joined with a `—` separator to match the shell's single-line
 * toast format; callers that want richer rendering should ship
 * their own native window.
 */
function handleDesktopNotification( title: string, body: string ): void {
	const message = body !== '' ? `${ title } — ${ body }` : title;
	showToast( { message } );
}

/**
 * Add Screen Options / Help buttons to the title bar.
 *
 * Called when the iframe reports which screen-meta panels are
 * available. Repopulates on every call — the iframe re-announces on
 * each navigation, and different pages expose different panels.
 */
export function addScreenMetaButtons( win: Window, panels: string[] ): void {
	const container = win.element.querySelector( '.wp-desktop-window__screen-meta' );
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
		btn.className = 'wp-desktop-window__meta-btn';
		btn.setAttribute( 'type', 'button' );
		btn.setAttribute( 'aria-label', cfg.label );
		btn.setAttribute( 'aria-pressed', 'false' );
		btn.dataset.panel = panel;
		btn.innerHTML = `<span class="dashicons ${ cfg.icon }" aria-hidden="true"></span>`;

		// The iframe owns panel state. We request a toggle and wait
		// for the authoritative state message back before updating
		// the button's --active class.
		btn.addEventListener( 'click', ( e: Event ) => {
			e.stopPropagation();
			win.iframe?.contentWindow?.postMessage(
				{ type: 'wp-desktop-toggle-panel', panel },
				INITIAL_ORIGIN,
			);
		} );

		container.appendChild( btn );
	}
}

/**
 * Reflect the iframe's authoritative screen-meta state on the
 * title-bar buttons. At most one button is active at a time.
 */
export function setActiveScreenMetaPanel( win: Window, panel: string | null ): void {
	const container = win.element.querySelector( '.wp-desktop-window__screen-meta' );
	if ( ! container ) {
		return;
	}
	container.querySelectorAll<HTMLElement>( '.wp-desktop-window__meta-btn' ).forEach( ( btn ) => {
		const isActive = btn.dataset.panel === panel;
		btn.classList.toggle( 'wp-desktop-window__meta-btn--active', isActive );
		btn.setAttribute( 'aria-pressed', isActive ? 'true' : 'false' );
	} );
}
