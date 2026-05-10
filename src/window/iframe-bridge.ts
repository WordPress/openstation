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
import { dispatchFromWindow, markWindowContentReady } from '../window-channels';
import { tryNativeUrlRemap } from '../native-url-remap';

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
 * Look-up shape for "title + icon for the dock entry whose URL slug
 * matches this destination." Returned from `findDockEntry`; consumed
 * when we have to open a fresh window for a cross-page admin link
 * click. `null` when no entry matches — the handler falls back to a
 * generic icon and the destination URL's slug as the title (the new
 * window's iframe will retitle itself once it loads).
 */
export interface AdminLinkDockEntry {
	title: string;
	icon: string;
	/**
	 * The parent dock-tile URL — the page the user clicked from. Used
	 * to seed the new window's `parentUrl` so the in-window
	 * "back to parent" tab points at the dock landing page even when
	 * the cross-page link drops the user on a sub-page (e.g. a
	 * `theme-install.php` link from a Posts editor opens at
	 * theme-install.php with the parent tab still saying "Appearance").
	 * Optional — falls back to the destination URL when missing.
	 */
	url?: string;
	submenu?: { title: string; url: string }[];
	multi?: boolean;
}

/**
 * Dependencies for the cross-page admin-link dispatcher. Wired by
 * `desktop.ts` at boot via {@link bindAdminLinkDispatch}. The bridge
 * stays a pure router until the deps are bound; while unbound, admin-
 * link messages are silently ignored (apart from the native-window
 * remap path, which is dep-free).
 */
interface AdminLinkDispatchDeps {
	/** Shell's admin URL — used as the base for URL parsing. */
	adminUrl: string;
	/**
	 * Compute a window slug from an admin URL. Should match the
	 * shell's canonical `deriveWindowId( url, adminUrl )`.
	 */
	deriveSlug( url: string ): string;
	/**
	 * Open (or focus) a window for a destination URL — wraps
	 * `windowManager.open()` so the bridge module doesn't have to
	 * import the manager directly.
	 */
	openWindow( config: {
		id: string;
		baseId: string;
		url: string;
		parentUrl?: string;
		title: string;
		icon: string;
		submenu?: { title: string; url: string }[];
		multi?: boolean;
	} ): void;
	/**
	 * Look up the dock entry whose URL slug matches this destination —
	 * used to seed the new window's title + icon. Returns `null` when
	 * nothing matches (link points to a page that has no dock tile,
	 * e.g. `options-general.php?page=foo` reached from a sub-link).
	 */
	findDockEntry( url: string ): AdminLinkDockEntry | null;
}

let adminLinkDeps: AdminLinkDispatchDeps | null = null;

/**
 * Wire the cross-page admin-link dispatcher. Called once from
 * `desktop.ts` after the window manager and dock layout are
 * constructed. Tests can call this directly to inject fakes.
 *
 * @internal
 */
