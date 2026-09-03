/**
 * OpenStation — service worker registration.
 *
 * Registers the SW served at `<home>/openstation/sw.js` against the
 * SITE's home-path scope (`swScope`, `/` on most installs). The script
 * itself lives at `<home>/openstation/`, so the server response
 * carries `Service-Worker-Allowed: <home path>` to lift the scope
 * ceiling.
 *
 * Why the home path: a service worker has exactly one scope path, and
 * the only common ancestor of `<home>/openstation/` and
 * `<home>/wp-admin/` is the home path itself. Registering narrowly
 * under `openstation/` would mean the SW never sees admin-page
 * navigations — defeating the purpose for the usual install target (a
 * dashboard URL inside wp-admin). The fetch handler inside the SW
 * itself stays narrow: it only intercepts openstation and wp-admin
 * URLs under its own scope, passing everything else straight through.
 * Behaviorally this is "narrow scope" from the user's POV without
 * inheriting the technical limitation.
 *
 * On a subdirectory network every site registers its own worker at its
 * own path scope; the browser routes each page to the longest matching
 * scope, so the main site's root worker and a subsite's `/site2/`
 * worker coexist. A SIBLING site's OpenStation worker is therefore
 * never "foreign" — see {@link isOwnSwScriptUrl}.
 *
 * Co-existence: another plugin's SW already on the origin (Jetpack
 * Boost, Super PWA, etc.) — at any scope — would be replaced or
 * shadowed by our `register()`. We detect any foreign registration
 * before registering and bail with a console warning unless the
 * operator explicitly opts in via the
 * `openstation_pwa_force_replace_sw` PHP filter (returning `true`
 * surfaces as `forceReplace` on the JS-side config object).
 */

import type { PwaConfig } from '../types';

/**
 * Outcome of the most recent {@link registerServiceWorker} call.
 *
 *   - `'pending'` — registration hasn't been attempted yet (or is still
 *     in-flight).
 *   - `'registered'` — our SW is the controller (or activating).
 *   - `'foreign-sw'` — another SW (at any scope) is already registered
 *     on this origin and we bailed rather than usurp it. Operators can
 *     opt in via the `openstation_pwa_force_replace_sw` PHP filter.
 *   - `'unsupported'` — `navigator.serviceWorker` not available, or the
 *     origin isn't secure.
 *   - `'failed'` — `register()` threw.
 */
export type SwRegistrationStatus =
	| 'pending'
	| 'registered'
	| 'foreign-sw'
	| 'unsupported'
	| 'failed';

let _registration: ServiceWorkerRegistration | null = null;
let _registrationFailed = false;
let _updatesBound = false;
let _shellUpdateAnnounced = false;
/** The installed worker waiting for the shell's consent, if any. */
let _waitingWorker: ServiceWorker | null = null;
/** A swap this page asked for; the next `controllerchange` is it. */
let _swapExpected = false;
/** Resolvers waiting on that `controllerchange`. */
let _swapListeners: Array< () => void > = [];
let _status: SwRegistrationStatus = 'pending';

/** What the shell is told when a new worker carries a new shell build. */
export interface ShellUpdateInfo {
	/** The stamp this document booted with. */
	current: string;
	/** The stamp the new worker was served with. */
	served: string;
}

/**
 * How long a worker gets to answer `os-sw-get-build`. A worker that
 * never answers is treated as "unknown".
 */
const BUILD_REPLY_TIMEOUT_MS = 5000;

/**
 * How long {@link applyPendingUpdate} waits for the swap it asked for.
 * The reload it precedes is the user's; if the worker never takes
 * over, the reload still happens, onto the old worker, and the new one
 * is found waiting again on the next boot.
 */
const SWAP_TIMEOUT_MS = 3000;

