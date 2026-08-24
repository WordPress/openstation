/**
 * OpenStation — deferred stylesheets for on-demand shell surfaces.
 *
 * Three shell surfaces render on demand but are not native windows —
 * the Preferences panel, the AI assistant, and the bug-report window
 * are built client-side by the always-loaded desktop bundle — so the
 * `styles` companion list on `openstation_register_window()` cannot
 * carry their CSS. Their sheets used to be enqueued on every shell
 * boot instead, paid whether or not the surface ever opened.
 *
 * PHP now resolves those handles into
 * `openStationConfig.deferredStyles` (handle → `{ url, inline }`,
 * built by `openstation_build_deferred_styles()`), and the surface's
 * open path calls {@link ensureDeferredStyle} — injecting the
 * `<link>` (plus any `wp_add_inline_style` blobs, replayed after it
 * so the cascade matches what the print pipeline would have written)
 * exactly once. The `<link>` fetch runs in parallel with whatever
 * else the open is doing; repeat calls are a Set lookup.
 *
 * Deliberately mirrors the native-window sync's own stylesheet
 * injector, including the defensive head lookup: if a sheet is also
 * server-printed (a site that re-enqueues it, an older cached shell
 * page), the existing tag is adopted rather than duplicated.
 */

import type { DesktopConfig } from './types';

/** Handles already injected (or found server-printed) this page. */
const injected = new Set< string >();

/**
 * Inject the stylesheet registered under `handle` in
 * `openStationConfig.deferredStyles`, once.
 *
 * A handle with no entry is a silent no-op — the map only carries
 * handles PHP could resolve, so a missing one means the sheet is
 * either already delivered another way or genuinely absent, and the
 * surface must render regardless.
 *
 * @param handle WP style handle, as keyed in the config map.
 */
export function ensureDeferredStyle( handle: string ): void {
	if ( injected.has( handle ) ) {
		return;
	}
	const config = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;
	const entry = config?.deferredStyles?.[ handle ];
	if ( ! entry?.url ) {
		return;
	}
	// Mark before injecting: a second caller in the same tick must
	// not race a duplicate in.
	injected.add( handle );

	// Adopt a tag the server printed rather than double-injecting.
	// Escape the URL for the attribute selector — it comes from PHP
	// `wp_styles()`, so any character is fair game.
	const safeUrl = entry.url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
	const existing = document.head.querySelector< HTMLLinkElement >(
		`link[rel="stylesheet"][href="${ safeUrl }"]`,
	);
	if ( ! existing ) {
		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = entry.url;
		link.dataset.osStyleHandle = handle;
		document.head.appendChild( link );
	}
	for ( const css of entry.inline ?? [] ) {
		if ( typeof css !== 'string' || css === '' ) {
			continue;
		}
		const style = document.createElement( 'style' );
		style.dataset.osStyleHandle = handle;
		style.textContent = css;
		document.head.appendChild( style );
	}
}

/** Test-only: forget what was injected so cases start clean. */
export function __resetDeferredStylesForTests(): void {
	injected.clear();
}
