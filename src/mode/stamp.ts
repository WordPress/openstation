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
