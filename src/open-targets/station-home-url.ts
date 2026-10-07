export const CLASSIC_DASHBOARD_FLAG = 'desktop_mode_classic';

export function matchesStationHomeUrl( parsed: URL ): boolean {
	return (
		parsed.pathname.endsWith( '/index.php' ) &&
		! parsed.searchParams.has( 'page' ) &&
		! parsed.searchParams.has( CLASSIC_DASHBOARD_FLAG )
	);
}