/**
 * Watch the registration for a new worker, and decide what to do with
 * one — the update policy, in one place.
 *
 * A new worker installs and then WAITS (the worker never
 * `skipWaiting()`s on its own — see `src/pwa/sw.ts`). Waiting is where
 * the shell finds it, on two paths: `registration.waiting` already set
 * when this page registers (a deploy that landed before this boot, or
 * a boot on a tab that never consented), and `updatefound` →
 * `installed` for one arriving mid-session. Either way the shell asks
 * the worker which shell build it was served with, and compares that
 * with its own (`PwaConfig.shellBuild`):
 *
 *   - **Same stamp**, or unknown on either side (an older server, a
 *     body served without a preamble, a worker that does not answer):
 *     the shell's files did not change, or nobody can tell. The worker
 *     is told to take over silently. Caches refresh; nothing is shown;
 *     nothing reloads.
 *   - **Different stamp**: the shell's files really changed on the
 *     server. `onShellUpdated` runs — once per page — so the shell can
 *     *offer* a reload. The worker keeps waiting until the user takes
 *     the offer ({@link applyPendingUpdate}) or every tab closes.
 *
 * Nothing here reloads. The shell never reloads itself: a desktop is
 * somebody's work in progress.
 *
 * `controllerchange` is the swap having happened. When this page asked
 * for it, that is the signal {@link applyPendingUpdate} waits on. When
 * it did not — another tab consented, and the new worker claimed this
 * one too — the page is now running an old bundle under a new worker,
 * which is exactly the situation the waiting pattern avoids on a single
 * tab; the same comparison runs against the controller and, when the
 * shell changed, the same offer is made.
 *
 * A first install — no controller when the worker installs — activates
 * on its own and is never a takeover: this page's bundle came straight
 * from the network, and there is nothing to compare.
 */
function watchForUpdates(
	registration: ServiceWorkerRegistration,
	config: Pick< PwaConfig, 'shellBuild' >,
	onShellUpdated?: ( info: ShellUpdateInfo ) => void,
): void {
	if ( _updatesBound ) {
		return;
	}
	_updatesBound = true;
	const current = typeof config.shellBuild === 'string' ? config.shellBuild : '';

	const consider = ( worker: ServiceWorker, waiting: boolean ): void => {
		void askWorkerForBuild( worker ).then( ( served ) => {
			const changed = current !== '' && served !== '' && served !== current;
			if ( ! changed ) {
				if ( waiting ) {
					requestSwap( worker );
				}
				return;
			}
			if ( waiting ) {
				_waitingWorker = worker;
			}
			if ( _shellUpdateAnnounced || ! onShellUpdated ) {
				return;
			}
			_shellUpdateAnnounced = true;
			onShellUpdated( { current, served } );
		} );
	};

	// The worker in `installing` reports through `statechange`; only
	// one that reaches `installed` while this page is controlled is a
	// waiting update (a first install activates on its own).
	const track = ( worker: ServiceWorker | null ): void => {
		if ( ! worker || typeof worker.addEventListener !== 'function' ) {
			return;
		}
		worker.addEventListener( 'statechange', () => {
			if ( worker.state === 'installed' && navigator.serviceWorker.controller ) {
				consider( worker, true );
			}
		} );
	};

	if ( registration.waiting && navigator.serviceWorker.controller ) {
		consider( registration.waiting, true );
	}
	track( registration.installing ?? null );
	if ( typeof registration.addEventListener === 'function' ) {
		registration.addEventListener( 'updatefound', () => {
			track( registration.installing ?? null );
		} );
	}

	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		_waitingWorker = null;
		if ( _swapExpected ) {
			_swapExpected = false;
			const listeners = _swapListeners;
			_swapListeners = [];
			for ( const done of listeners ) {
				done();
			}
			return;
		}
		// A swap this page did not ask for. Not a first activation —
		// `updatefound` never led here without a controller — but
		// another tab's consent, or a worker that activated because
		// every other tab closed. Compare, and offer if it matters.
		const controller = navigator.serviceWorker.controller;
		if ( controller ) {
			consider( controller, false );
		}
	} );
}

