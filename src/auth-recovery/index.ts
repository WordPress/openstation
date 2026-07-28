/**
 * Session-expiry detection + in-place recovery for the parent shell.
 *
 * Replaces the inline `desktop-mode-parent-auth-recovery.js` script
 * that used to ship from `includes/render/shell.php`. That script
 * monkey-patched `window.fetch` + `XMLHttpRequest` (so every shell
 * request showed the recovery script as its DevTools initiator) and
 * answered any re-auth with a hard reload of the whole shell — the
 * only tool it had, because at the time there was no way to swap
 * cached nonces in place. `src/nonce-refresh.ts` (0.8.7) changed
 * that: every functional Heartbeat tick now carries a fresh
 * `desktop_mode_nonces` map and rewrites the cached values live.
 *
 * The model here is a small state machine driven by authoritative
 * signals only:
 *
 *   - **Detect loss** — the Heartbeat response field
 *     `wp-auth-check` (attached server-side by core on every tick)
 *     flips to `false`. Core's own `wp-auth-check.js` shows the
 *     login modal in the parent shell; chromeless iframes have
 *     theirs suppressed (`desktop_mode_chromeless_suppress_auth_check()`)
 *     so the desktop shows exactly ONE prompt.
 *   - **Detect recovery** — the same field flips back to `true`,
 *     or a chromeless iframe's bridge posts
 *     `desktop-mode-reauth-detected` (its heartbeat noticed first),
 *     or core's modal hides (the user just re-authed inside it).
 *     The modal-hide path only *accelerates* the next tick — the
 *     heartbeat flag stays the single source of truth, so closing
 *     the modal without logging in never triggers recovery.
 *   - **Recover in place** — force a tick (fresh nonces ride it,
 *     `includes/nonce-refresh.php` attaches them to the
 *     `nonces_expired` short-circuit response too), reload the
 *     chromeless iframes (their PHP-rendered nonce globals are
 *     stale beyond repair), and announce
 *     `HOOKS.AUTH_LOST` / `HOOKS.AUTH_RESTORED` + the matching
 *     document CustomEvents. The parent shell itself never
 *     reloads — windows, wallpaper, and widget state survive.
 *
 * The one remaining hard-reload case is a **user switch**: if the
 * re-auth logged in a *different* account, in-place refresh would
 * leave user A's desktop issuing user B's requests. The
 * `desktop_mode_auth.uid` heartbeat field detects that and reloads.
 *
 * The 401/403 fast path (`noteAuthFailure`, called by
 * `wp.desktop.fetch`) only *accelerates* detection by forcing an
 * early tick — it never decides anything by itself, so a plain
 * permission 403 (`rest_forbidden` for a capability the user
 * lacks) costs at most one debounced heartbeat POST and can never
 * pop the login modal for a live session.
 */

import { heartbeat } from '../heartbeat';
import { doAction, HOOKS } from '../hooks';

/** Matches `DESKTOP_MODE_AUTH_FIELD` in `includes/nonce-refresh.php`. */
const AUTH_FIELD = 'desktop_mode_auth';

/**
 * Debounce for the 401/403 → `connectNow()` fast path. Long-ish on
 * purpose: a burst of failed requests must not turn into a
 * heartbeat storm.
 */
const FAILURE_COOLDOWN_MS = 5000;

/**
 * Debounce for the "a functional tick is wanted now" path
 * (`nonces_expired` seen, or the login modal just closed). Short —
 * these are one-shot accelerators in a chain that core terminates
 * after a single round trip (the `nonces_expired` response already
 * carries the fresh `heartbeat_nonce` for the follow-up tick).
 */
const TICK_COOLDOWN_MS = 1000;

/**
 * Minimum spacing between full recovery runs. Recovery is
 * triggered from multiple racing signals (own heartbeat, iframe
 * postMessage per open window); the first one wins, the echoes
 * within this window are no-ops.
 */
const RECOVERY_COOLDOWN_MS = 10_000;

interface WpWithHeartbeat {
	wp?: {
		heartbeat?: { connectNow?: () => void };
	};
}

