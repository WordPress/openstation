/**
 * Notices OpenStation being deactivated or deleted under a running
 * shell, and walks the user out.
 *
 * The server cannot announce it: the next request no longer loads the
 * plugin. So triggers are cheap and allowed to be wrong (an admin
 * iframe without the `os-chromeless` body class, a Heartbeat tick
 * without `desktop_mode_nonces`), and a REST namespace ping is what
 * actually decides. A false trigger then costs one silent request.
 */

import { __ } from './i18n';
import { showToast } from './toast';
import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';

/** Matches `OPENSTATION_NONCE_REFRESH_FIELD` in `includes/nonce-refresh.php`. */
const NONCE_FIELD = 'desktop_mode_nonces';

/** The REST namespace whose existence means that the plugin is active. */
const NAMESPACE_PATH = 'desktop-mode/v1';

/** Triggers are allowed to be noisy, so the throttle is what bounds the request rate. */
const CONFIRM_COOLDOWN_MS = 30_000;

/** Time to read the toast before the navigation. */
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
 * Admin path prefix. The marker comes from `admin_body_class`, so a
 * front-end page in a window never carries it and is fine.
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

/** Confirm, or dismiss, a suspicion that the plugin is gone. */
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
 * Navigate the top frame to the classic Dashboard. Not a reload,
 * because the current URL may be a now-unroutable `admin.php?page=…`.
 */
function exitToClassicAdmin(): void {
	if ( exiting ) {
		return;
	}
	exiting = true;

	// Armed before the toast, and the toast is allowed to fail: on a
	// delete, the lazy `shell-overlays` bundle it renders through is
	// no longer on disk.
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
 * Trigger: a window iframe finished loading. Fires on in-place
 * navigations too, which is what catches the classic `plugins.php`
 * row and bulk actions.
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
 * Trigger: a Heartbeat tick without OpenStation's nonce field, which
 * catches deactivation from another tab or WP-CLI. Bound directly
 * rather than through `src/heartbeat.ts`, because that bus skips
 * subscribers on `undefined` and `undefined` is the signal here.
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
