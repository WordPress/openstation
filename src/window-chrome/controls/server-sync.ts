/**
 * Server-driven window-control sync.
 *
 * Same shape as `src/window-chrome/themes/server-sync.ts` and the
 * rest of the server-sync family. Plugins opt in server-side via
 * `openstation_register_window_control_script()`; this module loads
 * each opted-in script on activation and tears down owner-tagged
 * controls on deactivation.
 *
 * Built-in controls (`core/*`) carry no `owner` so server-sync's
 * owner-bulk teardown can never blow them away.
 */

import { doAction, HOOKS } from '../../hooks';
import { loadVendorScript } from '../../wallpapers/vendor-loader';
import {
	listWindowControls,
	unregisterWindowControl,
	unregisterWindowControlsByOwner,
} from './registry';
import type {
	DesktopWindowControlScriptServerEntry,
	DesktopWindowControlServerEntry,
} from '../../types';

export function createWindowControlRegistrySync(): (
	scripts: DesktopWindowControlScriptServerEntry[],
	controls?: DesktopWindowControlServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	let prevIdsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopWindowControlScriptServerEntry,
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
				scope: 'window-control-script-load',
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
		controls: DesktopWindowControlServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! controls ) {
			return map;
		}
		for ( const entry of controls ) {
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
		for ( const def of listWindowControls() ) {
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

	return async ( scripts, controls ) => {
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
				unregisterWindowControl( id );
			}
			unregisterWindowControlsByOwner( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( controls );
	};
}
