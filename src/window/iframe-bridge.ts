/**
 * OpenStation — Window iframe postMessage bridge.
 *
 * Handles the parent → chromeless-iframe → parent message bus. The
 * iframe sends title changes, focus requests, external-link intents,
 * and available screen-meta panels; we route each to the appropriate
 * Window method. All messages are origin-gated to the origin captured
 * at module-init time — the chromeless iframe is always same-origin.
 */

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
import { openUserFootprintWindow } from '../my-wordpress/footprint-target';

/**
 * Origin snapshot taken once at module load. Any subsequent mutation
 * of `window.location` (e.g., by a misbehaving plugin script) cannot
 * relax the same-origin check — we always compare against the value
 * that was valid when the shell booted.
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
		titleFromPage?: boolean;
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

// Routed through `createSharedStore` so the deps set by the MAIN
// `desktop.ts` bundle are visible to the WINDOW-SYSTEM bundle that
// owns the `Window` class (and therefore actually runs
// `handleWindowMessage`). A plain module-level `let` here would give
// each bundle its own private copy: `bindAdminLinkDispatch()` would
// set the main bundle's copy while `handleWindowMessage` reads the
// window-system bundle's still-null copy, and every cross-page admin-
// link click would silently no-op. See `AGENTS.md` § "Cross-bundle
// state — `wp.os.createSharedStore`".
interface AdminLinkDepsState {
	deps: AdminLinkDispatchDeps | null;
}
const adminLinkDepsStore = createSharedStore< AdminLinkDepsState >(
	'desktop-mode/admin-link-deps',
	() => ( { deps: null } ),
);

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
	adminLinkDepsStore.state.deps = deps;
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

	if ( data.type === 'os-title-change' && typeof data.title === 'string' ) {
		win.setTitle( data.title );
	}

	// Content-identity announcement from the chromeless bridge — the
	// authoritative "which object does this page show" signal, resolved
	// server-side in real admin context. `identity: null` is meaningful
	// (navigation away from an identified screen clears the stale ref),
	// so forward it verbatim; the engine validates and no-ops repeats.
	if ( data.type === 'os-content-identity' ) {
		setWindowContent( win.id, data.identity ?? null, {
			source: 'bridge',
		} );
	}

	// Unified window-channel publish. Iframe content called
	// `wp.os.send( channel, payload )` (installed by the
	// iframe-bridge) and we forward to the parent-side subscriber
	// registry so `Window.on( channel, cb )` callbacks fire — same
	// shape as native windows reaching for `windowApi.send()`.
	if (
		data.type === 'os-window-publish' &&
		typeof data.channel === 'string' &&
		data.channel !== ''
	) {
		dispatchFromWindow( win.id, data.channel, data.payload );
	}

	// Cross-window connection bridge — route any `os-bridge-*`
	// message to the parent-side connection registry. The bridge is
	// installed on `window` by `desktop.ts` so individual Window
	// instances don't need to know about it; null-check guards
	// startup ordering (the listener runs before `init()` in tests).
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

	// Iframe boot signal — the chromeless bridge script posts this
	// once its message listeners are attached. Fires
	// `HOOKS.IFRAME_READY` so plugin authors get a reliable
	// "safe to talk to this iframe" signal (the browser's native
	// `load` event fires BEFORE our bridge attaches, which makes
	// listener-timing a known footgun otherwise).
	if ( data.type === 'os-ready' ) {
		win._iframeBridgeReady = true;
		// A new document means the old one's in-flight requests will
		// never report back — navigating away cancels them and takes
		// the `end` message with them. Without this the ring stays
		// lit forever on any window where the user clicked a link
		// mid-request, which is most of them.
		win._resetActivity();
		// Bridge announced — anything queued via `Window.send()`
		// before this point flushes now in FIFO order.
		markWindowContentReady( win.id );
		doAction( HOOKS.IFRAME_READY, { windowId: win.id } );
	}

	// Response to the parent's pre-close query for unsaved changes.
	if ( data.type === 'os-bridge-beforeunload-response' ) {
		if ( win._isDestroyed ) {
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

	// Iframe-initiated navigation. Two modes:
	//   - `target: 'new'` opens the URL in a fresh browser tab with
	//     `noopener,noreferrer` to prevent tab-nabbing.
	//   - `target: 'self'` (default) navigates the iframe in place.
	// Every URL passes a same-origin check against `INITIAL_ORIGIN`
	// before we act on it — cross-origin navigations are silently
	// refused so the iframe can't break itself out of the shell.
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
	//      hang off this branch. "Same page" means the target matches
	//      the window's opening slug (`baseId`) OR the slug its iframe
	//      is currently showing — the two diverge once the submenu tab
	//      strip re-points the iframe (Appearance → Menus keeps
	//      `baseId: themes-php` while displaying `nav-menus.php`).
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
		data.type === 'os-iframe-admin-link' &&
		typeof data.url === 'string' &&
		data.url !== ''
	) {
		const deps = adminLinkDepsStore.state.deps;
		if ( tryNativeUrlRemap( data.url ) ) {
			win.close();
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

	// Activity-footprint launcher. A "View activity footprint" row
	// action inside the chromeless `users.php` iframe posts this; we
	// open (or focus) the My WordPress window on that user's footprint
	// route via the shared-store hand-off (cold-start safe — see
	// `my-wordpress/footprint-target.ts`).
	//
	// Deliberately NOT the admin-link remap path above: that path
	// calls `win.close()` on a remap hit because it models a
	// navigation away from the source page. A row action is an
	// auxiliary "peek" at another user — closing the users list out
	// from under the click would be hostile, so the source window is
	// left untouched.
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

	// Iframe-initiated toast. Plugin pages inside iframes use this
	// to raise persistent user-visible feedback — a "Settings saved"
	// toast stays visible even after the iframe closes.
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
		// Sent from the chromeless bridge on every pointerdown inside
		// the iframe — covers the "click inside iframe should focus
		// this window" UX that isn't reachable via parent-side
		// listeners (the click doesn't cross the browsing-context
		// boundary).
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

	// Iframe error relay — the chromeless bridge posts
	// `os-iframe-error` from inside the iframe's error +
	// unhandledrejection handlers. We annotate with the owning
	// windowId and dispatch the hook, where monitor widgets pick it
	// up. Shape matches `HOOKS.IFRAME_ERROR`.
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

	// Layer-1 theme — iframe content can re-theme its own window
	// via the bridge. `tokens` is a CSS-variable map; `setAppearanceTheme`
	// validates inline overrides match the framework's shape.
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

	// Layer-2 controls — iframe can reorder / hide / inject controls
	// for its own window.
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

	// Layer-3 slots — iframe can replace any named slot with sandboxed
	// HTML (rendered via textContent — never innerHTML — so iframe-side
	// or plugin-supplied content can't smuggle script into the parent
	// shell). Plugins that need rich slot markup register a parent-
	// side `WindowSlotDef.render` callback instead.
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

	// Iframe activity — the bracketing pair the status ring runs on.
	// Bridged from the same fetch + XHR wrappers as the network
	// message below, but fired on START as well as end, because an
	// indicator that only hears "it finished" can never show the part
	// the user is waiting through.
	//
	// This is what makes an iframe window report like a native one:
	// native windows route through `wp.os.fetch`, which the shell owns;
	// an admin page inside an iframe does its own jQuery / XHR /
	// `fetch` calls that the parent has no other way to see.
	//
	// Reference-counted parent-side by the same `_markActivityStart` /
	// `_markActivitySettled` pair `wp.os.fetch` uses, so a page firing
	// six requests at once settles as one burst — and settles `failed`
	// if any of them did.
	if ( data.type === 'os-iframe-activity' ) {
		if ( data.phase === 'start' ) {
			win._markActivityStart();
		} else if ( data.phase === 'end' ) {
			const failed = !! data.failed;
			const status = typeof data.status === 'number' ? data.status : 0;
			win._markActivitySettled(
				! failed,
				failed ? iframeActivityError( status ) : undefined,
			);
		}
	}

	// Iframe network completion — bridged from the fetch + XHR
	// wrappers inside the chromeless iframe. Every completed call
	// (success or failure) fires here. `status === 0` indicates a
	// network-level failure before a response arrived; `failed` is
	// pre-computed inside the iframe (by the chromeless bridge's
	// fetch/XHR wrappers) so subscribers don't have to re-derive
	// the success / 4xx / 5xx / network boundary.
	if ( data.type === 'os-iframe-network' ) {
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
		// `wp.os.devtools.onRequest( id, cb, { observe: true } )`).
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
 * Handle a `os-navigate` message.
 *
 * Validates the URL against the origin snapshot taken at module
 * load, then either opens a new tab (with `noopener,noreferrer`)
 * or replaces the iframe's `src`. Any URL that fails the origin
 * check is silently refused.
 */