let booted = false;
let sawLoggedOut = false;
let authLostAnnounced = false;
let bootUid = 0;
let failureCooldownUntil = 0;
let tickCooldownUntil = 0;
let tickTimer: number | null = null;
let lastRecoveryAt = 0;
let messageListener: ( ( ev: MessageEvent ) => void ) | null = null;
let modalObserver: MutationObserver | null = null;
let reloadShell: () => void = () => {
	try {
		window.location.reload();
	} catch {
		/* navigation already in flight */
	}
};

function connectNow(): void {
	try {
		const hb = ( window as unknown as WpWithHeartbeat ).wp?.heartbeat;
		if ( hb && typeof hb.connectNow === 'function' ) {
			hb.connectNow();
		}
	} catch {
		/* heartbeat not available — the regular schedule still applies */
	}
}

/**
 * Ask for a functional heartbeat tick soon (debounced). Used when a
 * signal says the *next* tick will carry what we need (fresh
 * nonces, the `wp-auth-check` verdict) and waiting up to 120 s for
 * the regular schedule would leave the shell degraded.
 *
 * Trailing-edge debounce: a request landing inside the cooldown is
 * deferred to the cooldown's end, not dropped. The chains here are
 * two ticks long (modal hides → tick 1 says `nonces_expired` →
 * tick 2 carries the verdict); dropping the second request would
 * strand the chain on the regular schedule — up to a full
 * heartbeat interval of limbo.
 */
function forceTickSoon( cooldownMs: number = TICK_COOLDOWN_MS ): void {
	const now = Date.now();
	if ( now < tickCooldownUntil ) {
		if ( tickTimer === null ) {
			tickTimer = window.setTimeout( () => {
				tickTimer = null;
				tickCooldownUntil = Date.now() + TICK_COOLDOWN_MS;
				connectNow();
			}, tickCooldownUntil - now );
		}
		return;
	}
	tickCooldownUntil = now + cooldownMs;
	connectNow();
}

function announceAuthLost(): void {
	sawLoggedOut = true;
	if ( authLostAnnounced ) {
		return;
	}
	authLostAnnounced = true;
	doAction( HOOKS.AUTH_LOST );
	document.dispatchEvent( new CustomEvent( 'desktop-mode-auth-lost' ) );
}

/**
 * Reload every same-origin iframe except core's own login iframe
 * (`#wp-auth-check-frame`, inside `#wp-auth-check-wrap`) — that one
 * is mid-handshake and reloading it would tear the login flow down.
 *
 * Two reasons the sweep exists (unchanged from the old script):
 * each iframe's PHP-rendered nonce globals (`_wpUpdatesSettings`,
 * `wpApiSettings`, …) are stale beyond in-place repair, and an
 * iframe that got bounced to `wp-login.php` while logged out walks
 * its history back to the original admin page once cookies are
 * fresh.
 */
function reloadChromelessIframes(): void {
	for ( const frame of _reloadableIframes() ) {
		try {
			// Cross-origin access throws — caught + ignored (not ours).
			frame.contentWindow?.location.reload();
		} catch {
			/* not ours */
		}
	}
}

/**
 * The iframes a recovery sweep targets. Split out so the exclusion
 * rule (never touch core's mid-handshake login iframe) is testable
 * without stubbing `Location#reload`.
 *
 * @internal
 */
export function _reloadableIframes(): HTMLIFrameElement[] {
	let frames: NodeListOf< HTMLIFrameElement >;
	try {
		frames = document.querySelectorAll( 'iframe' );
	} catch {
		return [];
	}
	return Array.from( frames ).filter(
		( frame ) =>
			frame.id !== 'wp-auth-check-frame' &&
			! frame.closest( '#wp-auth-check-wrap' ),
	);
}

/**
 * The session is authenticated again — bring the desktop back
 * without rebooting it. Idempotent within `RECOVERY_COOLDOWN_MS`
 * so the racing detection signals (own tick + one postMessage per
 * open window) collapse into a single run.
 */
