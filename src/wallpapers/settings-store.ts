import { doAction, HOOKS } from '../hooks';
import { createSharedStore } from '../shared-store';

export type WallpaperSettings = Record< string, string | number | boolean >;

interface WallpaperSettingsStore {
	values: Record< string, WallpaperSettings >;
}

const store = createSharedStore< WallpaperSettingsStore >(
	'desktop-mode/wallpaper-settings',
	() => ( { values: {} } ),
);

export function getWallpaperSettings( id: string ): WallpaperSettings {
	return { ...( store.state.values[ id ] ?? {} ) };
}

export function seedWallpaperSettings(
	all: Record< string, WallpaperSettings >,
): void {
	const values = store.state.values;
	for ( const key of Object.keys( values ) ) {
		delete values[ key ];
	}
	for ( const [ id, settings ] of Object.entries( all ) ) {
		values[ id ] = { ...settings };
	}
}

export function publishWallpaperSettings(
	id: string,
	settings: WallpaperSettings,
): void {
	store.state.values[ id ] = { ...settings };
	doAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, {
		id,
		settings: { ...settings },
	} );
}
