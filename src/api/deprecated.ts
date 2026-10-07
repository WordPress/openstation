const warned = new Set< string >();

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

export function _resetDeprecationWarningsForTests(): void {
	warned.clear();
}
