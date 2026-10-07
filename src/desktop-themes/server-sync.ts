import { applyDesktopTheme } from './apply';
import { getStore, setDesktopThemes } from './registry';

export interface DesktopThemeSyncDeps {

	deactivate?: () => void;
}

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
