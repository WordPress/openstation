/**
 * Shell-overlays lazy bundle — loader (main-bundle side).
 *
 * Ships in `desktop.min.js`. Owns the `<script>`-injection contract
 * for `assets/js/shell-overlays[.min].js`:
 *
 *   - `preloadShellOverlays( url )` — kicks off the script load in
 *     the background. Called from `desktop.ts` shortly after first
 *     paint (via `requestIdleCallback` / `setTimeout(0)`) so the
 *     components are registered before the user has a chance to
 *     trigger them.
 *   - `ensureShellOverlaysLoaded( url )` — awaits whichever load
 *     is in flight (or starts one) and resolves once the
 *     overlay components are guaranteed to be defined. Called by
 *     `showToast()`, `osConfirm()`, and every context-menu
 *     construction site before they `createElement( … )`.
 *
 * Detection: the bundle's `entry.ts` sets
 * `window.openStationShellOverlays` after its side-effect imports
 * have run, and that flag is the whole readiness test.
 *
 * It deliberately does NOT sniff `customElements.get( … )` for one
 * of the tags the bundle registers. Every one of those tags can also
 * arrive from somewhere else — a feature bundle that imports the
 * component directly, `window-system[.min].js`, a component that
 * drifts into `desktop.min.js` through a long import chain — and a
 * tag-based check reads any of those as "the bundle is here". It
 * then never loads, and whichever tags nothing else happened to
 * register (`os-context-menu` first among them) stay inert: a
 * right-click that opens nothing, with no error to point at it.
 * Mirrors `src/window-system/loader.ts`.
 */

declare global {
	// Augment the DOM `Window` (the browser global, not our class).
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		/** Set by `src/shell-overlays/entry.ts` once its components register. */
		openStationShellOverlays?: boolean;
	}
}

/**
 * In-flight script load. Single instance — concurrent callers all
 * await the same promise.
 */
let inflight: Promise< void > | null = null;

function isLoaded(): boolean {
	return !! window.openStationShellOverlays;
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-shell-overlays="1"]',
		);
		const finish = (): void => {
			if ( isLoaded() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] shell-overlays bundle loaded but did not set `window.openStationShellOverlays`.',
				),
			);
		};
		if ( existing ) {
			if ( isLoaded() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load shell-overlays bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osShellOverlays = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load shell-overlays bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

/**
 * Start loading `shell-overlays[.min].js` in the background. Safe
 * to call multiple times — subsequent calls are no-ops once the
 * bundle is registered or a load is in flight.
 *
 * Idempotent and fire-and-forget; errors are swallowed (an
 * `ensureShellOverlaysLoaded()` call after a failed preload will
 * see `inflight === null` and start a fresh load).
 *
 * @param scriptUrl URL of the `shell-overlays[.min].js` bundle.
 */
export function preloadShellOverlays( scriptUrl: string ): void {
	if ( ! scriptUrl || isLoaded() || inflight ) {
		return;
	}
	inflight = injectScript( scriptUrl ).catch( ( err ) => {
		// Reset so a later `ensureShellOverlaysLoaded()` can retry.
		inflight = null;
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] shell-overlays preload failed; will retry on first overlay use:',
				err,
			);
		}
	} );
}

/**
 * Await the shell-overlays bundle. Resolves immediately if the
 * components are already registered (the typical case once the
 * post-first-paint preload has landed). Otherwise injects the
 * script and waits.
 *
 * Called by `showToast()`, `osConfirm()`, and every context-menu
 * helper before they construct their custom elements.
 *
 * @param scriptUrl URL of the `shell-overlays[.min].js` bundle.
 */
export function ensureShellOverlaysLoaded(
	scriptUrl: string,
): Promise< void > {
	if ( isLoaded() ) {
		return Promise.resolve();
	}
	if ( ! scriptUrl ) {
		// No URL configured — happens in two cases:
		//   - Unit-test environments where component classes are
		//     registered directly by the test setup (jsdom + manual
		//     `defineComponent`). The construction code should still
		//     run; missing component classes will surface as
		//     un-upgraded custom elements, which the tests catch.
		//   - Misconfigured production deploys. Resolving anyway and
		//     letting the call site `createElement( ... )` an inert
		//     element is a better failure mode than rejecting and
		//     suppressing the menu/toast/dialog entirely — at least
		//     the user sees *something* and the console shows a
		//     "[openstation] custom element 'os-X' not registered"
		//     warning when they interact.
		return Promise.resolve();
	}
	if ( ! inflight ) {
		inflight = injectScript( scriptUrl );
	}
	return inflight;
}

/**
 * Read the bundle URL from the desktop config that PHP wrote onto
 * `window.openStationConfig`. Centralised here so call sites don't
 * have to plumb the URL through their own arguments.
 */
export function shellOverlaysBundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { shellOverlaysBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.shellOverlaysBundleUrl ?? '';
}

/**
 * Helper for menu / dialog construction sites. Awaits the shell-
 * overlays bundle and then invokes `fn()`. Uses an opaque
 * caller-supplied generation handle to drop superseded calls when
 * the user fires the same action repeatedly while the bundle is
 * still loading.
 *
 * Typical usage in a menu opener:
 *
 * ```ts
 * let gen = 0;
 * export function openMyMenu( opts: Opts ): void {
 *     closeMyMenu();
 *     const myGen = ++gen;
 *     openWithShellOverlays(
 *         () => myGen === gen,
 *         () => openMyMenuImmediate( opts ),
 *     );
 * }
 * ```
 *
 * @param isStillCurrent Caller's "should I still run?" predicate
 *                       evaluated after the bundle loads.
 * @param fn             What to run if `isStillCurrent()` is true.
 */
export function openWithShellOverlays(
	isStillCurrent: () => boolean,
	fn: () => void,
): void {
	const url = shellOverlaysBundleUrl();
	if ( isLoaded() || ! url ) {
		// Synchronous fast path. Two cases land here:
		//   - The bundle has already loaded (steady state after the
		//     post-first-paint preload). The component classes are
		//     registered globally; the call site can construct
		//     elements immediately.
		//   - No bundle URL is configured. Happens in vitest /
		//     jsdom (no PHP shell config, components registered
		//     directly by test setup). Running synchronously keeps
		//     the call sites' original observable behaviour so
		//     `openX( … ); document.querySelector( '.menu' )` works
		//     in unit tests without an explicit `await`.
		fn();
		return;
	}
	void ensureShellOverlaysLoaded( url )
		.then( () => {
			if ( ! isStillCurrent() ) {
				return;
			}
			fn();
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] shell-overlays failed to load; menu/dialog suppressed:',
					err,
				);
			}
		} );
}
