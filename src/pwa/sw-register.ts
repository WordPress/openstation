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
let _controllerChangeBound = false;
let _reloadingForSwUpdate = false;
let _status: SwRegistrationStatus = 'pending';

/**
 * Wire up the auto-reload on SW takeover. Two scenarios distinguished:
 *
 *   - **Cold start** — page loaded with NO prior SW controller, then
 *     just registered + activated one. No reload: the bundle was
 *     fetched directly from the network (the SW couldn't have
 *     intercepted requests it didn't yet exist for), so it's already
 *     fresh. Reloading here would be a gratuitous flicker on every
 *     first PWA open.
 *
 *   - **Deploy mid-session** — page was already controlled by an
 *     older SW, the new SW just activated and replaced it. Reload
 *     once so subsequent fetches go through the new SW (which is
 *     network-first for JS) and the freshly-deployed bundle takes
 *     effect immediately.
 *
 * The discriminator is `navigator.serviceWorker.controller` at bind
 * time: truthy → already controlled (any future controllerchange is
 * a deploy); falsy → cold start (the upcoming controllerchange is
 * the first activation, no reload needed).
 *
 * Idempotent — guarded by `_controllerChangeBound` /
 * `_reloadingForSwUpdate` so a second controllerchange event (rare,
 * but spec-permitted) doesn't loop.
 */
function bindControllerChangeReload(): void {
	if ( _controllerChangeBound ) {
		return;
	}
	_controllerChangeBound = true;
	const hadInitialController = !! navigator.serviceWorker.controller;
	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		if ( ! hadInitialController ) {
			// Cold start — first-ever SW activation for this page.
			// Bundle is already fresh; no reload.
			return;
		}
		if ( _reloadingForSwUpdate ) {
			return;
		}
		// Throttle reloads to prevent infinite cycles under DevTools'
		// "Application → Service Workers → Update on reload". That flag
		// forces an install + activate on every page load even when the
		// SW bytes are byte-identical, so every reload we trigger here
		// causes ANOTHER `controllerchange` on the next load, which
		// triggers another reload, ad infinitum.
		//
		// Window: 30s. Real-deploy reloads coalesce across rapid
		// successive activations; the user picks up the new bundle on
		// the next reload past the window.
		if ( wasRecentlyReloadedForSwUpdate() ) {
			return;
		}
		markReloadedForSwUpdate();
		_reloadingForSwUpdate = true;
		// One-frame delay so any in-flight UI work has a chance to
		// settle before the navigation. Not strictly required, but
		// avoids a class of "click → reload races input" surprises.
		setTimeout( () => window.location.reload(), 0 );
	} );
}

const SW_RELOAD_THROTTLE_KEY = 'os-sw-reload-ts';
const SW_RELOAD_THROTTLE_MS = 30_000;

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
 * worker installs, `skipWaiting()`s, claims the page, and the
 * `controllerchange` handler above reloads once. The served bytes carry
 * the plugin version in their preamble, so every release IS a byte
 * change — no release goes unnoticed for want of a navigation.
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

function wasRecentlyReloadedForSwUpdate(): boolean {
	try {
		const raw = sessionStorage.getItem( SW_RELOAD_THROTTLE_KEY );
		const last = raw ? Number.parseInt( raw, 10 ) : 0;
		if ( ! Number.isFinite( last ) || last <= 0 ) {
			return false;
		}
		return Date.now() - last < SW_RELOAD_THROTTLE_MS;
	} catch {
		// sessionStorage may be unavailable (private mode, blocked
		// storage). Without it we can't throttle, so default to
		// "no recent reload" and let the reload fire. The infinite-
		// loop scenario it guards against requires DevTools, which is
		// itself unlikely to coincide with storage being blocked.
		return false;
	}
}

function markReloadedForSwUpdate(): void {
	try {
		sessionStorage.setItem( SW_RELOAD_THROTTLE_KEY, String( Date.now() ) );
	} catch {
		// See `wasRecentlyReloadedForSwUpdate` — swallow.
	}
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
	options: { forceReplace?: boolean } = {},
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
		// Auto-reload when the new SW takes control. Bound only after a
		// successful registration so we never reload a page that has no
		// SW relationship in the first place.
		bindControllerChangeReload();
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
	_controllerChangeBound = false;
	_reloadingForSwUpdate = false;
	_unbindResumeCheck?.();
	_unbindResumeCheck = null;
	_lastResumeCheckAt = 0;
	_status = 'pending';
}
