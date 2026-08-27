/**
 * OpenStation — service worker registration.
 *
 * Registers the SW served at `/openstation/sw.js` against root scope.
 * The script itself lives at `/openstation/`, so the server response
 * carries `Service-Worker-Allowed: /` to lift the scope ceiling.
 *
 * Why root scope: a service worker has exactly one scope path, and
 * the only common ancestor of `/openstation/` and `/wp-admin/` is
 * `/`. Registering narrowly under `/openstation/` would mean the SW
 * never sees admin-page navigations — defeating the purpose for the
 * usual install target (a dashboard URL inside wp-admin). The fetch
 * handler inside the SW itself stays narrow: it only intercepts
 * openstation and wp-admin URLs, passing everything else straight
 * through. Behaviorally this is "narrow scope" from the user's POV
 * without inheriting the technical limitation.
 *
 * Co-existence: another SW already on the origin (Jetpack Boost,
 * Super PWA, etc.) — at any scope, not just root — would be replaced
 * or shadowed by our root-scope `register()`. We detect any foreign
 * registration before registering and bail with a console warning
 * unless the operator explicitly opts in via the
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
		const pathname = new URL( url ).pathname;
		return OWN_LEGACY_SW_PATH_SUFFIXES.some( ( suffix ) =>
			pathname.endsWith( suffix ),
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
			scope: '/',
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
	_status = 'pending';
}
