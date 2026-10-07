import { doAction, HOOKS } from '../../hooks';
import { loadVendorScript } from '../../wallpapers/vendor-loader';
import {
	registerWindowTheme,
	unregisterWindowTheme,
	listWindowThemes,
	unregisterWindowThemesByOwner,
} from './registry';
import type {
	DesktopWindowThemeScriptServerEntry,
	DesktopWindowThemeServerEntry,
} from '../../types';

export function createWindowThemeRegistrySync(): (
	scripts: DesktopWindowThemeScriptServerEntry[],
	themes?: DesktopWindowThemeServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	let prevIdsByHandle = new Map< string, Set< string > >();

	const shellRegistered = new Set< string >();

	const ensureScript = async (
		entry: DesktopWindowThemeScriptServerEntry,
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
				scope: 'window-theme-script-load',
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
		themes: DesktopWindowThemeServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! themes ) {
			return map;
		}
		for ( const entry of themes ) {
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

	const collectIdsToRemove = ( handle: string ): Set< string > => {
		const ids = new Set< string >();

		for ( const def of listWindowThemes() ) {
			if ( def.owner === handle ) {
				ids.add( def.id );
			}
		}

		const declared = prevIdsByHandle.get( handle );
		if ( declared ) {
			for ( const id of declared ) {
				ids.add( id );
			}
		}
		return ids;
	};

	const applyMetadata = (
		themes: DesktopWindowThemeServerEntry[] | undefined,
	): void => {
		if ( ! themes ) {
			return;
		}
		for ( const entry of themes ) {
			if ( ! entry.id || ! entry.tokens ) {
				continue;
			}

			try {
				registerWindowTheme( {
					id: entry.id,
					label: entry.label,
					tokens: entry.tokens,
					priority: entry.priority,
					match: () => true,
					owner: entry.scriptHandle || undefined,
				} );
				shellRegistered.add( entry.id );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'window-theme-shell-register',
					id: entry.id,
					error: err,
				} );
			}
		}
	};

	return async ( scripts, themes ) => {
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
			const ids = collectIdsToRemove( handle );
			for ( const id of ids ) {
				unregisterWindowTheme( id );
				shellRegistered.delete( id );
			}

			unregisterWindowThemesByOwner( handle );
			loadedHandles.delete( handle );
		}

		applyMetadata( themes );

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( themes );
	};
}
