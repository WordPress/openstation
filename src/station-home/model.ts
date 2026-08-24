/**
 * Small, deterministic Station Home view-model helpers.
 *
 * Kept separate from the render entry so URL-remap and greeting behavior can
 * be tested without loading the custom-element bundle.
 */

import { __, sprintf } from '../i18n';

/** The query flag used by OpenStation's intentional classic-admin escape. */
export const CLASSIC_DASHBOARD_FLAG = 'desktop_mode_classic';

/**
 * Claim the ordinary WordPress Dashboard, but never its classic escape URL
 * nor a Dashboard subpage — index.php?page=<slug> is a different destination
 * that happens to share the Dashboard's path.
 */
export function matchesStationHomeUrl( parsed: URL ): boolean {
	return (
		parsed.pathname.endsWith( '/index.php' ) &&
		! parsed.searchParams.has( 'page' ) &&
		! parsed.searchParams.has( CLASSIC_DASHBOARD_FLAG )
	);
}

/** Build a localized, time-aware greeting. */
export function stationHomeGreeting( hour: number, name: string ): string {
	if ( hour < 12 ) {
		return sprintf(
			/* translators: %s: current user's name. */
			__( 'Good morning, %s' ),
			name,
		);
	}
	if ( hour < 18 ) {
		return sprintf(
			/* translators: %s: current user's name. */
			__( 'Good afternoon, %s' ),
			name,
		);
	}
	return sprintf(
		/* translators: %s: current user's name. */
		__( 'Good evening, %s' ),
		name,
	);
}
