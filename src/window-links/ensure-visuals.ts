/**
 * OpenStation — on-demand loader for the window-link visuals bundle.
 *
 * `window-link-visuals[.min].js` carries the render host, its geometry
 * and the built-in `svg-splines` renderer. It is deliberately lazy:
 * `src/desktop.ts` pulls it in on the first relation group the engine
 * reports, so a session whose windows never relate never pays for it.
 *
 * That laziness had one victim. The bundle is also what REGISTERS
 * `svg-splines` into the renderer registry (registration is a load-time
 * side effect — see `visuals-entry.ts`), and OpenStation Preferences
 * builds its "Link style" dropdown from that same registry. Open
 * Preferences in a session where no two windows had yet related, and
 * the registry held nothing: the only option was `None`, the stored
 * value was still `svg-splines`, and `<os-select>` — asked to display a
 * value no option carries — rendered blank. The setting looked broken
 * while working perfectly.
 *
 * So both callers route through here: the sentinel in `desktop.ts`
 * that needs the host in order to draw, and the settings section that
 * needs only the registrations in order to list them. `loadVendorScript`
 * de-duplicates by URL, so whichever arrives second shares the first
 * one's fetch, and the registry's `createSharedStore` backing means the
 * registration is visible to every bundle regardless of who triggered
 * it.
 */

import type { DesktopConfig } from '../types';
import { loadVendorScript } from '../wallpapers/vendor-loader';

let inflight: Promise< boolean > | null = null;

/**
 * Load the visuals bundle, once.
 *
 * Resolves `true` when the bundle is in the page (or already was),
 * `false` when there is no bundle URL to load — a site old enough not
 * to ship one, where the caller should simply carry on without it.
 *
 * A failed load clears the memo so a later caller can retry rather
 * than being stuck with a registry that will never fill.
 */
export function ensureWindowLinkVisuals(): Promise< boolean > {
	if ( inflight ) {
		return inflight;
	}

	if ( window.openStationWindowLinkVisuals ) {
		inflight = Promise.resolve( true );
		return inflight;
	}

	const config = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;
	const url = config?.windowLinkVisualsBundleUrl;
	if ( ! url ) {
		return Promise.resolve( false );
	}

	inflight = loadVendorScript( url )
		.then( () => true )
		.catch( ( err ) => {
			inflight = null;
			throw err;
		} );
	return inflight;
}

/** Test-only: forget the in-flight memo. */
export function __resetWindowLinkVisualsForTests(): void {
	inflight = null;
}
