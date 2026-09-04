/**
 * Heartbeat-driven refresh of the shell's cached nonces.
 *
 * WordPress nonces expire after `nonce_life` (24 hours by default).
 * The desktop shell is a long-running SPA — without periodic
 * refresh, every nonce stamped into `window.openStationConfig` /
 * `window.openStationWindowConfig` at page render goes stale once
 * the tab has been open longer than a day. Native windows that
 * carry a cached `restNonce` (Plugins, Posts, Pages, Users, …)
 * then hit `rest_cookie_invalid_nonce` — surfaced to the user as
 * the misleading "Cookie check failed" error, GH#250.
 *
 * Server side (`includes/nonce-refresh.php`) attaches a fresh map
 * `{ action: nonce }` to every Heartbeat tick under the field
 * `desktop_mode_nonces`. This module subscribes via the shared
 * `heartbeat` bus and rewrites every registered target in place
 * so consumers that read `getConfig()` per-request automatically
 * pick the new value up. `wp_create_nonce()` returns the same
 * string within a 12-hour tick window, so the actual nonce only
 * changes when the tick rolls — well before the 24-hour hard
 * expiry catches the cached value.
 *
 * Extending from third-party plugins: subscribe to the
 * heartbeat field directly via the public heartbeat surface —
 *
 *     wp.os.heartbeat.subscribe( 'desktop_mode_nonces', ( map ) => {
 *         // map[ 'my-plugin/admin-ajax' ] is the fresh value
 *     } );
 *
 * The matching action must be published from PHP via the
 * `openstation_nonce_refresh_actions` filter so the server
 * actually ships it.
 *
 * `registerNonceTarget()` below is an internal helper the
 * framework uses to wire its own built-in targets — third-party
 * bundles don't ship with the main bundle's module graph, so
 * importing it directly isn't supported. The public extension
 * surface is the heartbeat subscription above.
 */

import { heartbeat } from './heartbeat';

/**
 * Heartbeat field name. Matches the server-side constant in
 * `includes/nonce-refresh.php` — keep both in sync.
 */
const HEARTBEAT_FIELD = 'desktop_mode_nonces';

/** Shape of the heartbeat field — `{ nonce-action: fresh-value }`. */
type NoncePayload = Record< string, string >;

/**
 * Updater registered against a single nonce action. Called with
 * the freshly-minted value on every Heartbeat tick that carries
 * the action.
 */
type NonceTargetUpdater = ( freshNonce: string ) => void;

const targets = new Map< string, Set< NonceTargetUpdater > >();
let booted = false;

/**
 * Register a target that should receive fresh `wp_create_nonce()`
 * values for `action` on every Heartbeat tick. Returns an
 * unsubscribe. Multiple targets per action compose — useful when
 * the same action backs more than one cached field.
 *
 * Call this at boot, before the first heartbeat tick fires. Any
 * registration that lands after a tick is still picked up on the
 * next one — no replay of the most recent value is performed,
 * since the initial cached value (from the per-window config
 * blob) is already correct at registration time.
 *
 * Framework-only. Third-party plugins can't import this from a
 * separate bundle; use
 * `wp.os.heartbeat.subscribe( 'desktop_mode_nonces', cb )`
 * instead and read the action key off the returned map.
 *
 * @internal
 */
export function registerNonceTarget(
	action: string,
	updater: NonceTargetUpdater,
): () => void {
	if ( typeof action !== 'string' || action === '' ) {
		return () => {};
	}
	let set = targets.get( action );
	if ( ! set ) {
		set = new Set();
		targets.set( action, set );
	}
	set.add( updater );
	return () => {
		set!.delete( updater );
	};
}

/**
 * Wire the heartbeat subscriber. Idempotent — calling twice is a
 * no-op so the boot order between this and per-window
 * registrations doesn't matter.
 *
 * Called once from `src/desktop.ts` during shell boot. Plugin
 * authors don't need to call this.
 *
 * @internal
 */
