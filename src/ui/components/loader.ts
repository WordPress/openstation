/**
 * Runtime loader for the full `<os-*>` component kit.
 *
 * Ships in `desktop.min.js` and backs `wp.os.loadComponents()`.
 *
 * Components register per bundle at import time, so the tags that
 * work on a given page are whatever the loaded bundles happened to
 * import — roughly a third of the kit after boot. Inside this repo
 * the fix is an import. Outside it there wasn't one: a plugin
 * distributed as a zip has no path to import from at build time,
 * and bundling its own copy ships components the page already has.
 *
 * This module is the missing route. `loadComponents()` injects
 * `os-components[.min].js` once, and every tag upgrades.
 *
 * ```js
 * await wp.os.loadComponents( [ 'os-switch', 'os-number-field' ] );
 * container.innerHTML = '<os-switch label="Live"></os-switch>';
 * ```
 *
 * **On the two questions a tag can answer.** Passing tags lets the
 * loader skip the fetch when they are all already registered, and
 * `customElements.get( tag )` is the right test for that — the
 * question is "will this tag upgrade?", which is exactly what the
 * registry knows. It is NOT a test for "has my bundle loaded?";
 * that one belongs to {@link readiness}, because any bundle can
 * register any tag. Conflating the two is what left the shell's
 * context menus inert for months.
 */

import { OS_COMPONENT_TAGS } from './tags';

declare global {
	// Augment the DOM `Window` (the browser global, not our class).
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		/** Set by `src/ui/components/entry.ts` once the kit registers. */
		openStationComponents?: boolean;
	}
}

const KNOWN: ReadonlySet< string > = new Set( OS_COMPONENT_TAGS );

/** In-flight injection. Concurrent callers share one `<script>`. */
let inflight: Promise< void > | null = null;

/** Whether the kit bundle itself has run. */
function readiness(): boolean {
	return !! window.openStationComponents;
}

/**
 * Read the bundle URL from the config PHP wrote onto
 * `window.openStationConfig`.
 */
export function componentsBundleUrl(): string {
	const cfg = (
		window as unknown as {
			openStationConfig?: { componentsBundleUrl?: string };
		}
	).openStationConfig;
	return cfg?.componentsBundleUrl ?? '';
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const finish = (): void => {
			if ( readiness() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] component kit loaded but did not set `window.openStationComponents`.',
				),
			);
		};
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-components="1"]',
		);
		if ( existing ) {
			if ( readiness() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load component kit' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osComponents = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load component kit' ) ),
		);
		document.head.appendChild( s );
	} );
}

/**
 * Complain about tags that will never upgrade, in the voice the
 * missing-import warner uses — the developer is holding a tag name
 * that isn't one.
 */
function reportUnknown( tags: readonly string[] ): void {
	const unknown = tags.filter( ( tag ) => ! KNOWN.has( tag ) );
	if ( unknown.length === 0 || typeof console === 'undefined' ) {
		return;
	}
	console.error(
		`[openstation] wp.os.loadComponents(): not a component — ${ unknown
			.map( ( t ) => `<${ t }>` )
			.join(
				', ',
			) }. The kit registers ${ OS_COMPONENT_TAGS.length } tags; see docs/components-reference.md for the list. The others in this call still loaded.`,
	);
}

/**
 * Make `<os-*>` tags upgrade, loading the component kit if needed.
 *
 * Resolves once the requested tags are registered — immediately
 * when they already are, so calling this before each render is
 * cheap and is the recommended shape.
 *
 * @param tags Tags the caller is about to render. Optional: with no
 *             argument the whole kit loads. With one, the fetch is
 *             skipped entirely when every tag listed is already
 *             registered, and names that aren't components are
 *             reported to the console.
 * @return Resolves when the tags are usable. Rejects only if the
 *         bundle was needed and could not be fetched.
 */
export async function loadComponents(
	tags?: readonly string[],
): Promise< void > {
	if ( tags ) {
		reportUnknown( tags );
		const pending = tags.filter(
			( tag ) => KNOWN.has( tag ) && ! customElements.get( tag ),
		);
		if ( pending.length === 0 ) {
			return;
		}
	} else if ( readiness() ) {
		return;
	}

	const url = componentsBundleUrl();
	if ( ! url ) {
		// No URL configured — unit tests (no PHP config; the setup
		// file registers components directly) and misconfigured
		// deploys. Resolving is the better failure: the caller
		// renders, and any tag that really is missing gets the
		// missing-import warner's console.error naming it.
		return;
	}
	if ( ! inflight ) {
		inflight = injectScript( url ).catch( ( err ) => {
			// Don't cache the failure — a flaky network should let
			// the next call try again.
			inflight = null;
			throw err;
		} );
	}
	await inflight;
}