/**
 * Tell a waiting worker to take over. The `controllerchange` that
 * follows is expected, and {@link applyPendingUpdate} may be waiting on
 * it.
 */
function requestSwap( worker: ServiceWorker ): void {
	_swapExpected = true;
	try {
		worker.postMessage( { type: 'os-sw-skip-waiting' } );
	} catch {
		_swapExpected = false;
	}
}

/**
 * Take the offered update: make the waiting worker current, and
 * resolve once it is (or after {@link SWAP_TIMEOUT_MS}). Resolves at
 * once when there is nothing waiting — the new worker already took over
 * through another tab. Never reloads; the caller does that, after the
 * session has reached the server.
 */
export function applyPendingUpdate(): Promise< void > {
	const worker = _waitingWorker;
	if ( ! worker ) {
		return Promise.resolve();
	}
	return new Promise( ( resolve ) => {
		let done = false;
		const finish = (): void => {
			if ( done ) {
				return;
			}
			done = true;
			window.clearTimeout( timer );
			resolve();
		};
		const timer = window.setTimeout( finish, SWAP_TIMEOUT_MS );
		_swapListeners.push( finish );
		requestSwap( worker );
		if ( ! _swapExpected ) {
			finish();
		}
	} );
}

/**
 * Ask a worker which shell build it was served with. Resolves `''` on
 * no answer in time, or an answer without a usable stamp.
 */
function askWorkerForBuild( worker: ServiceWorker ): Promise< string > {
	return new Promise( ( resolve ) => {
		let done = false;
		let timer = 0;
		const onMessage = ( ev: MessageEvent ): void => {
			const data = ev.data as { type?: unknown; shellBuild?: unknown } | null;
			if ( data && data.type === 'os-sw-build' ) {
				finish( typeof data.shellBuild === 'string' ? data.shellBuild : '' );
			}
		};
		const finish = ( value: string ): void => {
			if ( done ) {
				return;
			}
			done = true;
			window.clearTimeout( timer );
			navigator.serviceWorker.removeEventListener( 'message', onMessage );
			resolve( value );
		};
		timer = window.setTimeout( () => finish( '' ), BUILD_REPLY_TIMEOUT_MS );
		navigator.serviceWorker.addEventListener( 'message', onMessage );
		try {
			worker.postMessage( { type: 'os-sw-get-build' } );
		} catch {
			finish( '' );
		}
	} );
}

/**
 * Least time between two resume-time update checks.
 *
 * Each check is one small request for `sw.js` (served `no-cache`, and
 * registered with `updateViaCache: 'none'`, so the bytes are always
 * compared). Five minutes keeps a user who flicks between apps from
 * paying for it on every return, while a phone picked up after lunch
 * still checks the moment it wakes.
 */
export const SW_RESUME_CHECK_MIN_INTERVAL_MS = 5 * 60_000;

let _unbindResumeCheck: ( () => void ) | null = null;
let _lastResumeCheckAt = 0;

/**
 * Check for a new worker whenever the page comes back to the
 * foreground.
 *
 * The browser only looks for a new service worker on a navigation (and
 * on its own 24-hour clock). An installed app on a phone rarely
 * navigates: iOS keeps the page alive in the background for days and
 * brings the same document back every time the icon is tapped, so the
 * shell a user installed in May was still running in June, with no
 * reload button anywhere to ask for a newer one — the only way out was
 * to delete and reinstall the app. Deploys the shell would have picked
 * up on any desktop reload never reached it.
 *
 * So the check is run by hand on every return: `visibilitychange` to
 * visible (the app switcher, the lock screen, another tab) and
 * `pageshow` (the back-forward cache), throttled to
 * {@link SW_RESUME_CHECK_MIN_INTERVAL_MS}. `registration.update()`
 * fetches the script and compares bytes; when they differ the new
 * worker installs and waits, and {@link watchForUpdates} asks it
 * whether the shell's own files changed. The served bytes carry the
 * plugin version and the shell-build stamp in their preamble, so every
 * release IS a byte change — no release goes unnoticed for want of a
 * navigation — and only a release that changed the shell is ever
 * mentioned to the user.
 *
 * Best-effort throughout: `update()` rejecting (offline, a 503 from a
 * host mid-deploy) is the browser saying "not now", and the next return
 * asks again.
 */
