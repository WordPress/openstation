const DARK_SCHEMES: ReadonlySet< string > = new Set( [
	'midnight',
	'ectoplasm',
	'coffee',
	'ocean',
] );

export function monacoThemeForScheme( scheme: string | undefined | null ): 'vs' | 'vs-dark' {
	if ( ! scheme ) {
		return 'vs-dark';
	}
	return DARK_SCHEMES.has( scheme ) ? 'vs-dark' : 'vs';
}

export function currentColorScheme(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { colorScheme?: string };
	} ).openStationConfig;
	return cfg?.colorScheme ?? '';
}