function runRecovery(): void {
	const now = Date.now();
	if ( now - lastRecoveryAt < RECOVERY_COOLDOWN_MS ) {
		return;
	}
	lastRecoveryAt = now;
	sawLoggedOut = false;
	authLostAnnounced = false;

	// Pull a functional tick immediately: it delivers the fresh
	// `desktop_mode_nonces` map (nonce-refresh rewrites every cached
	// value in place), the `desktop_mode_auth` uid for the
	// user-switch check, and the `wp-auth-check: true` flag that
	// makes core's modal hide itself. Bypass the debounce — this is
	// the recovery itself, not an accelerator — and drop any
	// deferred accelerator tick, which this one supersedes.
	if ( tickTimer !== null ) {
		window.clearTimeout( tickTimer );
		tickTimer = null;
	}
	tickCooldownUntil = 0;
	forceTickSoon();

	reloadChromelessIframes();

	doAction( HOOKS.AUTH_RESTORED );
	document.dispatchEvent( new CustomEvent( 'desktop-mode-auth-restored' ) );
}

/**
 * User-switch guard. In-place recovery assumes the same account
 * came back; when the interim login authenticated a different
 * user, the rendered desktop (dock, capabilities, content) belongs
 * to someone else — reload and let the server build the right one.
 */
function checkUid( value: unknown ): void {
	const uid =
		value && typeof value === 'object'
			? Number( ( value as { uid?: unknown } ).uid )
			: NaN;
	if ( ! Number.isFinite( uid ) || uid <= 0 ) {
		return;
	}
	if ( bootUid <= 0 ) {
		// Shell config didn't carry a viewer id — adopt the first
		// authenticated tick as the baseline.
		bootUid = uid;
		return;
	}
	if ( uid !== bootUid ) {
		reloadShell();
	}
}

/**
 * Fast-path accelerator fed by `wp.desktop.fetch`: a same-origin
 * admin request came back 401/403, so the session *might* be gone —
 * ask Heartbeat for a verdict now instead of waiting up to 120 s
 * for the next scheduled tick. Deliberately decides nothing itself:
 * permission 403s from live sessions are common
 * (`rest_forbidden` on a route the user can't access) and must not
 * cause any user-visible reaction.
 *
 * Unlike the old global `fetch`/XHR monkey-patch this only sees
 * traffic routed through `wp.desktop.fetch` — which the framework
 * mandates for all shell HTTP. Raw-fetch stragglers merely fall
 * back to the regular heartbeat schedule.
 */
export function noteAuthFailure( status: number, url: string ): void {
	if ( status !== 401 && status !== 403 ) {
		return;
	}
	let resolved: URL;
	try {
		resolved = new URL( String( url || '' ), window.location.href );
	} catch {
		return;
	}
	if ( resolved.origin !== window.location.origin ) {
		return;
	}
	// Heartbeat's own endpoint can't be allowed to re-trigger itself,
	// and wp-login legitimately 4xxes during the auth handshake.
	if (
		resolved.pathname.indexOf( '/wp-admin/admin-ajax.php' ) !== -1 &&
		/(?:^|&|\?)action=heartbeat(?:&|$)/.test( resolved.search )
	) {
		return;
	}
	if ( resolved.pathname.indexOf( '/wp-login.php' ) !== -1 ) {
		return;
	}
	const now = Date.now();
	if ( now < failureCooldownUntil ) {
		return;
	}
	failureCooldownUntil = now + FAILURE_COOLDOWN_MS;
	connectNow();
}

/**
 * Watch core's `#wp-auth-check-wrap` for the visible → hidden
 * transition. When the user re-authenticates *inside* the modal
 * (interim-login success), core hides it without any heartbeat
 * involvement — and on this screen core only forces a follow-up
 * tick on the post editor. Without this observer the shell would
 * sit on stale nonces for up to a full heartbeat interval after
 * the user logged back in.
 *
 * Only accelerates: the forced tick reports `wp-auth-check`, and
 * recovery still keys off that flag — a close-button dismissal
 * (no re-auth) yields a `false` verdict and changes nothing.
 */
function observeAuthCheckModal(): void {
	const wrap = document.getElementById( 'wp-auth-check-wrap' );
	if ( ! wrap || typeof MutationObserver === 'undefined' ) {
		return;
	}
	let wasVisible = ! wrap.classList.contains( 'hidden' );
	modalObserver = new MutationObserver( () => {
		const visible = ! wrap.classList.contains( 'hidden' );
		if ( wasVisible && ! visible ) {
			forceTickSoon();
		}
		wasVisible = visible;
	} );
	modalObserver.observe( wrap, {
		attributes: true,
		attributeFilter: [ 'class' ],
	} );
}