function bindResumeUpdateCheck( registration: ServiceWorkerRegistration ): void {
	if ( _unbindResumeCheck ) {
		return;
	}
	// The registration that just landed counts as a check.
	_lastResumeCheckAt = Date.now();

	const check = (): void => {
		if ( typeof document !== 'undefined' && document.visibilityState === 'hidden' ) {
			return;
		}
		const now = Date.now();
		if ( now - _lastResumeCheckAt < SW_RESUME_CHECK_MIN_INTERVAL_MS ) {
			return;
		}
		_lastResumeCheckAt = now;
		try {
			void registration.update().catch( () => {
				/* Offline or a host mid-deploy; the next return asks again. */
			} );
		} catch {
			/* An unregistered or torn-down registration; nothing to check. */
		}
	};

	document.addEventListener( 'visibilitychange', check );
	window.addEventListener( 'pageshow', check );
	_unbindResumeCheck = () => {
		document.removeEventListener( 'visibilitychange', check );
		window.removeEventListener( 'pageshow', check );
	};
}

/**
 * Script-URL path suffixes of OpenStation's own PREVIOUS service-worker
 * endpoints. A browser that installed the PWA before an endpoint move
 * still holds a registration pointing at the old URL — which now 404s
 * (or serves an HTML page), so that worker can never self-update.
 * Without this list the foreign-SW guard would compare full script
 * URLs, mistake our own stale worker for another plugin's, refuse to
 * register, and strand the user on a dead SW forever. Matching by
 * suffix keeps subdirectory installs (`/site/desktop-mode/sw.js`)
 * covered. Append here whenever the SW endpoint moves again.
 */
const OWN_LEGACY_SW_PATH_SUFFIXES = [ '/desktop-mode/sw.js' ] as const;

/**
 * Whether an existing registration's script URL is one of OUR OWN —
 * current pretty URL, current extensionless fallback, or a legacy
 * endpoint from before a portal-path move. Own registrations are never
 * "foreign": registering the current URL at the same scope simply
 * replaces them, which is exactly the recovery a stale worker needs.
 */
function isOwnSwScriptUrl(
	url: string,
	config: Pick< PwaConfig, 'swUrl' | 'swFallbackUrl' >,
): boolean {
	if ( url === config.swUrl || url === config.swFallbackUrl ) {
		return true;
	}
	try {
		const parsed = new URL( url );
		// A SIBLING site's OpenStation worker, on a subdirectory
		// network: same origin, another site's path, but our own route
		// shapes — the pretty `…/openstation/sw.js` or the
		// extensionless `?openstation_sw=1` fallback. Each site scopes
		// its own worker, so a sibling is never in our way and must
		// not stop this site from registering.
		if (
			parsed.pathname.endsWith( '/openstation/sw.js' ) ||
			parsed.searchParams.has( 'openstation_sw' )
		) {
			return true;
		}
		return OWN_LEGACY_SW_PATH_SUFFIXES.some( ( suffix ) =>
			parsed.pathname.endsWith( suffix ),
		);
	} catch {
		return false;
	}
}

/**
 * Register the service worker. No-op outside browsers, on insecure
 * origins, or when the SW URL isn't configured.
 *
 * Returns the registration on success, `null` otherwise.
 */
/**
 * Read this user's PWA flags from OpenStation Preferences and send
 * them to the worker.
 *
 * Reads through `wp.os` rather than importing the settings module: this
 * file is part of the boot path, and the settings state may not have
 * been created when registration runs. Absent means both off, which is
 * what the worker already assumes.
 */
