/**
 * Code Editor — Monaco theme sync with the WP color scheme.
 *
 * WordPress ships with eight + admin color schemes; the canonical
 * dark vs light split (used by core's CSS) maps cleanly onto
 * Monaco's `vs` / `vs-dark` built-ins. We don't try to match the
 * accent — Monaco's syntax-color palette has its own logic. The
 * goal here is just to keep the editor body chromatically consistent
 * with the surrounding desktop chrome (no jarring white pane on a
 * midnight desktop, no pitch-black pane on a fresh-light desktop).
 *
 * @public
 * @since 0.18.0
 */

/**
 * Schemes WordPress paints with a dark base. Anything not in this
 * set defaults to a light Monaco theme, including unknown schemes
 * a user may have installed via a third-party "color scheme"
 * plugin — light is the safer default since misjudged colors on a
 * dark base read as "broken" while extra contrast on a light base
 * just looks high-contrast.
 */
const DARK_SCHEMES: ReadonlySet< string > = new Set( [
	'midnight',
	'ectoplasm',
	'coffee',
	'ocean',
] );

/**
 * Map a WP color-scheme slug to the Monaco built-in theme id that
 * fits visually.
 *
 * @public
 * @since 0.18.0
 */
export function monacoThemeForScheme( scheme: string | undefined | null ): 'vs' | 'vs-dark' {
	if ( ! scheme ) {
		return 'vs-dark';
	}
	return DARK_SCHEMES.has( scheme ) ? 'vs-dark' : 'vs';
}

/**
 * Read the current scheme from the localized shell config. Returns
 * `''` if the config isn't present (e.g. tests).
 *
 * @public
 * @since 0.18.0
 */
export function currentColorScheme(): string {
	const cfg = ( window as unknown as {
		wpDesktopConfig?: { colorScheme?: string };
	} ).wpDesktopConfig;
	return cfg?.colorScheme ?? '';
}
