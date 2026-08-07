/**
 * Main-bundle loader for the lazy `window-system[.min].js` bundle.
 *
 * Ships in `desktop.min.js`. `WindowManager.open()` / `openNew()`
 * (both async) call `ensureWindowSystemLoaded()`
 * before constructing any `Window` instance — the factory is
 * published on `window.openStationWindowSystem` by the lazy
 * bundle's entry.
 *
 * Pattern mirrors `src/shell-overlays/loader.ts` exactly:
 *
 *   - `preloadWindowSystem( url )` — fire-and-forget background
 *     `<script>` injection. Called from `desktop.ts` after first
 *     paint when the boot path detects that *no* session restore
 *     and *no* `openCurrentPage` will fire — i.e. the user's
 *     about to see the desktop with zero windows. The preload
 *     warms the bundle for the first click without blocking
 *     anything.
 *
 *   - `ensureWindowSystemLoaded( url )` — `await`-able single-flight
 *     guarantee that the factory is registered. Resolves
 *     immediately on the sync fast path (already loaded OR no URL
 *     configured — the test-environment fallback).
 */

import type { WindowSystemApi } from './types';

let inflight: Promise< void > | null = null;

function isLoaded(): boolean {
	return !! window.openStationWindowSystem;
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-window-system="1"]',
		);
		const finish = (): void => {
			if ( isLoaded() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] window-system bundle loaded but did not register `window.openStationWindowSystem`.',
				),
			);
		};
		if ( existing ) {
			if ( isLoaded() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load window-system bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osWindowSystem = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load window-system bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

/**
 * URL of the lazy window-system bundle, read from the shell
 * config that PHP wrote onto `window.openStationConfig`.
 */
export function windowSystemBundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { windowSystemBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.windowSystemBundleUrl ?? '';
}

/**
 * Start loading the window-system bundle in the background. Safe
 * to call multiple times; idempotent.
 *
 * @param scriptUrl URL of the bundle.
 */
export function preloadWindowSystem( scriptUrl: string ): void {
	if ( ! scriptUrl || isLoaded() || inflight ) {
		return;
	}
	inflight = injectScript( scriptUrl ).catch( ( err ) => {
		inflight = null;
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] window-system preload failed; will retry on first open():',
				err,
			);
		}
	} );
}

/**
 * Await the window-system bundle. Resolves immediately if the
 * factory is already registered (steady state after the preload
 * has landed). Otherwise injects the script and waits.
 *
 * Resolves with the factory so the caller can immediately
 * `factory.createWindow( … )` without a separate `window.` lookup.
 *
 * @param scriptUrl URL of the bundle.
 */
export async function ensureWindowSystemLoaded(
	scriptUrl: string,
): Promise< WindowSystemApi > {
	if ( isLoaded() ) {
		return window.openStationWindowSystem as WindowSystemApi;
	}
	if ( ! scriptUrl ) {
		// No URL configured. Two cases land here:
		//
		//   - Unit tests (vitest / jsdom) where the bundle never
		//     loads; the test setup imports the `Window` class
		//     directly and assigns the factory by hand. If neither
		//     of those happened the test will fail loudly when it
		//     reads `window.openStationWindowSystem`, which is the
		//     right failure mode.
		//
		//   - Mis-configured production deploys. We throw an
		//     explicit, descriptive Error (rejecting the returned
		//     promise) — far easier to diagnose than returning the
		//     undefined slot and letting the caller crash later
		//     with an opaque TypeError on `factory.createWindow( … )`.
		const fn = window.openStationWindowSystem;
		if ( fn ) {
			return fn;
		}
		throw new Error(
			'[openstation] ensureWindowSystemLoaded(): no bundle URL configured and `window.openStationWindowSystem` is not pre-registered.',
		);
	}
	if ( ! inflight ) {
		inflight = injectScript( scriptUrl );
	}
	await inflight;
	return window.openStationWindowSystem as WindowSystemApi;
}