function sendCurrentConfigToWorker(): void {
	// `openStationConfig.pwa.swConfig`, not the settings snapshot: the
	// admin-asset-cache value is computed server-side through the
	// `openstation_pwa_admin_asset_cache` filter, so an operator's
	// site-wide veto must survive. Reading the raw user preference here
	// would quietly ignore it.
	const swConfig = (
		window as unknown as {
			openStationConfig?: {
				pwa?: {
					swConfig?: {
						adminAssetCache?: boolean;
						windowPrewarm?: boolean;
					};
				};
			};
		}
	).openStationConfig?.pwa?.swConfig;
	notifyServiceWorkerConfig( {
		adminAssetCache: swConfig?.adminAssetCache === true,
		windowPrewarm: swConfig?.windowPrewarm === true,
	} );
}

export async function registerServiceWorker(
	config: PwaConfig | undefined,
	options: {
		forceReplace?: boolean;
		/**
		 * Runs once when a new worker reports a shell-build stamp
		 * different from the one this page booted with — the shell's
		 * files really changed on the server. See
		 * {@link watchForUpdates}. The shell offers a reload; it never
		 * performs one. Taking the offer is {@link applyPendingUpdate}.
		 */
		onShellUpdated?: ( info: ShellUpdateInfo ) => void;
	} = {},
): Promise< ServiceWorkerRegistration | null > {
	if ( typeof navigator === 'undefined' || ! ( 'serviceWorker' in navigator ) ) {
		_status = 'unsupported';
		return null;
	}
	if ( ! config?.swUrl ) {
		_status = 'unsupported';
		return null;
	}
	if ( ! window.isSecureContext ) {
		// SWs require HTTPS (or `localhost`). On a plain-HTTP staging
		// install we silently skip — no point alarming the user about
		// something the operator can't fix from inside the shell.
		_status = 'unsupported';
		return null;
	}
	if ( _registration || _registrationFailed ) {
		return _registration;
	}

	// Detect a foreign SW already registered on this origin — at any
	// scope, not just one controlling this page. Without this check,
	// our `register()` call silently usurps (or fights with) the
	// existing one — bad form for hosts who deliberately enabled
	// another PWA.
	if ( ! options.forceReplace ) {
		const existing = await navigator.serviceWorker
			.getRegistrations()
			.catch( () => [] as ServiceWorkerRegistration[] );
		const foreign = existing.find( ( reg ) => {
			const url = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? '';
			return url !== '' && ! isOwnSwScriptUrl( url, config );
		} );
		if ( foreign ) {
			_status = 'foreign-sw';
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] another service worker is already registered (' +
						foreign.scope +
						'); skipping openstation SW. Set openstation_pwa_force_replace_sw=true to override.',
				);
			}
			return null;
		}
	}

	const attempt = async (
		url: string,
	): Promise< ServiceWorkerRegistration > =>
		navigator.serviceWorker.register( url, {
			// The site's own home path — `/` on most installs, the
			// site path on a subdirectory network's subsites. Older
			// servers don't send it; root is their historical scope.
			scope: config.swScope || '/',
			updateViaCache: 'none',
		} );

	try {
		try {
			_registration = await attempt( config.swUrl );
		} catch ( err ) {
			// Some hosts' web servers (WordPress.com) 404 the pretty
			// `/openstation/sw.js` route before WordPress can serve it
			// — virtual paths with a static-file extension never reach
			// PHP there. Retry once with the extensionless fallback
			// (`/?openstation_sw=1`), which always routes to WordPress
			// and whose `/` path grants root scope natively.
			if ( ! config.swFallbackUrl || config.swFallbackUrl === config.swUrl ) {
				throw err;
			}
			_registration = await attempt( config.swFallbackUrl );
		}
		_status = 'registered';
		// Learn about a new worker. Bound only after a successful
		// registration so a page with no SW relationship is never asked
		// anything.
		watchForUpdates( _registration, config, options.onShellUpdated );
		// A phone that never navigates still learns about a release the
		// next time the app comes to the front.
		bindResumeUpdateCheck( _registration );
		// Hand the worker this user's flags. They are not in the served
		// bytes — see `notifyServiceWorkerConfig()` — so this is how it
		// learns them at all. Sent now and again on `controllerchange`,
		// because a worker that has just taken control starts from the
		// defaults.
		sendCurrentConfigToWorker();
		navigator.serviceWorker.addEventListener(
			'controllerchange',
			sendCurrentConfigToWorker,
		);
		return _registration;
	} catch ( err ) {
		_registrationFailed = true;
		_status = 'failed';
		if ( typeof console !== 'undefined' ) {
			console.warn( '[openstation] SW registration failed:', err );
		}
		return null;
	}
}

