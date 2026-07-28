/**
 * Server-driven custom-chrome sync.
 *
 * Same shape as themes / controls / slots server-syncs. Marked
 * Experimental — chrome render contract may change.
 */

import { doAction, HOOKS } from '../../hooks';
import { loadVendorScript } from '../../wallpapers/vendor-loader';
import {
	listWindowChromes,
	unregisterWindowChrome,
	unregisterWindowChromesByOwner,
} from './registry';
import type {
	DesktopWindowChromeScriptServerEntry,
	DesktopWindowChromeServerEntry,
} from '../../types';

export function createWindowChromeRegistrySync(): (
	scripts: DesktopWindowChromeScriptServerEntry[],
	chromes?: DesktopWindowChromeServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	let prevIdsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopWindowChromeScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-chrome-script-load',
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
		chromes: DesktopWindowChromeServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! chromes ) {
			return map;
		}
		for ( const entry of chromes ) {
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
		for ( const def of listWindowChromes() ) {
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

	return async ( scripts, chromes ) => {
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
			for ( const id of collectIdsToRemove( handle ) ) {
				unregisterWindowChrome( id );
			}
			unregisterWindowChromesByOwner( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( chromes );
	};
}