export function bindAdminLinkDispatch(
	deps: AdminLinkDispatchDeps | null,
): void {
	adminLinkDeps = deps;
}

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

	if ( data.type === 'desktop-mode-title-change' && typeof data.title === 'string' ) {
		win.setTitle( data.title );
	}

	// Unified window-channel publish. Iframe content called
	// `wp.desktop.send( channel, payload )` (installed by the
	// iframe-bridge) and we forward to the parent-side subscriber
	// registry so `Window.on( channel, cb )` callbacks fire — same
	// shape as native windows reaching for `windowApi.send()`.
	if (
		data.type === 'desktop-mode-window-publish' &&
		typeof data.channel === 'string' &&
		data.channel !== ''
	) {
		dispatchFromWindow( win.id, data.channel, data.payload );
	}

	// Cross-window connection bridge — route any `desktop-mode-bridge-*`
	// message to the parent-side connection registry. The bridge is
	// installed on `window` by `desktop.ts` so individual Window
	// instances don't need to know about it; null-check guards
	// startup ordering (the listener runs before `init()` in tests).
	if ( typeof data.type === 'string' && data.type.startsWith( 'desktop-mode-bridge-' ) ) {
		const bridge = (
			window as unknown as {
				__desktopModeConnectionBridge?: {
					routeIncomingFromIframe(
						msg: unknown,
						fromWindowId?: string,
					): void;
				};
			}
		).__desktopModeConnectionBridge;
		bridge?.routeIncomingFromIframe( data, win.id );
	}

	// Iframe boot signal — the chromeless bridge script posts this
	// once its message listeners are attached. Fires
	// `HOOKS.IFRAME_READY` so plugin authors get a reliable
	// "safe to talk to this iframe" signal (the browser's native
	// `load` event fires BEFORE our bridge attaches, which makes
	// listener-timing a known footgun otherwise).
	if ( data.type === 'desktop-mode-ready' ) {
		// Bridge announced — anything queued via `Window.send()`
		// before this point flushes now in FIFO order.
		markWindowContentReady( win.id );
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
		data.type === 'desktop-mode-navigate' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		handleDesktopNavigate(
			win,
			data.url,
			data.target === 'new' ? 'new' : 'self',
		);
	}

	// Cross-page admin-link dispatch.
	//
	// The chromeless bridge `preventDefault`s every admin-internal link
	// click and posts this message; the parent owns the routing. Three
	// possible outcomes, in priority order:
	//
	//   1. Native-window remap hit (e.g. `edit.php` while the user has
	//      the native Posts opt-in on) → open the native window and
	//      close the source iframe. Same behavior as the original
	//      "Exit editor" path on a locked-post takeover dialog.
	//
	//   2. Same-page slug → drive the source iframe's
	//      `location.assign()` so the in-place navigation matches the
	//      user's intent. Pagination, list filters, and tab strips
	//      hang off this branch.
	//
	//   3. Different slug → open a NEW window for the destination and
	//      leave the source iframe untouched. The user keeps the
	//      original page's context (e.g. a Pages window stays Pages
	//      after they click into Posts).
	//
	// The bridge stays a passive router until `bindAdminLinkDispatch`
	// has wired the deps. Unbound state should only happen in tests
	// or pre-boot; we bail out without navigating so the user sees a
	// dropped click instead of a broken iframe state.
	if (
		data.type === 'desktop-mode-iframe-admin-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		if ( tryNativeUrlRemap( data.url ) ) {
			win.close();
		} else if ( adminLinkDeps ) {
			const linkLabel =
				typeof data.label === 'string' ? data.label : '';
			handleCrossPageAdminLink( win, data.url, linkLabel, adminLinkDeps );
		}
	}

	// Iframe-initiated toast. Plugin pages inside iframes use this
	// to raise persistent user-visible feedback — a "Settings saved"
	// toast stays visible even after the iframe closes.
	if (
		data.type === 'desktop-mode-notification' &&
		typeof data.title === 'string' &&
		data.title !== ''
	) {
		handleDesktopNotification(
			data.title,
			typeof data.body === 'string' ? data.body : '',
		);
	}

	if ( data.type === 'desktop-mode-focus-request' ) {
		// Sent from the chromeless bridge on every pointerdown inside
		// the iframe — covers the "click inside iframe should focus
		// this window" UX that isn't reachable via parent-side
		// listeners (the click doesn't cross the browsing-context
		// boundary).
		if ( ! win.element.classList.contains( 'desktop-mode-window--overview' ) ) {
			win.onFocusRequest?.( win );
		}
	}

	if ( data.type === 'desktop-mode-screen-meta' && Array.isArray( data.panels ) ) {
		addScreenMetaButtons( win, data.panels as string[] );
	}

	if ( data.type === 'desktop-mode-screen-meta-state' ) {
		setActiveScreenMetaPanel(
			win,
			typeof data.open === 'string' ? data.open : null,
		);
	}

	if (
		data.type === 'desktop-mode-external-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		const label = typeof data.label === 'string' && data.label !== ''
			? data.label
			: data.url;
		addExternalTab( win, data.url, label );
	}

	// Iframe error relay — the chromeless bridge posts
	// `desktop-mode-iframe-error` from inside the iframe's error +
	// unhandledrejection handlers. We annotate with the owning
	// windowId and dispatch the hook, where monitor widgets pick it
	// up. Shape matches `HOOKS.IFRAME_ERROR`.
	if ( data.type === 'desktop-mode-iframe-error' ) {
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
	// Layer-1 theme — iframe content can re-theme its own window
	// via the bridge. `tokens` is a CSS-variable map; `setAppearanceTheme`
	// validates inline overrides match the framework's shape.
	if (
		data.type === 'desktop-mode-chrome-theme' &&
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

	// Layer-2 controls — iframe can reorder / hide / inject controls
	// for its own window.
	if (
		data.type === 'desktop-mode-chrome-controls' &&
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

	// Layer-3 slots — iframe can replace any named slot with sandboxed
	// HTML (rendered via textContent — never innerHTML — so iframe-side
	// or plugin-supplied content can't smuggle script into the parent
	// shell). Plugins that need rich slot markup register a parent-
	// side `WindowSlotDef.render` callback instead.
	if (
		data.type === 'desktop-mode-chrome-slot' &&
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

	if ( data.type === 'desktop-mode-iframe-network' ) {
		const networkPayload: Record< string, unknown > = {
			windowId: win.id,
			method: typeof data.method === 'string' ? data.method : 'GET',
			url: typeof data.url === 'string' ? data.url : '',
			status: typeof data.status === 'number' ? data.status : 0,
			duration: typeof data.duration === 'number' ? data.duration : 0,
			failed: !! data.failed,
		};
		// `requestHeaders` / `responseHeaders` only ride along when
		// devtools have asked the iframe to observe (via
		// `wp.desktop.devtools.onRequest( id, cb, { observe: true } )`).
		// Default deliveries stay summary-only for privacy.
		if ( data.requestHeaders && typeof data.requestHeaders === 'object' ) {
			networkPayload.requestHeaders = data.requestHeaders;
		}
		if ( data.responseHeaders && typeof data.responseHeaders === 'object' ) {
			networkPayload.responseHeaders = data.responseHeaders;
		}
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, networkPayload );
	}
}

/**
 * Handle a `desktop-mode-navigate` message.
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
 * Route an admin-internal link click that the chromeless bridge
 * `preventDefault`d for us. See the case-3 outcome list at the call
 * site for the full decision table; this function implements the
 * same-slug-vs-different-slug split and the new-window opening.
 *
 * Same-slug navigation prefers `location.assign()` over `iframe.src`
 * because `assign` creates a real entry in the iframe's session
 * history (Back / Forward inside the iframe still work, screen
 * readers announce the page change). Setting `iframe.src` from the
 * parent overwrites the current entry instead.
 */
function handleCrossPageAdminLink(
	win: Window,
	rawUrl: string,
	linkLabel: string,
	deps: AdminLinkDispatchDeps,
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
	const absolute = url.toString();

	const targetSlug = deps.deriveSlug( absolute );
	const sourceSlug = win.config.baseId || win.id;

	if ( targetSlug === sourceSlug ) {
		const inner = win.iframe?.contentWindow;
		if ( inner ) {
			try {
				inner.location.assign( absolute );
			} catch {
				// `location.assign` can throw if the iframe was torn
				// down between the click and our handler; fall back
				// to setting `src`, which never throws.
				if ( win.iframe ) {
					win.iframe.src = absolute;
				}
			}
		}
		return;
	}

	// Different slug — the user clicked into a different admin page.
	// Open a fresh window for the destination and leave the source
	// iframe where it is.
	//
	// Title resolution (best → worst):
	//   1. Dock entry's `title` — recognises canonical pages.
	//   2. `linkLabel` — the visible text of the link the user just
	//      clicked. Catches in-app sub-pages (e.g. an Action Scheduler
	//      tab whose URL has no dock tile but whose link text is
	//      meaningful: "Scheduler", "Logs", "Settings").
	//   3. The slug itself — last-resort fallback so a missing label
	//      surfaces an ugly-but-stable id rather than an empty title
	//      bar.
	//
	// The iframe-side bridge does not auto-emit `title-change` after
	// load, so this single resolution is what the user sees for the
	// lifetime of the window unless the destination's own JS reaches
	// for `wp.desktop.send` / `setTitle`.
	const entry = deps.findDockEntry( absolute );
	const trimmedLabel = linkLabel.trim();
	const title =
		entry?.title || ( trimmedLabel !== '' ? trimmedLabel : targetSlug );
	deps.openWindow( {
		id: targetSlug,
		baseId: targetSlug,
		url: absolute,
		parentUrl: entry?.url ?? absolute,
		title,
		icon: entry?.icon ?? 'dashicons-admin-generic',
		submenu: entry?.submenu,
		multi: entry?.multi,
	} );
}

/**
 * Handle a `desktop-mode-notification` message.
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
	const container = win.element.querySelector( '.desktop-mode-window__screen-meta' );
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
		btn.className = 'desktop-mode-window__meta-btn';
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
				{ type: 'desktop-mode-toggle-panel', panel },
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
	const container = win.element.querySelector( '.desktop-mode-window__screen-meta' );
	if ( ! container ) {
		return;
	}
	container.querySelectorAll<HTMLElement>( '.desktop-mode-window__meta-btn' ).forEach( ( btn ) => {
		const isActive = btn.dataset.panel === panel;
		btn.classList.toggle( 'desktop-mode-window__meta-btn--active', isActive );
		btn.setAttribute( 'aria-pressed', isActive ? 'true' : 'false' );
	} );
}
