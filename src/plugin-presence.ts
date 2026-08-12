/**
 * Notices that OpenStation itself stopped being active, and walks the
 * user out of the shell.
 *
 * Deactivating (or deleting) OpenStation from the classic
 * `plugins.php` inside a window leaves the shell running on top of a
 * plugin that no longer loads: the desktop, dock and windows stay up,
 * every `desktop-mode/v1` call 404s, and the window where the action
 * happened repaints as a full classic admin page inside the frame.
 * The native Plugins window already handles its own case
 * (`isOpenStationSelf()` / `reloadOutOfOpenStation()` in
 * `src/plugins-window/rest.ts`), but that window is opt-in and off by
 * default, so the default path had no guard at all.
 *
 * The server cannot help after the fact — the next request no longer
 * loads OpenStation, so there is no payload, no bridge and no hook to
 * fire. Detection has to be client side, and it is split in two:
 *
 *   - **Triggers** are cheap and allowed to be wrong. A chromeless
 *     admin iframe that loads *without* the `os-chromeless` body class
 *     (see `includes/render/body-classes.php`), or a Heartbeat tick
 *     that arrives without the `desktop_mode_nonces` field (see
 *     `includes/nonce-refresh.php`), both mean "OpenStation might be
 *     gone". Neither is conclusive: `wp_die()` screens render no
 *     `admin_body_class` at all, and core skips `heartbeat_received`
 *     entirely on a tick that carries no client data.
 *
 *   - **Confirmation** is authoritative and cheap enough to be worth
 *     the round trip. The `desktop-mode/v1` REST namespace index
 *     answers 200 while the plugin is active and 404 `rest_no_route`
 *     once it is not. It needs no nonce and no capability, so it
 *     survives exactly the situation being tested for.
 *
 * That split is the whole design: a false trigger costs one silent
 * request and nothing else, which is what makes it safe to trigger on
 * signals that are merely suggestive.
 */

import { __ } from './i18n';
import { showToast } from './toast';
import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';

/** Matches `OPENSTATION_NONCE_REFRESH_FIELD` in `includes/nonce-refresh.php`. */
const NONCE_FIELD = 'desktop_mode_nonces';

/**
 * The REST namespace whose existence IS the plugin's existence. Its
 * index route is registered by WordPress for any namespace that has
 * routes, and disappears with them.
 */
const NAMESPACE_PATH = 'desktop-mode/v1';

/**
 * Minimum spacing between confirmation pings. Triggers are allowed to
 * be noisy (a Heartbeat tick without client data fires one every
 * interval), so the throttle — not the trigger — is what bounds the
 * request rate.
 */
const CONFIRM_COOLDOWN_MS = 30_000;

/**
 * How long the toast is on screen before the navigation. Long enough
 * to read, short enough that the page swap still reads as a
 * consequence of the click that caused it. Matches the native Plugins
 * window's own delay.
 */
const EXIT_DELAY_MS = 2000;

let confirmInFlight = false;
/** `null` until the first ping — distinct from "pinged at epoch 0". */
let lastConfirmAt: number | null = null;
let exiting = false;
let booted = false;

interface ShellConfig {
	adminUrl?: string;
	restUrl?: string;
}

function readConfig(): ShellConfig {
	return (
		( window as unknown as { wp?: { os?: { config?: ShellConfig } } } ).wp
			?.os?.config ?? {}
	);
}

/**
 * Admin path prefix used to tell "an admin page lost its chromeless
 * marker" from "a front-end page, which never had one". `body_class`
 * is not `admin_body_class`: a window showing the site's front end
 * carries no `os-chromeless` and is perfectly healthy.
 */
function adminPath(): string {
	const raw = readConfig().adminUrl || '/wp-admin/';
	let path: string;
	try {
		path = new URL( raw, window.location.href ).pathname;
	} catch {
		path = '/wp-admin/';
	}
	return path.endsWith( '/' ) ? path : `${ path }/`;
}

function namespaceUrl(): string {
	const root =
		readConfig().restUrl || `${ window.location.origin }/wp-json/`;
	return joinRestUrl( root, NAMESPACE_PATH );
}

