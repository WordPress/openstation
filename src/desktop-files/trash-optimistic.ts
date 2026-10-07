import { createSharedStore } from '../shared-store';
import type { RecycleBinItem } from '../../apps/trash/parts/types';
import type { RestPlacementShape } from './rest';

export interface TrashChange {
	item: RecycleBinItem;
	direction: 'in' | 'out';
	pending: boolean;
}

const store = createSharedStore( 'openstation/trash-optimistic', () => ( {
	changes: new Map< string, TrashChange >(),
	reconcile: new Set<() => Promise< unknown > >(),
} ) );

export const trashKey = ( item: { type: string; id: number } ): string => `${ item.type }:${ item.id }`;

export function trashItem( facts: Pick< RecycleBinItem, 'id' | 'type' | 'title' > & Partial< RecycleBinItem > ): RecycleBinItem {
	return {
		subtitle: '', mime: '', preview: '', icon: '',
		deleted_at: new Date().toISOString(), deleted_by: '', deleted_by_id: 0,
		can_restore: false, can_purge: false, edit_link: '',
		...facts,
	};
}

export function placementTrashItem( placement: RestPlacementShape ): RecycleBinItem {
	const file = placement.file;
	const type = file.type === 'shortcut' ? 'shortcut' : 'placement';
	return trashItem( {
		id: file.type === 'folder' ? Number( file.ref ) : placement.id,
		type: file.type === 'folder' ? 'folder' : type,
		title: file.title,
		icon: file.icon,
		preview: file.previewUrl,
	} );
}

export function trashChanges(): TrashChange[] {
	return Array.from( store.state.changes.values() );
}

export function watchTrashChanges( repaint: () => void, reconcile?: () => Promise< unknown > ): () => void {
	const unsubscribe = store.subscribe( repaint );
	if ( reconcile ) {
		store.state.reconcile.add( reconcile );
	}
	return () => {
		unsubscribe();
		if ( reconcile ) {
			store.state.reconcile.delete( reconcile );
		}
	};
}

export function beginTrashChange( item: RecycleBinItem, direction: 'in' | 'out' = 'in' ): { finish: ( ok: boolean ) => Promise< void > } | null {
	const key = trashKey( item );
	if ( store.state.changes.get( key )?.pending ) {
		return null;
	}
	const change: TrashChange = { item, direction, pending: true };
	store.state.changes.set( key, change );
	store.notify();
	return {
		async finish( ok ) {
			if ( store.state.changes.get( key ) !== change || ! change.pending ) {
				return;
			}
			change.pending = false;
			if ( ok ) {
				store.notify();
				await Promise.allSettled( Array.from( store.state.reconcile, async ( refresh ) => refresh() ) );
			}
			if ( store.state.changes.get( key ) === change ) {
				store.state.changes.delete( key );
				store.notify();
			}
		},
	};
}

export function projectTrash( items: RecycleBinItem[], total: number, filter = '', search = '' ): { items: RecycleBinItem[]; total: number } {
	const rows = new Map( items.map( ( item ) => [ trashKey( item ), item ] ) );
	let count = total;
	for ( const { item, direction } of trashChanges() ) {
		const key = trashKey( item );
		if ( direction === 'out' ) {
			if ( rows.delete( key ) ) {
				count--;
			}
			continue;
		}
		const matches = ( ! filter || filter === item.type ||
			( filter === 'desktop' && [ 'placement', 'shortcut', 'folder' ].includes( item.type ) ) ) &&
			( ! search || `${ item.title } ${ item.subtitle }`.toLocaleLowerCase().includes( search.toLocaleLowerCase() ) );
		if ( ! rows.has( key ) ) {
			count++;
		}
		if ( matches ) {
			rows.set( key, { ...( rows.get( key ) ?? item ), can_restore: false, can_purge: false } );
		}
	}
	return { items: Array.from( rows.values() ), total: Math.max( 0, count ) };
}
