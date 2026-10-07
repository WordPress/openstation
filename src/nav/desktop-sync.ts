import { filesApi } from '../desktop-files';
import { addAction, removeAction, HOOKS } from '../hooks';
import type { RestPlacementShape } from '../desktop-files/rest';
import type { NavItem } from './types';

const SYNTH_META_KEY = '__synthFromDockItem';

function hashToNegativeId( s: string ): number {
	let h = 0;
	for ( let i = 0; i < s.length; i++ ) {
		h = ( h * 31 + s.charCodeAt( i ) ) % 0x7fffffff;
	}
	return -( h + 1 );
}

function buildSyntheticPlacement(
	item: NavItem,
	persistedPositions: Record< string, { x: number; y: number } >,
): RestPlacementShape {
	const isTile = !! item.tile;

	const saved = persistedPositions[ item.id ];
	return {
		id: hashToNegativeId( item.id ),
		parentId: 0,
		x: saved ? saved.x : 0,
		y: saved ? saved.y : 0,
		sortOrder: 9999,
		updatedAtMs: Date.now(),
		meta: { [ SYNTH_META_KEY ]: item.id },
		file: {
			type: 'shortcut',
			ref: isTile ? item.id : `dock-promoted:${ item.id }`,
			title: item.title,
			icon: item.icon,
			previewUrl: '',
			exists: true,
			...( isTile
				? { shortcutSystemTile: item.id }
				: { shortcutUrl: item.menu?.url ?? '' } ),
		},
	} as RestPlacementShape;
}

let reentrant = false;

const removedServerPlacementsByRef = new Map< string, RestPlacementShape >();

function prunePromotedPositions( ids: string[] ): void {
	const api = (
		window as unknown as {
			wp?: {
				os?: {
					getOsSettings?: () => {
						dockPromotedPositions?: Record<
							string,
							{ x: number; y: number }
						>;
					};
					updateOsSettings?: ( patch: {
						dockPromotedPositions?: Record<
							string,
							{ x: number; y: number }
						>;
					} ) => void;
				};
			};
		}
	).wp?.os;
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const current = api.getOsSettings().dockPromotedPositions ?? {};
	const next: Record< string, { x: number; y: number } > = { ...current };
	let changed = false;
	for ( const id of ids ) {
		if ( id in next ) {
			delete next[ id ];
			changed = true;
		}
	}
	if ( changed ) {
		api.updateOsSettings( { dockPromotedPositions: next } );
	}
}

export function syncDesktopShortcuts(
	desktop: readonly NavItem[],
	allItems: readonly NavItem[],
	positions: Record< string, { x: number; y: number } > = {},
): void {
	if ( reentrant ) {
		return;
	}
	reentrant = true;
	try {
		const state = filesApi.store.getState();
		const root = state.placementsByFolder.get( 0 ) ?? [];
		const wanted = new Set( desktop.map( ( item ) => item.id ) );

		const currentSynth = new Map< string, RestPlacementShape >();
		for ( const p of root ) {
			const sourceId =
				p.meta && typeof p.meta === 'object'
					? ( p.meta as Record< string, unknown > )[ SYNTH_META_KEY ]
					: null;
			if ( typeof sourceId === 'string' ) {
				currentSynth.set( sourceId, p );
			}
		}

		const registeredIconIds = new Set< string >();
		for ( const item of allItems ) {
			if ( item.entry ) {
				registeredIconIds.add( item.entry.id );
			}
		}
		const realByRef = new Map< string, RestPlacementShape >();
		for ( const p of root ) {
			const ref = p?.file?.ref;
			if ( typeof ref === 'string' && registeredIconIds.has( ref ) ) {
				realByRef.set( ref, p );
			}
		}

		for ( const item of desktop ) {
			if ( item.entry || currentSynth.has( item.id ) ) {
				continue;
			}
			filesApi.store.upsertPlacement(
				buildSyntheticPlacement( item, positions ),
			);
		}

		const positionsToPrune: string[] = [];
		for ( const [ sourceId, p ] of currentSynth ) {
			if ( wanted.has( sourceId ) ) {
				continue;
			}
			filesApi.store.removePlacement( p.id );
			if ( positions[ sourceId ] ) {
				positionsToPrune.push( sourceId );
			}
		}
		if ( positionsToPrune.length > 0 ) {
			prunePromotedPositions( positionsToPrune );
		}

		for ( const item of allItems ) {
			const entry = item.entry;
			if ( ! entry ) {
				continue;
			}
			const inStore = realByRef.get( entry.id );
			if ( ! wanted.has( item.id ) ) {
				if ( inStore ) {
					removedServerPlacementsByRef.set( entry.id, inStore );
					filesApi.store.removePlacement( inStore.id );
				}
				continue;
			}
			if ( ! inStore ) {
				const cached = removedServerPlacementsByRef.get( entry.id );
				if ( cached ) {
					filesApi.store.upsertPlacement( cached );
					removedServerPlacementsByRef.delete( entry.id );
				}
			}
		}
	} finally {
		reentrant = false;
	}
}

export function installShortcutsSync( sync: () => void ): () => void {
	queueMicrotask( sync );

	const off = filesApi.store.subscribe( sync );

	const namespace = 'desktop-mode/shortcuts-sync';
	addAction( HOOKS.DOCK_ITEM_APPENDED, namespace, sync );

	return () => {
		off();
		removeAction( HOOKS.DOCK_ITEM_APPENDED, namespace );
	};
}
