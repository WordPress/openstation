/**
 * OpenStation — one menu-payload refresh, for a setting that gated a
 * SERVER-side registration.
 *
 * Some settings decide what the server registers, not just how the
 * shell behaves. Developer mode gates Code Blue's native window and
 * desktop icon; the `games` extended option gates the entire games
 * module — while it is off, `includes/games/bootstrap.php` never loads,
 * so there is no Games window, no desktop icon and no `serverGames`
 * entry for the shell to have heard of.
 *
 * The shell only learns about server registrations from a menu payload.
 * A save that flips one of those gates therefore changes what a *later*
 * request would register, and changes nothing on screen — which is why
 * enabling Games appeared to do nothing until an F5.
 *
 * **The refresh has to be its own request, and that is not incidental.**
 * The games module is loaded on `plugins_loaded` from the option's
 * value, so the request that *writes* the option already decided, near
 * its own start, that games were off. It could not report the new
 * registrations even if it wanted to. The next request reads the saved
 * value, loads the module, and its payload carries the window, the icon
 * and the game list.
 *
 * Best-effort by design: `wp.os.refreshMenu` is absent before the shell
 * has booted and in classic mode, and a settings panel is not the place
 * to care. The option is saved either way; the worst case is the F5
 * this exists to remove.
 */

/**
 * Ask the shell to rebuild its registries from a fresh menu payload.
 *
 * Call after a save has actually persisted — the payload is built from
 * stored state, so firing earlier harvests the old value.
 */
export function spendMenuRefresh(): void {
	const refreshMenu = (
		window.wp as
			| { os?: { refreshMenu?: () => Promise< void > } }
			| undefined
	)?.os?.refreshMenu;
	if ( typeof refreshMenu !== 'function' ) {
		return;
	}
	try {
		void refreshMenu();
	} catch {
		// A failed refresh costs the user an F5, which is exactly
		// where they were before this call existed. Never let it take
		// down the panel that just saved successfully.
	}
}
