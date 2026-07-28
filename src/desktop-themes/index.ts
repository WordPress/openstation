/**
 * Desktop themes — public entry point for the module.
 *
 * A desktop theme reskins the entire shell from a ZIP of a manifest
 * plus images: every `--desktop-mode-*` token, the title-bar / dock
 * / desktop textures, the window frame and corners, and a complete
 * iconset down to the window control glyphs.
 *
 * Not to be confused with WINDOW themes (`src/window-chrome/themes/`),
 * which restyle one window's chrome. See docs/desktop-themes.md.
 */

export { applyDesktopTheme, DESKTOP_THEME_CHANGED_EVENT } from './apply';
export type { DesktopThemeChangedDetail } from './apply';
export { resolveThemedIcon } from './icons';
export {
	RECOMMENDED_OS_SETTINGS_KEYS,
	resolveRecommendedOsSettings,
	sanitizeRecommendedOsSettings,
} from './recommended';
export {
	getActiveDesktopThemeId,
	getDesktopTheme,
	listDesktopThemes,
	removeDesktopTheme,
	subscribeDesktopThemes,
	upsertDesktopTheme,
} from './registry';
export { createDesktopThemeSync } from './server-sync';
export {
	DESKTOP_THEME_SLOTS,
	slotForFileType,
	slotForTileId,
	slotForWindowControl,
} from './slots';
export type { DesktopThemeSlot } from './slots';
export type {
	DesktopThemeEntry,
	DesktopThemeState,
	RecommendedOsSettings,
} from './types';
