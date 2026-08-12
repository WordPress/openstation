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
import { createSharedStore } from './shared-store';
import { leaveForClassicAdmin, LEAVE_DELAY_MS } from './exit-openstation';

/** Matches `OPENSTATION_NONCE_REFRESH_FIELD` in `includes/nonce-refresh.php`. */
const NONCE_FIELD = 'desktop_mode_nonces';

/** The REST namespace whose existence means that the plugin is active. */
const NAMESPACE_PATH = 'desktop-mode/v1';

/** Triggers are allowed to be noisy, so the throttle is what bounds the request rate. */
const CONFIRM_COOLDOWN_MS = 30_000;

/**
 * Consecutive "actually still here" answers before the watcher gives
 * up. Some sites sit in a permanent trigger state: the Heartbeat
 * field is gated on `openstation_is_enabled()`, so a user who turns
 * OpenStation off in another tab makes every later tick a trigger.
 * Without a cap that is a ping every cooldown, forever, for nothing.
 * Proof the plugin is alive resets it.
 */
const MAX_NEGATIVE_CONFIRMS = 3;

interface PresenceState {
	confirmInFlight: boolean;
	/** `null` until the first ping — distinct from "pinged at epoch 0". */
	lastConfirmAt: number | null;
	exiting: boolean;
	booted: boolean;
	negativeConfirms: number;
}

/**
 * Shared because this module compiles into BOTH the main bundle
 * (via `desktop.ts`) and the lazy `window-system` bundle (via
 * `window/dom.ts`). Module-level state would give each copy its own
 * flags: two exits racing, and a cooldown that bounds nothing.
 */
const store = createSharedStore< PresenceState >(
	'desktop-mode/plugin-presence',
	() => ( {
		confirmInFlight: false,
		lastConfirmAt: null,
		exiting: false,
		booted: false,
		negativeConfirms: 0,
	} ),
);

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

/**
 * `null` when the shell config carries no REST root. Guessing one
 * gets subdirectory installs and plain permalinks wrong, and a wrong
 * guess 404s every time, which would be a guaranteed false eviction.
 * Not pinging at all is the safe answer.
 */
function namespaceUrl(): string | null {
	const root = readConfig().restUrl;
	if ( ! root ) {
		return null;
	}
	return joinRestUrl( root, NAMESPACE_PATH );
}

/** The plugin answered, so stop distrusting the triggers. */
function noteStillPresent(): void {
	store.state.negativeConfirms = 0;
}

/** Confirm, or dismiss, a suspicion that the plugin is gone. */
async function confirmAbsence(): Promise< void > {
	const s = store.state;
	if ( s.exiting || s.confirmInFlight ) {
		return;
	}
	if ( s.negativeConfirms >= MAX_NEGATIVE_CONFIRMS ) {
		return;
	}
	const url = namespaceUrl();
	if ( ! url ) {
		return;
	}
	const now = Date.now();
	if ( s.lastConfirmAt !== null && now - s.lastConfirmAt < CONFIRM_COOLDOWN_MS ) {
		return;
	}
	s.lastConfirmAt = now;
	s.confirmInFlight = true;
	try {
		const res = await trackedFetch(
			url,
			{ credentials: 'same-origin' },
			{ silent: true, source: 'desktop-mode/plugin-presence' },
		);
		if ( res.status !== 404 ) {
			s.negativeConfirms += 1;
			return;
		}
		// A bare 404 is not enough. Plenty of things return one while
		// OpenStation is perfectly healthy: a REST-hardening plugin
		// that unregisters namespaces, a firewall or CDN rule on
		// `/wp-json`. Only WordPress's own "no such route" body means
		// the routes are genuinely gone. A non-JSON body (an HTML
		// block page) throws out to the catch, which is the same
		// answer.
		const body = ( await res.json() ) as { code?: string } | null;
		if ( body?.code !== 'rest_no_route' ) {
			s.negativeConfirms += 1;
			return;
		}
		exitToClassicAdmin();
	} catch {
		/* Offline or blocked — say nothing, keep the shell up. */
	} finally {
		s.confirmInFlight = false;
	}
}

function exitToClassicAdmin(): void {
	if ( store.state.exiting ) {
		return;
	}
	store.state.exiting = true;

	// Armed before the toast, and the toast is allowed to fail: on a
	// delete, the lazy `shell-overlays` bundle it renders through is
	// no longer on disk.
	leaveForClassicAdmin( readConfig().adminUrl || '' );

	try {
		showToast( {
			message: __(
				'OpenStation is no longer active. Returning to the WordPress dashboard…',
			),
			duration: LEAVE_DELAY_MS,
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
	if ( store.state.exiting ) {
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
	// Also where `about:blank` frames (a window before its real src
	// lands) drop out.
	if ( ! doc.location.pathname.startsWith( adminPath() ) ) {
		return;
	}
	if ( doc.body.classList.contains( 'os-chromeless' ) ) {
		noteStillPresent();
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
	if ( store.state.booted ) {
		return;
	}
	store.state.booted = true;
	const $ = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! $ ) {
		return;
	}
	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as Record< string, unknown > | undefined;
		if ( ! response ) {
			return;
		}
		if ( response[ NONCE_FIELD ] !== undefined ) {
			noteStillPresent();
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
	store.reset();
}
