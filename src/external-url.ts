export function tryOpenExternalUrl( url: string ): boolean {
	try {
		const parsed = new URL( url, window.location.origin );
		if ( parsed.origin === window.location.origin ) {
			return false;
		}
		window.open( parsed.toString(), '_blank', 'noopener,noreferrer' );
		return true;
	} catch {
		return false;
	}
}
