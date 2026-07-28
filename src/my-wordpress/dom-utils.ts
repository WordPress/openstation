/**
 * My WordPress — shared DOM + drag helpers.
 *
 * Tiny utility module so `index.ts`, `media-list.ts`, and
 * `media-detail.ts` don't each carry their own copy of the same
 * `getDragManager` / `stripTags` definitions.
 *
 * @public
 */

import type { DragManagerApi } from '../drag';

/**
 * Read the runtime DragManager off the `wp.desktop` global. Boot
 * order guarantees this is present by the time any tile builder
 * runs (the My WordPress window only mounts after
 * `installPublicApi(desktopApi)` has wired the manager).
 *
 * @public
 */
export function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { desktop?: { dragManager?: DragManagerApi } } }
	).wp?.desktop?.dragManager;
	return api ?? null;
}

/**
 * Strip HTML tags from a rendered string the WordPress REST API
 * returns under `*.rendered`. Cheap — uses a detached `<div>` and
 * `textContent`. Does NOT decode entities the same way the rendered
 * HTML would; callers that need full fidelity should keep the HTML.
 *
 * @public
 */
export function stripTags( html: string ): string {
	const div = document.createElement( 'div' );
	div.innerHTML = html;
	return ( div.textContent ?? '' ).trim();
}
