/**
 * About-scene lazy loader.
 *
 * Lives in the main `desktop.min.js` bundle. Exposes the same
 * `mountAboutScene( opts )` async signature as the impl, but
 * `<script>`-injects the impl bundle on first call instead of
 * statically importing the 25 kB module.
 *
 * The bundle URL is taken from the shell config
 * (`config.aboutSceneBundleUrl`), built server-side so the
 * `SCRIPT_DEBUG` choice between `.js` and `.min.js` and the
 * `?ver=OPEN_STATION_VERSION` cache-buster stay in PHP.
 */

import type { AboutScene, SceneOptions } from './about-scene';

declare global {
	interface Window {
		openStationMountAboutScene?: ( opts: SceneOptions ) => Promise< AboutScene >;
	}
}

let loadPromise: Promise< ( opts: SceneOptions ) => Promise< AboutScene > > | null = null;

function loadImpl( scriptUrl: string ): Promise<
	( opts: SceneOptions ) => Promise< AboutScene >
> {
	if ( window.openStationMountAboutScene ) {
		return Promise.resolve( window.openStationMountAboutScene );
	}
	if ( loadPromise ) {
		return loadPromise;
	}
	loadPromise = new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-about-scene="1"]',
		);
		const finish = (): void => {
			const fn = window.openStationMountAboutScene;
			if ( ! fn ) {
				reject(
					new Error(
						'[openstation] about-scene bundle loaded but did not register openStationMountAboutScene',
					),
				);
				return;
			}
			resolve( fn );
		};
		if ( existing ) {
			if ( window.openStationMountAboutScene ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load about-scene bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osAboutScene = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load about-scene bundle' ) ),
		);
		document.head.appendChild( s );
	} );
	return loadPromise;
}

/**
 * Load and invoke the lazy about-scene impl. Same signature as the
 * underlying `mountAboutScene` so call sites read identically.
 *
 * @param opts      Scene options forwarded to the impl.
 * @param scriptUrl URL of the `about-scene[.min].js` bundle.
 */
export async function mountAboutSceneLazy(
	opts: SceneOptions,
	scriptUrl: string,
): Promise< AboutScene > {
	const fn = await loadImpl( scriptUrl );
	return fn( opts );
}

export type { AboutScene, SceneOptions } from './about-scene';
