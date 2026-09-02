/**
 * Test doubles for the Preferences app's context: the `data()`
 * payload and the config extra, as the PHP side ships them.
 */
import type { AppData, AppExtra } from '../../../apps/os-settings/parts/types';

export function appData( overrides: Partial< AppData > = {} ): AppData {
	return {
		isAdmin: true,
		canUpload: true,
		canManageDesktopThemes: true,
		extendedOptions: { media_library_enhanced: true, games: false, agents: false },
		commentsAi: null,
		aiAssistant: null,
		...overrides,
	};
}

export function appExtra( overrides: Partial< AppExtra > = {} ): AppExtra {
	return {
		mediaUrl: 'https://example.test/wp-json/wp/v2/media',
		desktopThemesUrl: 'https://example.test/wp-json/desktop-mode/v1/desktop-themes',
		aboutFeedUrl: 'https://example.test/wp-admin/admin-ajax.php?action=openstation_about_feed',
		pluginUrl: 'https://example.test/plugin',
		pluginVersion: '1.0.0',
		...overrides,
	};
}
