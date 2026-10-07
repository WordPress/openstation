import { createSharedStore } from './shared-store';

export type DestructiveAdminActionPredicate = (
	url: string,
	parsed: URL,
) => boolean;

export interface DestructiveAdminActionEntry {

	id: string;

	matches: DestructiveAdminActionPredicate;
}

interface RegistryState {
	entries: DestructiveAdminActionEntry[];
}

const store = createSharedStore< RegistryState >(
	'desktop-mode/destructive-admin-actions',
	() => ( { entries: [] } ),
);

export function registerDestructiveAdminAction(
	entry: DestructiveAdminActionEntry,
): () => void {
	if ( ! entry || typeof entry.id !== 'string' || entry.id.trim() === '' ) {
		return () => {};
	}
	if ( typeof entry.matches !== 'function' ) {
		return () => {};
	}

	const entries = store.state.entries;
	const idx = entries.findIndex( ( e ) => e.id === entry.id );
	if ( idx >= 0 ) {
		entries.splice( idx, 1 );
	}
	entries.push( entry );

	return () => unregisterDestructiveAdminAction( entry.id );
}

export function unregisterDestructiveAdminAction( id: string ): void {
	const entries = store.state.entries;
	const idx = entries.findIndex( ( e ) => e.id === id );
	if ( idx >= 0 ) {
		entries.splice( idx, 1 );
	}
}

export function listDestructiveAdminActions(): DestructiveAdminActionEntry[] {
	return store.state.entries.slice();
}

export function matchDestructiveAdminAction(
	url: string,
	parsed: URL,
): string | null {
	for ( const entry of store.state.entries ) {
		try {
			if ( entry.matches( url, parsed ) ) {
				return entry.id;
			}
		} catch ( err ) {
			console.warn(
				`[openstation] destructive-action predicate threw for "${ entry.id }":`,
				err,
			);
		}
	}
	return null;
}

export function _resetDestructiveAdminActionsForTests(): void {
	store.state.entries.length = 0;
}