export interface AuthRecoveryOpts {
	/** Boot-time viewer id (`config.currentUserId`), if known. */
	currentUserId?: number;
	/**
	 * Test seam — replaces the full-page reload used by the
	 * user-switch guard. Production callers omit it.
	 *
	 * @internal
	 */
	reloadShell?: () => void;
}

/**
 * Wire the recovery state machine. Idempotent. Called once from
 * `src/desktop.ts` during shell boot; plugin authors subscribe to
 * `HOOKS.AUTH_LOST` / `HOOKS.AUTH_RESTORED` (or the
 * `desktop-mode-auth-lost` / `desktop-mode-auth-restored` document
 * CustomEvents) instead of calling this.
 *
 * @internal
 */
export function bootAuthRecovery( opts: AuthRecoveryOpts = {} ): void {
	if ( booted ) {
		return;
	}
	booted = true;
	bootUid = Number( opts.currentUserId ) > 0 ? Number( opts.currentUserId ) : 0;
	if ( opts.reloadShell ) {
		reloadShell = opts.reloadShell;
	}

	// Core attaches `wp-auth-check` to every functional tick —
	// `false` while the session is expired, `true` otherwise. This
	// flag is the single decision point for both edges.
	heartbeat.subscribe< boolean >( 'wp-auth-check', ( value ) => {
		if ( value === false ) {
			announceAuthLost();
			return;
		}
		if ( value === true && sawLoggedOut ) {
			runRecovery();
		}
	} );

	// A tick bounced off a stale `heartbeat-nonce` (first tick after
	// a re-login, or plain 24 h nonce expiry). The response already
	// healed heartbeat's own nonce AND carried `desktop_mode_nonces`
	// (see `desktop_mode_nonce_refresh_on_expired()`).
	//
	// Only core's LOGGED-IN heartbeat handler ever sends this field —
	// a logged-out request routes to `wp_ajax_nopriv_heartbeat`,
	// which has no nonce check at all. So seeing `nonces_expired`
	// while we know the session was down IS the re-auth signal,
	// one round-trip before the `wp-auth-check` flag flips back.
	// Outside an outage it's plain nonce aging: just pull the next
	// functional tick forward so the fresh map lands now.
	heartbeat.subscribe( 'nonces_expired', () => {
		if ( sawLoggedOut ) {
			runRecovery();
			return;
		}
		forceTickSoon();
	} );

	heartbeat.subscribe( AUTH_FIELD, checkUid );

	// A chromeless iframe's heartbeat saw the re-auth before ours
	// did (each iframe ticks on its own schedule). Trust it enough
	// to start recovery even if we never observed the outage — the
	// stale-nonce gap is real even when the parent dodged the
	// expired window entirely. `runRecovery`'s own cooldown absorbs
	// the one-message-per-open-window fan-in.
	messageListener = ( ev: MessageEvent ) => {
		if ( ev.origin !== window.location.origin ) {
			return;
		}
		const data = ev.data as { type?: string } | null;
		if ( ! data || typeof data !== 'object' ) {
			return;
		}
		if ( data.type === 'desktop-mode-reauth-detected' ) {
			runRecovery();
		}
	};
	window.addEventListener( 'message', messageListener );

	observeAuthCheckModal();
}

/**
 * Test-only reset. Drops the boot flag + every piece of module
 * state so an isolated test can rewire from scratch.
 *
 * @internal
 */
export function _resetAuthRecoveryForTests(): void {
	booted = false;
	sawLoggedOut = false;
	authLostAnnounced = false;
	bootUid = 0;
	failureCooldownUntil = 0;
	tickCooldownUntil = 0;
	lastRecoveryAt = 0;
	if ( tickTimer !== null ) {
		window.clearTimeout( tickTimer );
		tickTimer = null;
	}
	if ( messageListener ) {
		window.removeEventListener( 'message', messageListener );
		messageListener = null;
	}
	if ( modalObserver ) {
		modalObserver.disconnect();
		modalObserver = null;
	}
	reloadShell = () => {
		try {
			window.location.reload();
		} catch {
			/* navigation already in flight */
		}
	};
}
