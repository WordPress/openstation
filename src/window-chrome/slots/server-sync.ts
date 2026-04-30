/**
 * Server-driven window-slot sync.
 *
 * Same shape as themes / controls server-syncs.
 *
 * @since 0.6.0
 */

import { doAction, HOOKS } from '../../hooks';
import { loadVendorScript } from '../../wallpapers/vendor-loader';
import {
	listWindowSlots,
	unregisterWindowSlot,
	unregisterWindowSlotsByOwner,
} from './registry';
import type {
	DesktopWindowSlotScriptServerEntry,
	DesktopWindowSlotServerEntry,
} from '../../types';

export function createWindowSlotRegistrySync(): (
	scripts: DesktopWindowSlotScriptServerEntry[],
	slots?: DesktopWindowSlotServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	let prevIdsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopWindowSlotScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-slot-script-load',
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
		slots: DesktopWindowSlotServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! slots ) {
			return map;
		}
		for ( const entry of slots ) {
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
		for ( const def of listWindowSlots() ) {
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

	return async ( scripts, slots ) => {
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
				unregisterWindowSlot( id );
			}
			unregisterWindowSlotsByOwner( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( slots );
	};
}