/**
 * Tell the RUNNING worker that hover prewarming was switched.
 *
 * A worker has no copy of this flag except what it is told: the served
 * bytes carry only `pluginUrl`, so every worker starts with prewarming
 * off and stays that way until a message arrives. Without this call the
 * setting looked broken in both directions — turning it on enabled the
 * shell-side half immediately while the worker went on dropping
 * `os-speculate-doc`, and turning it off left the worker speculating.
 *
 * Best-effort by design: with no controller there is no worker to
 * disagree with us, and the next one starts from the safe default
 * (off) until {@link notifyServiceWorkerConfig} syncs it at boot.
 *
 * @param enabled The new setting.
 */
export function notifyServiceWorkerPrewarm( enabled: boolean ): void {
	try {
		navigator.serviceWorker?.controller?.postMessage( {
			type: 'os-sw-set-prewarm',
			enabled,
		} );
	} catch {
		/* No controller, or messaging unavailable — nothing to sync. */
	}
}

/**
 * Hand the running worker this user's PWA preferences.
 *
 * They are no longer in the served script bytes, and deliberately so:
 * both are per-user, a service worker is origin-wide, and baking them
 * in made the body differ between an anonymous and a logged-in request.
 * Any in-scope logged-out navigation then served different bytes, which
 * the browser installs as an update — and the `controllerchange`
 * handler below hard-reloads the desktop. Identical bytes for everyone,
 * per-user values over a message.
 *
 * Called at boot and whenever a toggle changes. Best-effort: with no
 * controller there is nothing to configure, and the worker's defaults
 * (both off) are the safe side to be on.
 *
 * @param config                 The user's current flags.
 * @param config.adminAssetCache Shared admin-asset cache opt-in.
 * @param config.windowPrewarm   Hover-intent prewarming opt-in.
 */
export function notifyServiceWorkerConfig( config: {
	adminAssetCache: boolean;
	windowPrewarm: boolean;
} ): void {
	try {
		navigator.serviceWorker?.controller?.postMessage( {
			type: 'os-sw-config',
			...config,
		} );
	} catch {
		/* No controller yet — `controllerchange` re-sends. */
	}
}

/**
 * Synchronous read of the most recent registration outcome. Drives
 * UI that needs to differentiate "install isn't available" causes —
 * e.g. the install tile's click handler surfaces a foreign-SW-specific
 * toast when the value is `'foreign-sw'`.
 */
export function getSwRegistrationStatus(): SwRegistrationStatus {
	return _status;
}

/**
 * Synchronous accessor. Returns `null` until `registerServiceWorker`
 * resolves.
 */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
	return _registration;
}

/** Test-only: clear cached registration. */
export function _resetSwRegistration(): void {
	_registration = null;
	_registrationFailed = false;
	_updatesBound = false;
	_shellUpdateAnnounced = false;
	_waitingWorker = null;
	_swapExpected = false;
	_swapListeners = [];
	_unbindResumeCheck?.();
	_unbindResumeCheck = null;
	_lastResumeCheckAt = 0;
	_status = 'pending';
}
