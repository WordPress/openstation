import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import {
	listSettingsTabs,
	unregisterSettingsTab,
	unregisterSettingsTabsByOwner,
} from './registry';
import type {
	DesktopSettingsTabScriptServerEntry,
	DesktopSettingsTabServerEntry,
} from './../types';

export function createSettingsTabRegistrySync(): (
	scripts: DesktopSettingsTabScriptServerEntry[],
	tabs?: DesktopSettingsTabServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	let prevIdsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopSettingsTabScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,

				deps: entry.scriptDeps,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'settings-tab-script-load',
				handle: entry.handle,
				url: entry.scriptUrl,
				error: err,
			} );
			return;
		}
		loadedUrls.add( entry.scriptUrl );
		loadedHandles.add( entry.handle );
	};

	const idsByHandleFrom = (
		tabs: DesktopSettingsTabServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! tabs ) {
			return map;
		}
		for ( const entry of tabs ) {
			if ( ! entry.scriptHandle || ! entry.id ) {
				continue;
			}
			let set = map.get( entry.scriptHandle );
			if ( ! set ) {
				set = new Set< string >();
				map.set( entry.scriptHandle, set );
			}
			set.add( entry.id );
		}
		return map;
	};

	const removeByHandle = ( handle: string ): void => {
		unregisterSettingsTabsByOwner( handle );

		const declared = prevIdsByHandle.get( handle );
		if ( declared ) {
			const present = new Set(
				listSettingsTabs().map( ( t ) => t.id ),
			);
			for ( const id of declared ) {
				if ( present.has( id ) ) {
					unregisterSettingsTab( id );
				}
			}
		}
	};

	return async ( scripts, tabs ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			removeByHandle( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( tabs );
	};
}
