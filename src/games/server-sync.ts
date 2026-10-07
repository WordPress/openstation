import * as registry from './registry';
import type { DesktopGameServerEntry } from '../types';
import type { GameRegistryEntry } from './types';

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

		window:
			entry.window && Object.keys( entry.window ).length > 0
				? entry.window
				: undefined,
		scriptUrl: entry.scriptUrl,
		scriptTranslations: entry.scriptTranslations,
		scriptL10n: entry.scriptL10n,
		scriptBefore: entry.scriptBefore,
		scriptAfter: entry.scriptAfter,
		scriptDeps: entry.scriptDeps,
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
