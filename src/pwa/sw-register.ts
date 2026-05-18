/**
 * Desktop Mode — service worker registration.
 *
 * Registers the SW served at `/desktop-mode/sw.js` against root scope.
 * The script itself lives at `/desktop-mode/`, so the server response
 * carries `Service-Worker-Allowed: /` to lift the scope ceiling.
 *
 * Why root scope: a service worker has exactly one scope path, and
 * the only common ancestor of `/desktop-mode/` and `/wp-admin/` is
 * `/`. Registering narrowly under `/desktop-mode/` would mean the SW
 * never sees admin-page navigations — defeating the purpose for the
 * usual install target (a dashboard URL inside wp-admin). The fetch
 * handler inside the SW itself stays narrow: it only intercepts
 * desktop-mode and wp-admin URLs, passing everything else straight
 * through. Behaviorally this is "narrow scope" from the user's POV
 * without inheriting the technical limitation.
 *
 * Co-existence: another root-scoped SW already on the origin (Jetpack
 * Boost, Super PWA, etc.) means our `register()` will replace it.
 * We detect the case before registering and bail with a console
 * warning unless the operator explicitly opts in via the
 * `desktop_mode_pwa_force_replace_sw` PHP filter (returning `true`
 * surfaces as `forceReplace` on the JS-side config object).
 *
 * @since 0.8.0
 */

import type { PwaConfig } from '../types';

/**
 * Outcome of the most recent {@link registerServiceWorker} call.
 *
 *   - `'pending'` — registration hasn't been attempted yet (or is still
 *     in-flight).
 *   - `'registered'` — our SW is the controller (or activating).
 *   - `'foreign-sw'` — another root-scope SW is already on this origin
 *     and we bailed rather than usurp it. Operators can opt in via the
 *     `desktop_mode_pwa_force_replace_sw` PHP filter.
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

const SW_RELOAD_THROTTLE_KEY = 'wpd-sw-reload-ts';
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
 * Register the service worker. No-op outside browsers, on insecure
 * origins, or when the SW URL isn't configured.
 *
 * Returns the registration on success, `null` otherwise.
 */
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

	// Detect a foreign SW already controlling the page. Without this
	// check, our `register()` call silently usurps the existing one
	// — bad form for hosts who deliberately enabled another PWA.
	if ( ! options.forceReplace ) {
		const existing = await navigator.serviceWorker
			.getRegistrations()
			.catch( () => [] as ServiceWorkerRegistration[] );
		const foreign = existing.find( ( reg ) => {
			const url = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? '';
			return url !== '' && url !== config.swUrl;
		} );
		if ( foreign ) {
			_status = 'foreign-sw';
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[desktop-mode] another service worker is already registered (' +
						foreign.scope +
						'); skipping desktop-mode SW. Set desktop_mode_pwa_force_replace_sw=true to override.',
				);
			}
			return null;
		}
	}

	try {
		_registration = await navigator.serviceWorker.register( config.swUrl, {
			scope: '/',
			updateViaCache: 'none',
		} );
		_status = 'registered';
		// Auto-reload when the new SW takes control. Bound only after a
		// successful registration so we never reload a page that has no
		// SW relationship in the first place.
		bindControllerChangeReload();
		return _registration;
	} catch ( err ) {
		_registrationFailed = true;
		_status = 'failed';
		if ( typeof console !== 'undefined' ) {
			console.warn( '[desktop-mode] SW registration failed:', err );
		}
		return null;
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
