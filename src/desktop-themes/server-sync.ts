/**
 * Server-driven desktop-theme library sync.
 *
 * The simplest of the `server-sync` family: desktop themes carry no
 * JS at all, so there is no script to load and no global to read.
 * The payload IS the definition, which makes this reconciler
 * synchronous — a deliberate difference from the wallpaper / widget
 * / command syncs it is otherwise modelled on.
 *
 * One behaviour worth stating: when the ACTIVE theme disappears from
 * the payload (someone deleted it, or a plugin that registered it
 * deactivated), we deactivate locally but do NOT save. The server
 * already treats an orphaned selection as the system default on
 * every request, so writing the reset back would be a redundant
 * round-trip — and worse, it would clobber the user's selection
 * permanently if the theme were merely temporarily absent.
 *
 * @since 0.9.7
 */

import { applyDesktopTheme } from './apply';
import { getStore, setDesktopThemes } from './registry';

/** Dependencies. Empty today; kept for symmetry + future growth. */
export interface DesktopThemeSyncDeps {
	/**
	 * Optional override for the deactivation call, so tests can
	 * observe it without touching the DOM.
	 */
	deactivate?: () => void;
}

/**
 * Build the reconciler the live-refresh applier calls.
 *
 * @since 0.9.7
 *
 * @param deps See {@link DesktopThemeSyncDeps}.
 * @return `( list ) => void`
 */
export function createDesktopThemeSync(
	deps: DesktopThemeSyncDeps = {},
): ( list: readonly unknown[] ) => void {
	const deactivate = deps.deactivate ?? ( () => applyDesktopTheme( '' ) );

	return function syncDesktopThemes( list ): void {
		setDesktopThemes( Array.isArray( list ) ? list : [] );

		const { activeId, themes } = getStore().getState();
		if ( activeId === null ) {
			return;
		}
		if ( ! themes.some( ( theme ) => theme.slug === activeId ) ) {
			deactivate();
		}
	};
}
