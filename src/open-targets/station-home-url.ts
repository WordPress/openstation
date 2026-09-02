/**
 * Station Home — the Dashboard URL it claims.
 *
 * The app (`apps/station-home/`) has no client half; this is the one
 * piece of it that runs in the shell bundle, because the URL remap
 * that opens the window is consulted by the dock, the portal and the
 * link interceptor before any window exists.
 */

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
