/**
 * Pure utility helpers for the Preferences store and its app.
 *
 * Kept dependency-free — no DOM side effects and no imports from
 * other settings modules.
 */

/** Narrow an unknown value to a Promise. */
export function isPromise< T >( value: unknown ): value is Promise< T > {
	return (
		!! value &&
		typeof value === 'object' &&
		typeof ( value as { then?: unknown } ).then === 'function'
	);
}

/** True for strings shaped like `#abc` / `#aabbcc` / `#aabbccff`. */
export function isHexColor( value: unknown ): boolean {
	return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test( value );
}
