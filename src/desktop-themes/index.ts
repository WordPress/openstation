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
