/**
 * Deprecation helpers for the public API.
 *
 * The architecture-0.8.1 refactor renamed a handful of legacy
 * surfaces (`osm_*` PHP hooks → `openstation_*`, the occasional
 * stray `wp.os.fooLegacy()` JS method) to bring everything
 * under one prefix. We promised plugin authors that no existing
 * name would silently disappear: instead, every renamed surface
 * is kept as a deprecation shim that forwards to the canonical
 * name and emits a one-shot `console.warn` with a clear pointer
 * to the replacement.
 *
 * This module owns the JS side of those shims. The PHP side is
 * `includes/deprecated.php` (added in phase 6).
 */

const warned = new Set< string >();

/**
 * Install a deprecation alias on `wp.os.<oldName>` that
 * forwards to `wp.os.<newName>`.
 *
 * The alias is a function that, on first call only, prints a
 * `console.warn` pointing at the replacement. Subsequent calls
 * forward silently. The `wp.os` object is read each call so
 * the canonical method stays live even if late code reassigns
 * the slot.
 *
 * @param target  The `wp.os` namespace object.
 * @param oldName Property to install the deprecated alias under.
 * @param newName Canonical property name to forward to.
 * @param hint    Optional extra hint shown after the rename
 *                pointer (e.g. `"will be removed in 2.0"`).
 */
export function installDeprecatedAlias(
	target: Record< string, unknown >,
	oldName: string,
	newName: string,
	hint?: string,
): void {
	const warnKey = `wp.os.${ oldName }→${ newName }`;
	target[ oldName ] = function deprecatedShim( ...args: unknown[] ) {
		if ( ! warned.has( warnKey ) ) {
			warned.add( warnKey );
			if ( typeof console !== 'undefined' ) {
				console.warn(
					`[openstation] wp.os.${ oldName }() is deprecated; use wp.os.${ newName }() instead.${
						hint ? ' ' + hint : ''
					}`,
				);
			}
		}
		const fn = ( target as Record< string, unknown > )[ newName ];
		if ( typeof fn !== 'function' ) {
			throw new TypeError(
				`[openstation] wp.os.${ newName } is not available; cannot forward from deprecated alias "${ oldName }".`,
			);
		}
		return ( fn as ( ...a: unknown[] ) => unknown ).apply( target, args );
	};
}

/**
 * Test-only: clear the one-shot warning memo so a test can
 * exercise the warn-once branch repeatedly.
 *
 * @internal
 */
export function _resetDeprecationWarningsForTests(): void {
	warned.clear();
}
