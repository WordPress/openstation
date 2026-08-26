/**
 * Games framework — the narrow `wp.os` surface game bundles read.
 *
 * Games run inside a native window and only need a handful of the
 * full `wp.os` API (see `launch.ts`'s own, wider `DesktopGlobal`
 * for the launcher's needs). Declared once here so every game's
 * `desktopGlobal()` stays in sync instead of drifting per game.
 */

export interface DesktopLike {
	loadModules?: ( ids: string[] ) => Promise< void >;
	onWindow?: (
		id: string,
		handlers: { blurred?: () => void; focused?: () => void },
	) => () => void;
	confirm?: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
	} ) => Promise< boolean >;
}

/** The live `window.wp.os`, or `{}` before the shell has booted. */
export function desktopGlobal(): DesktopLike {
	return (
		( window.wp as { os?: DesktopLike } | undefined )?.os ?? {}
	);
}