/**
 * Tooltip / announcement text for a failed request inside an iframe.
 *
 * `status === 0` is the iframe's own marker for "no response arrived"
 * — a network error, a CORS refusal, an aborted request — where the
 * number would be noise rather than information.
 */
function iframeActivityError( status: number ): string {
	if ( status <= 0 ) {
		return __( 'Request failed.' );
	}
	/* translators: %d: HTTP status code of the failed request. */
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
/**
 * Core wp-admin URL `action=` values that perform a side-effect on
 * the server and redirect back to the source list page (Trash,
 * Untrash, Delete on posts; the equivalents on comments).
 *
 * These are intentionally NOT cross-page navigations even when the
 * URL's slug differs from the source window's: vanilla wp-admin
 * handles them in the current tab — the user clicks Trash on a row,
 * the list refreshes with the "1 post moved to the Trash. Undo."
 * notice. Opening a fresh window would leave the source list stale
 * AND land the user on the action's redirect target (which depends
 * on Referer in ways that don't survive a fresh iframe; see the
 * `_wp_http_referer` shim further down for the safety-net
 * mitigation).
 *
 * Whitelist, not blanket "any `_wpnonce`": URLs like
 * `update-core.php?action=upgrade-core&_wpnonce=…` carry a nonce
 * but ARE genuine cross-page navigations the user wants in a window.
 *
 * Extension point: plugins register their own predicates via
 * `wp.os.registerDestructiveAdminAction({ id, matches })` —
 * see `src/destructive-admin-actions.ts`. Built-in Core action
 * names are pinned in this set for zero-config behavior; the
 * plugin registry is consulted AFTER the built-in check.
 */
const DESTRUCTIVE_ADMIN_ACTIONS: ReadonlySet< string > = new Set( [
	// wp-admin/post.php
	'trash',
	'untrash',
	'delete',
	// wp-admin/comment.php
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

/**
 * True when a URL is a redirect-back side-effect (Trash, Untrash,
 * Delete on posts/comments). Used to short-circuit
 * {@link handleCrossPageAdminLink} into the same-page branch so the
 * source iframe is the one that performs the action — its natural
 * Referer header then carries the source URL, and WP redirects
 * straight back to the list with the success notice.
 */
function isDestructiveActionUrl( url: URL ): boolean {
	const action = url.searchParams.get( 'action' );
	if ( action && DESTRUCTIVE_ADMIN_ACTIONS.has( action ) ) {
		// A standalone `?action=trash` with no nonce won't actually
		// trash anything (WP rejects it with `check_admin_referer`);
		// the nonce check is also a useful disambiguator from action
		// names a plugin might overload for non-destructive flows.
		if (
			url.searchParams.has( '_wpnonce' ) ||
			url.searchParams.has( '_wp_nonce' )
		) {
			return true;
		}
	}
	// Plugin-registered predicates (the extension point). Walked
	// AFTER the built-in whitelist so the common case is one map
	// lookup; predicates only run for URLs Core didn't already
	// claim. The registry is shared across bundles via
	// `createSharedStore`, so a plugin's `registerDestructiveAdminAction`
	// call from its own bundle reaches the dispatcher running in
	// the `window-system` bundle.
	return matchDestructiveAdminAction( url.toString(), url ) !== null;
}

/**
 * Stamp `_wp_http_referer=<source-page>` onto an admin URL so WP's
 * referer-driven redirects (`wp_get_referer()` in trash/untrash/
 * delete handlers, in form-post `redirect_post_location`, in plugin
 * actions that send the user "back" after a side-effect) resolve to
 * the page the user clicked FROM, not whatever URL the browser's
 * `Referer` header happens to carry.
 *
 * Why this hint is necessary in both navigation paths:
 *
 *   - **New-window opens** — a freshly-created iframe has no prior
 *     in-frame history, so the browser uses the embedder's URL as
 *     `Referer`. WP then redirects post-trash to the desktop shell
 *     URL (often the portal-stamped Dashboard).
 *
 *   - **Same-iframe `location.assign`** — the iframe DOES have a
 *     prior URL, but real-world `Referrer-Policy` headers (WP and
 *     many hosts set `strict-origin-when-cross-origin` or stricter)
 *     can downgrade the `Referer` to just the origin, dropping the
 *     `/wp-admin/edit.php?…` path WP needs. The post-trash redirect
 *     then falls into the `wp_get_referer()` fallback branches that
 *     end at Dashboard.
 *
 * `_wp_http_referer` is the same hint WP itself threads through
 * forms via `wp_nonce_field()`; `wp_get_referer()` checks
 * `$_REQUEST['_wp_http_referer']` BEFORE the raw header, so the
 * param wins. Harmless on non-action navigations.
 *
 * Returns the URL unchanged when the caller already supplied a
 * referer (we never overwrite), when the source URL is unreadable,
 * or when the source resolves to a different origin (defensive — a
 * mis-attributed referer is worse than none).
 */
function stampSourceReferer( url: URL, win: Window ): URL {
	if ( url.searchParams.has( '_wp_http_referer' ) ) {
		return url;
	}
	let sourceHref = '';
	try {
		sourceHref = win.iframe?.contentWindow?.location.href ?? '';
	} catch {
		// Cross-origin or torn-down iframe — fall through.
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
		// Strip the chromeless flag from the hint: `wp_get_referer()`
		// passes the result downstream to logic that builds the
		// next redirect, and a chromeless-flagged referer would loop
		// the flag into places it doesn't belong. The post-redirect
		// preserve filter (`openstation_chromeless_preserve_redirect`)
		// reattaches the flag where needed.
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

/**
 * The slug a window's iframe is *actually* showing right now, or an
 * empty string when it can't be read (native window, torn-down
 * iframe, `about:blank`, cross-origin).
 *
 * Distinct from `config.baseId`, which records the page the window
 * was OPENED on and never moves. The two diverge as soon as the
 * iframe navigates in place — most visibly via the submenu tab strip,
 * where e.g. the Appearance window (`baseId: themes-php`) is pointed
 * at `nav-menus.php` while keeping its original id.
 */
function readLiveSlug( win: Window, deps: AdminLinkDispatchDeps ): string {
	let href = '';
	try {
		// Optional-call: `Window` mocks in tests (and any future
		// window-like object) may not implement the getter.
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

/**
 * True when a clicked admin link lands on the page the source window
 * is already showing — i.e. the click is in-page navigation, not a
 * jump to a different admin screen.
 *
 * A window counts as "on" two slugs: the one it was opened at
 * (`baseId`) and the one its iframe currently displays. They're the
 * same for a freshly-opened window and diverge after any in-place
 * navigation — chiefly the submenu tab strip, which re-points the
 * iframe without minting a new window.
 *
 * Matching against BOTH (rather than swapping `baseId` out for the
 * live slug) is deliberate: it can only ever turn a would-be
 * new-window open into an in-place navigation, never the reverse. A
 * window that navigated from `admin.php?page=foo` to
 * `admin.php?page=foo&path=/bar` still treats a link back to the
 * landing page as in-page.
 */
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
	// The link named another browsing context (`target="_blank"`), so
	// the one thing it asked for is that the page it was clicked on
	// survives. Neither in-place branch below can honour that, and the
	// destructive one fires on a slug MISMATCH — the same shape a
	// `_blank` reaches us with — so both are skipped rather than
	// guarded individually.
	if ( newContext ) {
		openAdminUrlInOwnWindow( win, url, linkLabel, deps );
		return;
	}

	const absolute = url.toString();
	const targetSlug = deps.deriveSlug( absolute );
	const samePage = isSamePageSlug( win, targetSlug, deps );

	// Destructive row actions (Trash, Untrash, Delete on posts;
	// spam / approve / trash on comments) navigate the SOURCE iframe
	// in place regardless of slug, matching vanilla wp-admin's
	// "click Trash → row disappears + Undo notice on the same list"
	// behavior. Slug-based cross-page open-a-new-window logic isn't
	// meaningful here: the URL's slug is whichever
	// `post.php?post=N&action=trash` it happens to be, but the
	// landing page after WP's 302 is the list the user already has
	// open — the in-place branch reaches that exact state.
	if ( ! samePage && isDestructiveActionUrl( url ) ) {
		// Inject `_wp_http_referer` so WP's trash/untrash/delete
		// handlers resolve `wp_get_referer()` to the source page
		// regardless of what the browser's `Referer` header carries
		// (real-world `Referrer-Policy` headers downgrade the
		// header to just the origin, dropping the path WP needs).
		// Without this, the post-action redirect lands wherever WP's
		// fallback chooses — commonly the Dashboard, since the
		// origin-only referer matches neither `post.php` nor
		// `post-new.php` and WP's "back to the list" branch then
		// substitutes `admin_url('edit.php')` only when the referer
		// IS empty / IS post.php; everything else passes through
		// and gets `trashed=1&ids=N` appended to the wrong URL.
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
	// iframe where it is, so the user keeps both contexts.
	openAdminUrlInOwnWindow( win, url, linkLabel, deps );
}

/**
 * Give an admin URL its own window: the destination's slug decides
 * which window owns it, so an already-open window for that slug is
 * focused and navigated rather than duplicated.
 *
 * Title resolution (best → worst):
 *   1. Dock entry's `title` — recognises canonical pages.
 *   2. `linkLabel` — the visible text of the link the user just
 *      clicked. Catches in-app sub-pages (e.g. an Action Scheduler
 *      tab whose URL has no dock tile but whose link text is
 *      meaningful: "Scheduler", "Logs", "Settings").
 *   3. The slug itself — last-resort fallback so a missing label
 *      surfaces an ugly-but-stable id rather than an empty title bar.
 *
 * Only the dock entry is a name the shell *knows*; 2 and 3 are
 * guesses, so they ship with `titleFromPage` and the window swaps
 * them for the destination page's own screen name once its iframe
 * loads. Link text is written for someone already on the page it
 * sits on and reads badly as a window name — the classic editor's
 * revisions link says "Browse".
 */
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

	// Forward source page as `_wp_http_referer` — see
	// {@link stampSourceReferer} for the rationale (same shim the
	// in-place destructive-action branch uses).
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
		multi: entry?.multi,
	} );
}

/**
 * The wp-admin filename a URL points at (`revision.php`), or an empty
 * string when it isn't an admin URL we can read.
 */
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

/**
 * Admin screens that exist to run one action and then send the user
 * back to the page they came from.
 */
const HANDOFF_SCREENS: ReadonlySet< string > = new Set( [ 'revision.php' ] );

/**
 * The URL a frame actually navigated to, which by the time a `load`
 * listener runs is no longer what `location` says.
 *
 * `wp-admin/js/common.js` strips WP's "removable" query args —
 * `message`, `settings-updated`, `trashed`, `revision`, … — with
 * `replaceState` on DOM ready, and DOM ready is before load. Those
 * args are precisely the ones that carry what just happened, so
 * forwarding `location.href` hands the destination on without its
 * outcome: a restored revision arriving in the editor window with no
 * "Post restored to revision from …" notice, which in classic
 * wp-admin is the only confirmation the restore worked.
 *
 * Navigation timing records the URL as fetched — after redirects,
 * before any history rewriting — so it still has them. Falls back to
 * `href`, and ignores an entry pointing at a different admin file
 * than the one that just loaded (a stale entry must never be able to
 * redirect the handoff somewhere else).
 */
function navigatedUrl( win: Window, href: string ): string {
	try {
		const timing = win.iframe?.contentWindow?.performance
			?.getEntriesByType?.( 'navigation' );
		const name = timing?.[ 0 ]?.name ?? '';
		if ( name && adminFileName( name ) === adminFileName( href ) ) {
			return name;
		}
	} catch {
		// No navigation-timing support, or a torn-down frame.
	}
	return href;
}

/**
 * Close a {@link HANDOFF_SCREENS} window that has navigated itself
 * off its own screen, and route where it landed through the normal
 * window-owns-a-slug rules — which focuses the editor window the user
 * already had open and points it at the restored post.
 *
 * Returns true when it claimed the navigation, so the caller skips
 * the per-load work that only makes sense for a window that is
 * staying open.
 *
 * Deliberately NOT a general "any window that crosses slugs hands
 * off" rule: the submenu tab strip re-points a window across slugs on
 * purpose (Appearance → Menus), and closing the window out from under
 * that click would be hostile. A screen is on this list only when
 * leaving it means the screen is finished.
 */
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
		// Unbound deps should only happen in tests or pre-boot. Leave
		// the window alone rather than closing it onto nothing.
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
	// The label is empty on purpose: nothing was clicked, so there is
	// no link text to name the destination with. A dock entry names
	// it, and failing that `titleFromPage` picks the name up off the
	// page itself.
	openAdminUrlInOwnWindow( win, url, '', deps );
	win.close();
	return true;
}

/**
 * Replace a guessed window title with the screen name the destination
 * page gives itself. No-op unless the window was opened with
 * {@link WindowConfig.titleFromPage}.
 */
export function adoptPageTitle( win: Window ): void {
	if ( ! win.config.titleFromPage ) {
		return;
	}
	let documentTitle = '';
	try {
		documentTitle = win.iframe?.contentDocument?.title ?? '';
	} catch {
		// Cross-origin or torn-down frame — keep what we have.
		return;
	}
	const name = adminScreenName( documentTitle );
	if ( name !== '' && name !== win.config.title ) {
		win.setTitle( name );
	}
}

/**
 * The screen name out of a wp-admin document title.
 *
 * `wp-admin/admin-header.php` prints `%1$s &lsaquo; %2$s &#8212;
 * WordPress`, so "Revisions ‹ My Site — WordPress" is the shape.
 * Both the format and its separator are translatable, so a locale
 * that re-punctuates it falls through to the whole string — a long
 * title beats a title cut in the wrong place.
 */
function adminScreenName( documentTitle: string ): string {
	const trimmed = documentTitle.trim();
	const cut = trimmed.indexOf( ' ‹ ' );
	return ( cut > 0 ? trimmed.slice( 0, cut ) : trimmed ).trim();
}

/**
 * Handle a `os-notification` message.
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

		// The iframe owns panel state. We request a toggle and wait
		// for the authoritative state message back before updating
		// the button's --active class.
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

/**
 * Reflect the iframe's authoritative screen-meta state on the
 * title-bar buttons. At most one button is active at a time.
 */
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
