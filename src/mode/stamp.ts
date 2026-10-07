export type OsMode = 'desktop' | 'tablet' | 'mobile';

export const OS_MODES: readonly OsMode[] = [ 'desktop', 'tablet', 'mobile' ];

export const MODE_ATTRIBUTE = 'data-os-mode';

export function stampMode( root: Element, mode: OsMode ): void {
	if ( root.getAttribute( MODE_ATTRIBUTE ) !== mode ) {
		root.setAttribute( MODE_ATTRIBUTE, mode );
	}
}

export function readStampedMode( root: Element ): OsMode | null {
	const raw = root.getAttribute( MODE_ATTRIBUTE );
	return OS_MODES.includes( raw as OsMode ) ? ( raw as OsMode ) : null;
}

export function isMobileStamped( root: Element | null = typeof document !== 'undefined' ? document.documentElement : null ): boolean {
	return !! root && root.getAttribute( MODE_ATTRIBUTE ) === 'mobile';
}

export type OsDisplay = 'standalone' | 'browser';

export const OS_DISPLAYS: readonly OsDisplay[] = [ 'standalone', 'browser' ];

export const DISPLAY_ATTRIBUTE = 'data-os-display';

export function stampDisplay( root: Element, display: OsDisplay ): void {
	if ( root.getAttribute( DISPLAY_ATTRIBUTE ) !== display ) {
		root.setAttribute( DISPLAY_ATTRIBUTE, display );
	}
}

export function readStampedDisplay( root: Element ): OsDisplay | null {
	const raw = root.getAttribute( DISPLAY_ATTRIBUTE );
	return OS_DISPLAYS.includes( raw as OsDisplay ) ? ( raw as OsDisplay ) : null;
}

export function isStandaloneStamped( root: Element | null = typeof document !== 'undefined' ? document.documentElement : null ): boolean {
	return !! root && root.getAttribute( DISPLAY_ATTRIBUTE ) === 'standalone';
}
