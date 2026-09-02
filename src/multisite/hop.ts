/**
 * The hop: cross-admin navigation in the CURRENT tab.
 *
 * On a network every site is its own OpenStation, and each admin keeps
 * its own desktops under its own session key, so navigating between
 * the network admin's shell and a site's restores each instance exactly
 * as it was left — hopping IS switching instance, spelled as a
 * navigation. The shell's stylesheet opts both documents into a
 * cross-document view transition (see the instance-hop block in
 * `assets/css/desktop.css`), so on supporting browsers the two desktops
 * crossfade instead of hard-cutting; elsewhere it is a plain
 * navigation. The site switcher in overview (`site-switcher.ts`) and
 * every cross-admin link take this same hop.
 *
 * A modifier click (cmd/ctrl/shift) or a middle click keeps the
 * browser-tab behavior — the universal "open elsewhere" gesture, and
 * the way to stand two desktops side by side.
 *
 * The raw admin URL is the right target on purpose: the `admin_init`
 * redirect routes it to the matching shell screen with the URL as the
 * boot target, exactly as if it had been typed. See docs/multisite.md.
 */

/** Whether a click asked for the browser-tab behavior instead. */
export function wantsBrowserTab( event?: MouseEvent ): boolean {
	return (
		!! event &&
		( event.metaKey || event.ctrlKey || event.shiftKey || 1 === event.button )
	);
}

/** Navigate this tab to another admin, or a new tab on a modifier click. */
export function hopToAdmin( url: string, event?: MouseEvent ): void {
	if ( wantsBrowserTab( event ) ) {
		window.open( url, '_blank', 'noopener,noreferrer' );
		return;
	}
	window.location.assign( url );
}