export function bootNonceRefresh(): void {
	if ( booted ) {
		return;
	}
	booted = true;
	heartbeat.subscribe< NoncePayload >( HEARTBEAT_FIELD, ( payload ) => {
		if ( ! payload || typeof payload !== 'object' ) {
			return;
		}
		for ( const [ action, value ] of Object.entries( payload ) ) {
			if ( typeof value !== 'string' || value === '' ) {
				continue;
			}
			const set = targets.get( action );
			if ( ! set ) {
				continue;
			}
			for ( const updater of set ) {
				try {
					updater( value );
				} catch ( err ) {
					// One bad updater shouldn't strand peers. Log
					// loudly so plugin authors notice.
					// eslint-disable-next-line no-console
					console.error(
						`[desktop-mode/nonce-refresh] updater for "${ action }" threw:`,
						err,
					);
				}
			}
		}
	} );

	registerShellAndPluginsWindowTargets();
}

/**
 * Wire the framework's own cached nonces.
 *
 *   - `wp_rest` backs `window.openStationConfig.restNonce`
 *      (used by `injectRestNonce()` shell-wide) and the
 *      per-window blob of every app window.
 *   - `desktop-mode-plugins` backs the Plugins app's
 *      `ajaxNonce` (admin-ajax handlers we own).
 *   - `updates` backs the Plugins app's `updatesNonce`
 *      (Core's wp.updates install/update handlers).
 *
 * The Plugins app ships both through `App::config()`, so they live
 * under the blob's `extra` (`wp.os.getWindowConfig( id ).extra`) and
 * the app reads them at call time — the rewrite lands in place.
 * Every app window's `restNonce` is picked up by the `wp_rest`
 * target generically — see `updateAllRestNonces`. New per-window
 * action strings need their own `registerNonceTarget()` call,
 * either inline below or from the feature module itself.
 */
function registerShellAndPluginsWindowTargets(): void {
	registerNonceTarget( 'wp_rest', updateAllRestNonces );
	registerNonceTarget( 'desktop-mode-plugins', ( fresh ) => {
		writeWindowConfigField( 'desktop-mode-plugins', 'ajaxNonce', fresh );
	} );
	registerNonceTarget( 'updates', ( fresh ) => {
		writeWindowConfigField( 'desktop-mode-plugins', 'updatesNonce', fresh );
	} );
}

/**
 * Push the fresh `wp_rest` nonce into every cached location the
 * framework knows about: the shell-wide config the auto-injector
 * reads, plus every per-window config blob that carries a
 * `restNonce` string. Iterating the whole map is cheap (a handful
 * of windows) and means new native windows pick up refresh for
 * free as long as they follow the `restNonce` naming convention.
 */
function updateAllRestNonces( fresh: string ): void {
	const cfg = readShellConfig();
	if ( cfg && typeof cfg.restNonce === 'string' ) {
		cfg.restNonce = fresh;
	}
	const windowConfigs = readWindowConfigs();
	if ( ! windowConfigs ) {
		return;
	}
	for ( const blob of Object.values( windowConfigs ) ) {
		if (
			blob &&
			typeof blob === 'object' &&
			typeof ( blob as { restNonce?: unknown } ).restNonce === 'string'
		) {
			( blob as { restNonce: string } ).restNonce = fresh;
		}
	}
}

function writeWindowConfigField(
	windowId: string,
	field: string,
	value: string,
): void {
	const blobs = readWindowConfigs();
	const blob = blobs?.[ windowId ];
	if ( ! blob || typeof blob !== 'object' ) {
		return;
	}
	const record = blob as Record< string, unknown >;
	// An App Framework window keeps its `App::config()` values under
	// `extra`; a legacy blob keeps them at the top level; a blob may
	// carry the same name in both (a nonce the runtime sends AND the
	// app reads). Rewrite every copy that exists, so no reader is left
	// with a stale one.
	const extra = record.extra;
	let written = false;
	if ( extra && typeof extra === 'object' && field in ( extra as Record< string, unknown > ) ) {
		( extra as Record< string, unknown > )[ field ] = value;
		written = true;
	}
	if ( field in record || ! written ) {
		record[ field ] = value;
	}
}

function readShellConfig(): { restNonce?: unknown } | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}
	return ( window as unknown as {
		openStationConfig?: { restNonce?: unknown };
	} ).openStationConfig;
}

function readWindowConfigs(): Record< string, unknown > | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}
	return ( window as unknown as {
		openStationWindowConfig?: Record< string, unknown >;
	} ).openStationWindowConfig;
}

/**
 * Test-only reset. Drops every registered target + the boot
 * flag so an isolated test can rewire from scratch.
 *
 * @internal
 */
export function _resetNonceRefreshForTests(): void {
	targets.clear();
	booted = false;
}
