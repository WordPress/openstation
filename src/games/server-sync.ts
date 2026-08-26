/**
 * Server-driven games registry sync.
 *
 * Fourth take on the pattern established by native windows, widgets
 * and wallpapers — with one deliberate deviation: game scripts are
 * NOT loaded on sync. The server payload's metadata (title, icon,
 * description, score columns, config, script URL) is registered as a
 * STUB straight away, which is all the Games window's launcher grid
 * and the scoreboard tabs need to paint; the script itself is
 * fetched lazily by `launchGame()` the first time someone plays.
 * Games are heavyweight (a game bundle + PixiJS + a dictionary) and
 * most sessions never open one — eager loading would tax every boot
 * for nothing.
 *
 * Removal mirrors the wallpaper sync: a game whose plugin
 * deactivates leaves the payload, so its entry is unregistered and
 * every launcher grid / scoreboard tab list repaints via the
 * registry subscription.
 */

import * as registry from './registry';
import type { DesktopGameServerEntry } from '../types';
import type { GameRegistryEntry } from './types';

/** Map a server payload entry onto a registry stub. */
export function stubFromServerEntry(
	entry: DesktopGameServerEntry,
): GameRegistryEntry {
	return {
		id: entry.id,
		title: entry.title,
		icon: entry.icon,
		description: entry.description || undefined,
		scoreColumns: Array.isArray( entry.scoreColumns )
			? entry.scoreColumns
			: [],
		config: entry.config ?? {},
		scriptUrl: entry.scriptUrl,
		scriptTranslations: entry.scriptTranslations,
		scriptL10n: entry.scriptL10n,
		scriptBefore: entry.scriptBefore,
		scriptAfter: entry.scriptAfter,
	};
}

export function createGamesRegistrySync(): (
	list: DesktopGameServerEntry[],
) => Promise< void > {
	const registered = new Set< string >();

	const registerEntry = ( entry: DesktopGameServerEntry ): void => {
		try {
			const existing = registry.get( entry.id );
			const stub = stubFromServerEntry( entry );
			// A re-sync must not downgrade a full def back to a stub:
			// once the script has loaded and contributed its render
			// callback, keep it while refreshing the server metadata.
			registry.register(
				existing && typeof existing.render === 'function'
					? { ...stub, render: existing.render, window: existing.window }
					: stub,
			);
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Server game "${ entry.id }" failed to register:`,
					err,
				);
			}
			return;
		}
		registered.add( entry.id );
	};

	const unregisterEntry = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		registry.unregister( id );
		registered.delete( id );
	};

	return async ( list ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			if ( entry && typeof entry.id === 'string' && entry.id !== '' ) {
				incoming.add( entry.id );
			}
		}

		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterEntry( id );
			}
		}

		for ( const entry of list ) {
			if ( incoming.has( entry.id ) ) {
				registerEntry( entry );
			}
		}
	};
}
