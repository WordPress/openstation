/**
 * mio-js — `@wordpress/hooks` stand-in.
 *
 * `src/mio/mio.ts` announces every lifecycle moment through
 * `doAction( 'os.mio.*' )`, which in the shell lands on
 * `window.wp.hooks` and throws if it isn't there. A blog has no
 * `wp.hooks`, and shipping one just so a mascot can announce itself
 * would be most of this library's weight.
 *
 * So the build aliases `../hooks` to this file (see
 * `vite.config.js`), and the actions come out as DOM CustomEvents
 * instead — `os.mio.grabbed` → `mio:grabbed` on `document`. Same
 * information, no dependency, and a page can listen for it with
 * nothing but `addEventListener`.
 *
 * Only `doAction` is reachable from the mounted runtime; the rest of
 * the module's surface is here so the shim can stand in for the real
 * one without the import failing to resolve a name.
 */

/** Prefix of every action Mio fires. */
const NAMESPACE = 'os.mio.';

/**
 * Re-broadcast an action as a DOM event.
 *
 * `os.mio.dropped` becomes `mio:dropped`, and the action's first
 * argument (always a plain object in Mio's case) becomes the event's
 * `detail`. Anything outside the `os.mio.` namespace is dropped —
 * nothing else in this bundle fires, and a stray hook name should not
 * turn into a global event.
 */
export function doAction< TArgs extends unknown[] = unknown[] >(
	hookName: string,
	...args: TArgs
): void {
	if ( ! hookName.startsWith( NAMESPACE ) ) {
		return;
	}
	const name = `mio:${ hookName.slice( NAMESPACE.length ) }`;
	try {
		document.dispatchEvent(
			new CustomEvent( name, { detail: args[ 0 ] ?? {} } ),
		);
	} catch {
		/* Pre-DOM or a locked-down document — an event nobody hears. */
	}
}

/** Unused by the runtime; present so the shim mirrors the module. */
export function applyFilters< TValue >(
	_hookName: string,
	value: TValue,
): TValue {
	return value;
}

/** Unused by the runtime; present so the shim mirrors the module. */
export function addAction(): void {
	/* No bus to add to. */
}

/** Unused by the runtime; present so the shim mirrors the module. */
export function addFilter(): void {
	/* No bus to add to. */
}

/** Unused by the runtime; present so the shim mirrors the module. */
export const HOOKS: Record< string, string > = {};
