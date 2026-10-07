import { doAction, HOOKS } from './../hooks';
import * as registry from './registry';
import { buildStub, clearPending, hydrate, setPending } from './lazy';
import type { OsSettings } from '../settings';
import type { DesktopWallpaperServerEntry } from '../types';
import type { WallpaperDef } from './types';

export interface WallpaperRegistrySyncDeps {
	osSettings: OsSettings;
}

export function createWallpaperRegistrySync(
	deps: WallpaperRegistrySyncDeps,
): ( list: DesktopWallpaperServerEntry[] ) => Promise< void > {
	const { osSettings } = deps;

	const registered = new Set< string >();

	const defFromCssEntry = (
		entry: DesktopWallpaperServerEntry,
	): WallpaperDef | null => {
		if ( entry.type !== 'css' || entry.value === '' ) {
			return null;
		}
		return {
			id: entry.id,
			label: entry.label,
			type: 'css',
			value: entry.value,
			preview: entry.preview !== '' ? entry.preview : entry.value,
			description: entry.description || undefined,
			tone: entry.tone === 'light' || entry.tone === 'dark' ? entry.tone : undefined,
		};
	};

	const registerEntry = async (
		entry: DesktopWallpaperServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}

		const cssDef = defFromCssEntry( entry );
		if ( cssDef ) {
			registry.register( cssDef );
			registered.add( entry.id );
			osSettings.apply();
			return;
		}

		if ( ! entry.scriptUrl ) {
			return;
		}
		setPending( entry );

		const previewable = entry.preview !== '' || entry.value !== '';
		if ( previewable ) {
			try {
				registry.register( buildStub( entry ) );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'wallpaper-register',
					id: entry.id,
					error: err,
				} );
				clearPending( entry.id );
				return;
			}
			registered.add( entry.id );
		}

		if ( ! previewable || osSettings.state.wallpaper === entry.id ) {
			const def = await hydrate( entry.id );
			if ( ! previewable ) {
				if ( ! def ) {
					clearPending( entry.id );
					return;
				}
				registered.add( entry.id );
			}
		}

		osSettings.apply();
	};

	const unregisterEntry = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		registry.unregister( id );
		clearPending( id );
		registered.delete( id );

		osSettings.apply();
	};

	return async ( list ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
		}

		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterEntry( id );
			}
		}

		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerEntry( entry );
			}
		}
	};
}
