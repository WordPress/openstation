/** The same live choices offered by Preferences, projected for MIO. */
import { getAccents } from '../../../src/settings/constants';
import { listDesktopThemes, ensureFullDesktopThemes } from '../../../src/desktop-themes/registry';
import { listDockRailRenderers } from '../../../src/dock-rail';
import { listUnfocusEffects } from '../../../src/effects/registry';
import { listWindowReveals } from '../../../src/reveals/registry';
import { listWindowLinkRenderers } from '../../../src/window-links/renderer-registry';
import { all as listWallpapers } from '../../../src/wallpapers/registry';
import { readNavItems } from '../../../src/nav/config';

export const MIO_SETTING_CHOICES = {
	desktopLayout: [ 'unified', 'classic' ],
	dockPlacement: [ 'bottom', 'left', 'right' ],
	dockBehavior: [ 'static', 'dynamic' ],
	sideDockBehavior: [ 'static', 'dynamic' ],
	dockSize: [ 'compact', 'default', 'large' ],
	windowRadius: [ 'sharp', 'default', 'round' ],
	adminBarMode: [ 'static', 'dynamic', 'hidden' ],
	windowLinkVisibility: [ 'always', 'focus', 'off' ],
	mobileLayout: [ 'auto', 'desktop', 'mobile' ],
	heartbeatRate: [ 15, 30, 45, 60 ],
} as const;

export const MIO_BOOLEAN_SETTINGS = [
	'mioApiEnabled',
	'mioShowOnWallpaper',
	'windowLinksEnabled',
	'windowLinkRaiseOnFocus',
	'windowLinkHighlight',
	'showDesktopOnWallpaperClick',
	'showPostStatusRibbons',
	'developerModeEnabled',
	'foldersSharingEnabled',
	'stationHomeEnabled',
	'nativePostsEnabled',
	'nativePagesEnabled',
	'nativeUsersEnabled',
	'nativePluginsEnabled',
	'nativeCommentsEnabled',
	'confirmCloseAllWindows',
	'libraryHdOnly',
] as const;

export function mioSettingChoices(): Record<string, readonly ( string | number )[]> {
	return {
		...MIO_SETTING_CHOICES,
		accent: [ ...getAccents().map( ( entry ) => entry.id ), 'custom' ],
		desktopTheme: [ '', ...listDesktopThemes().map( ( entry ) => entry.slug ) ],
		wallpaper: listWallpapers().map( ( entry ) => entry.id ),
		dockRailRenderer: listDockRailRenderers().map( ( entry ) => entry.id ),
		unfocusEffect: [ 'none', ...listUnfocusEffects().map( ( entry ) => entry.id ) ],
		windowReveal: [ 'none', ...listWindowReveals().map( ( entry ) => entry.id ) ],
		windowLinkRenderer: [ 'none', ...listWindowLinkRenderers().map( ( entry ) => entry.id ) ],
	};
}

/** Matches Navigation's placement gate; locked and transient items never enter it. */
export function mioNavItems() {
	return readNavItems().filter(
		( item ) =>
			! item.locked && ! item.transient && ( item.menu || item.entry || item.tile?.placeable ),
	);
}

export function mioPinnableItems() {
	return readNavItems().filter(
		( item ) =>
			! item.locked &&
			! item.transient &&
			!! ( item.windowId || item.tile || item.menu?.url || item.entry?.url ),
	);
}

export async function mioSettingsCatalog() {
	await ensureFullDesktopThemes();
	return {
		choices: mioSettingChoices(),
		themes: [
			{
				id: '',
				name: 'OpenStation',
				description: 'Built-in dark OpenStation palette.',
				surface: '#15151e',
			},
			...listDesktopThemes().map( ( theme ) => ( {
				id: theme.slug,
				name: theme.name,
				description: theme.description,
				// Surface values are evidence for colour choices, not a guessed "dark" tag.
				surfaces: Object.fromEntries(
					Object.entries( theme.tokens )
						.filter( ( [ key ] ) => /(?:surface|bg|backstop)$/.test( key ) )
						.slice( 0, 12 ),
				),
				recommendations: theme.recommendedOsSettings,
			} ) ),
		],
		accents: getAccents(),
		wallpapers: listWallpapers().map( ( entry ) => ( {
			id: entry.id,
			label: entry.label,
			configurable: !! entry.renderConfig,
		} ) ),
		dockRenderers: listDockRailRenderers().map( ( entry ) => ( {
			id: entry.id,
			label: entry.label,
		} ) ),
		unfocusEffects: listUnfocusEffects().map( ( entry ) => ( { id: entry.id, label: entry.label } ) ),
		reveals: listWindowReveals().map( ( entry ) => ( { id: entry.id, label: entry.label } ) ),
		linkRenderers: listWindowLinkRenderers().map( ( entry ) => ( {
			id: entry.id,
			label: entry.label,
		} ) ),
		navigation: mioNavItems().map( ( entry ) => ( { id: entry.id, title: entry.title } ) ),
		phonePins: mioPinnableItems().map( ( entry ) => ( { id: entry.id, title: entry.title } ) ),
	};
}
