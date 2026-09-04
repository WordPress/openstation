/**
 * OpenStation — the mode stamp (leaf).
 *
 * The one place the effective mode is written into and read from
 * the document: `data-os-mode` on `<html>`. Kept as a leaf with no
 * imports so the window-system bundle (`src/window/pointer.ts`) and
 * any other bundle can ask "is this a phone?" without pulling the
 * hook bus, the settings store or the mode controller along.
 *
 * `installMode()` in `./index.ts` owns the value; everything else
 * only reads it. The PHP head stamp (`openstation_print_mode_stamp()`)
 * writes the same attribute before the first paint, which is why a
 * reader here never needs to wait for boot.
 */

export type OsMode = 'desktop' | 'tablet' | 'mobile';

export const OS_MODES: readonly OsMode[] = [ 'desktop', 'tablet', 'mobile' ];

/** Attribute the effective mode is stamped into, on `<html>`. */
export const MODE_ATTRIBUTE = 'data-os-mode';

/** Write the mode on the root element, only when it changed. */
export function stampMode( root: Element, mode: OsMode ): void {
	if ( root.getAttribute( MODE_ATTRIBUTE ) !== mode ) {
		root.setAttribute( MODE_ATTRIBUTE, mode );
	}
}

/**
 * Read a previously stamped mode (the PHP head stamp, the live
 * controller, or a test fixture). `null` when nothing valid is there.
 */
export function readStampedMode( root: Element ): OsMode | null {
	const raw = root.getAttribute( MODE_ATTRIBUTE );
	return OS_MODES.includes( raw as OsMode ) ? ( raw as OsMode ) : null;
}

/**
 * Whether the document is currently stamped `mobile`. The cheap
 * predicate for code paths that run inside pointer handlers.
 */
export function isMobileStamped( root: Element | null = typeof document !== 'undefined' ? document.documentElement : null ): boolean {
	return !! root && root.getAttribute( MODE_ATTRIBUTE ) === 'mobile';
}

/**
 * How the document is displayed: `standalone` when it runs as an
 * installed app (a home-screen web app on iOS, an installed PWA in
 * Chromium), `browser` in an ordinary tab. Orthogonal to the mode —
 * a phone in Safari is `mobile` + `browser`; the same phone with the
 * app on its home screen is `mobile` + `standalone` — and it is what
 * decides whether `env( safe-area-inset-* )` describes a real edge.
 */
export type OsDisplay = 'standalone' | 'browser';

export const OS_DISPLAYS: readonly OsDisplay[] = [ 'standalone', 'browser' ];

/** Attribute the display is stamped into, on `<html>`. */
export const DISPLAY_ATTRIBUTE = 'data-os-display';

/** Write the display on the root element, only when it changed. */
export function stampDisplay( root: Element, display: OsDisplay ): void {
	if ( root.getAttribute( DISPLAY_ATTRIBUTE ) !== display ) {
		root.setAttribute( DISPLAY_ATTRIBUTE, display );
	}
}

/** Read a previously stamped display. `null` when nothing valid is there. */
export function readStampedDisplay( root: Element ): OsDisplay | null {
	const raw = root.getAttribute( DISPLAY_ATTRIBUTE );
	return OS_DISPLAYS.includes( raw as OsDisplay ) ? ( raw as OsDisplay ) : null;
}

/** Whether the document is currently stamped `standalone`. */
export function isStandaloneStamped( root: Element | null = typeof document !== 'undefined' ? document.documentElement : null ): boolean {
	return !! root && root.getAttribute( DISPLAY_ATTRIBUTE ) === 'standalone';
}