/**
 * Confirm — or dismiss — a suspicion that the plugin is gone.
 *
 * Only a 404 counts. A network error is deliberately NOT treated as
 * absence: an offline shell is still a working shell, and evicting the
 * user out of it on a dropped connection would be worse than the bug
 * this module exists to fix.
 */
async function confirmAbsence(): Promise< void > {
	if ( exiting || confirmInFlight ) {
		return;
	}
	const now = Date.now();
	if ( lastConfirmAt !== null && now - lastConfirmAt < CONFIRM_COOLDOWN_MS ) {
		return;
	}
	lastConfirmAt = now;
	confirmInFlight = true;
	try {
		const res = await trackedFetch(
			namespaceUrl(),
			{ credentials: 'same-origin' },
			{ silent: true, source: 'desktop-mode/plugin-presence' },
		);
		if ( res.status === 404 ) {
			exitToClassicAdmin();
		}
	} catch {
		/* Offline or blocked — say nothing, keep the shell up. */
	} finally {
		confirmInFlight = false;
	}
}

/**
 * Announce the eviction and navigate the top frame to the classic
 * Dashboard.
 *
 * The navigation is on a plain timer rather than chained off the
 * toast: when OpenStation was *deleted* rather than deactivated, the
 * lazy `shell-overlays` bundle the toast renders through is no longer
 * on disk and never resolves. The user still has to get out.
 *
 * `adminUrl` is the destination rather than a reload because the
 * current URL may itself be a now-unroutable `admin.php?page=…`.
 */
function exitToClassicAdmin(): void {
	if ( exiting ) {
		return;
	}
	exiting = true;

	// Armed FIRST, and the toast is allowed to fail: on a *delete*
	// the lazy `shell-overlays` bundle it renders through is no
	// longer on disk. Losing the message is survivable; losing the
	// way out is the bug this module exists to fix.
	const dest = readConfig().adminUrl || '/wp-admin/';
	window.setTimeout( () => {
		const target = window.top ?? window;
		try {
			target.location.assign( dest );
		} catch {
			// Cross-origin top frame — land this frame at least.
			window.location.assign( dest );
		}
	}, EXIT_DELAY_MS );

	try {
		showToast( {
			message: __(
				'OpenStation is no longer active. Returning to the WordPress dashboard…',
			),
			duration: EXIT_DELAY_MS,
		} );
	} catch {
		/* No toast — the navigation above still stands. */
	}
}

/**
 * Trigger: a window iframe finished loading. Same-origin admin pages
 * are the only ones that carry the chromeless marker, so everything
 * else is left alone.
 *
 * Called on every iframe `load`, which includes in-place navigations —
 * that is what catches the classic `plugins.php` row action, both the
 * single-row and the bulk form, without knowing anything about which
 * plugin was acted on.
 */
export function noteFrameLoaded( frame: HTMLIFrameElement ): void {
	if ( exiting ) {
		return;
	}
	let doc: Document | null = null;
	try {
		doc = frame.contentDocument;
	} catch {
		// Cross-origin — not a chromeless admin page by definition.
		return;
	}
	if ( ! doc?.body || ! doc.location ) {
		return;
	}
	if ( ! doc.location.pathname.startsWith( adminPath() ) ) {
		return;
	}
	if ( doc.body.classList.contains( 'os-chromeless' ) ) {
		return;
	}
	void confirmAbsence();
}

interface JQueryLike {
	( selector: Document ): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
	};
}

/**
 * Trigger: a Heartbeat tick came back without OpenStation's nonce
 * field. Covers the case no iframe load can — the plugin deactivated
 * from another tab, or over WP-CLI, while the shell sits idle.
 *
 * Bound directly rather than through `src/heartbeat.ts`: that bus
 * deliberately skips subscribers when a field is `undefined`, and
 * `undefined` is precisely the signal here.
 */
export function bootPluginPresenceWatch(): void {
	if ( booted ) {
		return;
	}
	booted = true;
	const $ = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! $ ) {
		return;
	}
	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as Record< string, unknown > | undefined;
		if ( ! response || response[ NONCE_FIELD ] !== undefined ) {
			return;
		}
		void confirmAbsence();
	} );
}

/**
 * Test-only reset.
 *
 * @internal
 */
export function _resetPluginPresenceForTests(): void {
	confirmInFlight = false;
	lastConfirmAt = null;
	exiting = false;
	booted = false;
}
