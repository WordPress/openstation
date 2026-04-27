/**
 * Desktop Mode — i18n bridge.
 *
 * Thin wrapper around `window.wp.i18n` (the `@wordpress/i18n` package
 * shipped by core under the `wp-i18n` script handle). We depend on
 * the handle explicitly in {@see includes/assets.php} and use
 * `wp_set_script_translations()` to associate our bundle with the
 * plugin's translation JSON — so callers here never need to know
 * about script handles, JED format, or hash-based filenames.
 *
 * Every user-facing string in our TypeScript should go through
 * `__()` / `_x()` / `_n()` here rather than being hard-coded. The
 * functions DEFAULT the text domain to `'desktop-mode'` so
 * callers write `__( 'Add widget' )` and don't have to repeat the
 * domain on every call.
 *
 * Fallback behaviour: if `wp.i18n` isn't loaded (edge case — the
 * script handle is a hard dep, so this should never trigger in
 * production), the original English string is returned verbatim.
 * We'd rather show English than throw.
 *
 * @since 0.8.0
 */
/* eslint-disable @wordpress/i18n-text-domain, @wordpress/i18n-no-variables */

/** Plugin-wide text domain. Kept as a const so typos become TS errors. */
export const TEXT_DOMAIN = 'desktop-mode';

/**
 * Structural type for the slice of `@wordpress/i18n` we actually
 * call. The real module exports more (setLocaleData, subscribe,
 * resetLocaleData) that plugins can still reach via
 * `window.wp.i18n` directly.
 */
interface WpI18n {
	__: ( text: string, domain?: string ) => string;
	_x: ( text: string, context: string, domain?: string ) => string;
	_n: (
		single: string,
		plural: string,
		number: number,
		domain?: string,
	) => string;
	_nx: (
		single: string,
		plural: string,
		number: number,
		context: string,
		domain?: string,
	) => string;
	sprintf: ( format: string, ...args: unknown[] ) => string;
}

declare global {
	interface WpGlobal {
		i18n?: WpI18n;
	}
}

function i18n(): WpI18n | undefined {
	return window.wp?.i18n;
}

/** Translate a string in the plugin's text domain. */
export function __( text: string, domain: string = TEXT_DOMAIN ): string {
	return i18n()?.__( text, domain ) ?? text;
}

/** Translate with context — disambiguates homographs. */
export function _x(
	text: string,
	context: string,
	domain: string = TEXT_DOMAIN,
): string {
	return i18n()?._x( text, context, domain ) ?? text;
}

/** Translate with plural forms. */
export function _n(
	single: string,
	plural: string,
	number: number,
	domain: string = TEXT_DOMAIN,
): string {
	return (
		i18n()?._n( single, plural, number, domain ) ??
		( number === 1 ? single : plural )
	);
}

/** Plural + context. */
export function _nx(
	single: string,
	plural: string,
	number: number,
	context: string,
	domain: string = TEXT_DOMAIN,
): string {
	return (
		i18n()?._nx( single, plural, number, context, domain ) ??
		( number === 1 ? single : plural )
	);
}

/**
 * Format a translation template. Supports `%s`, `%d`, `%1$s` style
 * positional tokens (the real `sprintf` implementation). Falls back
 * to a minimal `%s`-only replacement when `wp.i18n` is missing so
 * the caller still sees the intended shape rather than a raw token.
 */
export function sprintf( format: string, ...args: unknown[] ): string {
	const impl = i18n()?.sprintf;
	if ( impl ) {
		return impl( format, ...args );
	}
	// Minimal fallback covering the two tokens our call sites use:
	// %s (any) and %d (number). Good enough for dev environments /
	// tests where `wp.i18n` isn't loaded — production always has it.
	let i = 0;
	return format.replace( /%[sd]/g, () => String( args[ i++ ] ?? '' ) );
}
