import { __, sprintf } from '@openstation/app';
import { beginTrashChange, trashChanges, trashItem, watchTrashChanges } from '../../../src/desktop-files/trash-optimistic';
import { listKey, sectionOf } from './helpers';
import { uiOf, type Ctx, type ListItem, type SectionDef } from './types';

const previewScope = ( ctx: Ctx ): string => JSON.stringify( [
	ctx.state.group, ctx.state.section, ctx.state.query, ctx.state.into, ctx.state.relation, ctx.state.footprint,
] );

export function previewContext( ctx: Ctx ): Ctx {
	const projected = Object.create( ctx ) as Ctx;
	Object.defineProperty( projected, 'state', { get: () => {
		const ui = uiOf( ctx );
		return ui.previewLoading && ui.previewScope === previewScope( ctx )
			? { ...ctx.state, item: ui.previewTarget }
			: ctx.state;
	} } );
	return projected;
}

export function previewDetail( ctx: Ctx ) {
	ctx = previewContext( ctx );
	const detail = ctx.data.detail;
	const section = sectionOf( ctx.data, ctx.state.section );
	return detail?.id === ctx.state.item && detail.kind === section?.kind ? detail : null;
}

export function previewMessage( ctx: Ctx ): string {
	const ui = uiOf( ctx );
	if ( ui.previewError ) {
		return __( 'Could not load details.' );
	}
	return ui.previewLoading ? __( 'Loading details…' ) : __( 'Details are not available for this item.' );
}

export function openPreview( ctx: Ctx, item: number ): void {
	const ui = uiOf( ctx );
	const loading = ui.previewLoading;
	ui.previewTarget = item;
	ui.previewScope = previewScope( ctx );
	ui.previewError = false;
	ui.previewRevision++;
	ui.previewLoading = loading || item > 0;
	ctx.local( 'preview', { item } );
	if ( loading || item === 0 ) {
		return;
	}
	ui.previewLoading = true;
	void ( async () => {
		try {
			let revision: number;
			do {
				revision = ui.previewRevision;
				const target = ui.previewTarget;
				const scope = ui.previewScope;
				const ok = await ctx.dispatch( 'open', { item: target } );
				if ( scope !== previewScope( ctx ) ) {
					if ( revision !== ui.previewRevision && ui.previewScope === previewScope( ctx ) ) {
						continue;
					}
					break;
				}

				ctx.local( 'preview', { item: ui.previewTarget } );
				if ( revision === ui.previewRevision ) {
					ui.previewError = ! ok;
				}
			} while ( revision !== ui.previewRevision && ui.previewTarget > 0 );
		} catch {
			ui.previewError = true;
		} finally {
			ui.previewLoading = false;
			ctx.repaint();
		}
	} )();
}

export function visibleExplorerItems( ctx: Ctx, section: SectionDef, items: ListItem[] ): ListItem[] {
	const ui = uiOf( ctx );
	const key = listKey( ctx.state );
	const hidden = ui.trashHidden.get( key ) ?? new Set< number >();

	if ( ui.trashPage !== ctx.data.list ) {
		ui.trashPage = ctx.data.list;
		for ( const row of ctx.data.list?.items ?? [] ) {
			if ( ! explorerItemTrashing( section, row.id ) ) {
				hidden.delete( row.id );
			}
		}
	}
	const pending = new Set( trashChanges().filter( ( change ) => change.direction === 'in' &&
		change.item.type === section.post_type ).map( ( change ) => change.item.id ) );
	return items.filter( ( item ) => ! hidden.has( item.id ) && ! pending.has( item.id ) );
}

export function explorerItemTrashing( section: SectionDef, id: number ): boolean {
	return trashChanges().some( ( change ) => change.direction === 'in' &&
		change.item.type === section.post_type && change.item.id === id );
}

export function watchExplorerTrash( ctx: Ctx ): () => void {
	let refreshing: Promise< unknown > | null = null;
	return watchTrashChanges( () => ctx.repaint(), () => {
		refreshing ??= Promise.resolve().then( async () => {
			refreshing = null;
			const ok = await ctx.dispatch( 'refresh' );
			if ( ok ) {
				const ui = uiOf( ctx );
				const section = sectionOf( ctx.data, ctx.state.section );
				const key = listKey( ctx.state );
				const hidden = ui.trashHidden.get( key ) ?? new Set< number >();
				for ( const change of trashChanges() ) {
					if ( change.direction === 'in' && ! change.pending && change.item.type === section?.post_type &&
						! ctx.data.list?.items.some( ( row ) => row.id === change.item.id ) ) {
						hidden.add( change.item.id );
					}
				}
				ui.trashHidden.set( key, hidden );
				const removed = trashChanges().filter( ( change ) => ! change.pending && change.direction === 'in' && change.item.type === section?.post_type ).map( ( change ) => change.item.id );
				ctx.local( 'select-set', { ids: ctx.state.selected.filter( ( id ) => ! removed.includes( id ) ) } );
				if ( removed.includes( ctx.state.item ) ) {
					openPreview( ctx, 0 );
				}
			}
		} );
		return refreshing;
	} );
}

export async function trashExplorerItems( ctx: Ctx, section: SectionDef, rows: ListItem[] ): Promise< void > {
	if ( rows.length === 0 ) {
		return;
	}
	const confirmed = await ctx.host.confirm?.( {
		message: rows.length > 1
			? sprintf( __( 'Move %d items to the Trash?' ), rows.length )
			: __( 'Move this to the Trash?' ),
		confirmLabel: __( 'Trash' ), danger: true,
	} );
	if ( ! confirmed ) {
		return;
	}
	const operations = rows.flatMap( ( row ) => {
		const operation = beginTrashChange( trashItem( {
			id: row.id, type: section.post_type ?? 'post', title: row.title,
			subtitle: row.subtitle, preview: row.thumb,
		} ) );
		return operation ? [ { row, operation } ] : [];
	} );
	if ( operations.length === 0 ) {
		return;
	}

	if ( ! section.restPath ) {
		let ok = false;
		try {
			if ( operations.length === 1 ) {
				ok = await ctx.dispatch( 'trash', { item: operations[ 0 ].row.id } );
			} else {
				ctx.local( 'select-set', { ids: operations.map( ( { row } ) => row.id ) } );
				ok = await ctx.dispatch( 'bulk-trash' );
			}
		} finally {
			operations.forEach( ( { operation } ) => void operation.finish( ok ) );
		}
		return;
	}
	const results = await Promise.allSettled( operations.map( async ( { row } ) => {
		const response = await ctx.fetch( `${ section.restPath!.replace( /\/+$/, '' ) }/${ row.id }`, { method: 'DELETE' } );
		if ( ! response.ok ) {
			throw new Error( __( 'Could not move this item to Trash.' ) );
		}
	} ) );
	const ids = operations.filter( ( _, index ) => results[ index ].status === 'fulfilled' ).map( ( { row } ) => row.id );
	if ( ids.length > 0 ) {
		ctx.host.announce?.( section.post_type ?? 'post', 'trashed', ids );
		ctx.local( 'select-set', { ids: ctx.state.selected.filter( ( id ) => ! ids.includes( id ) ) } );
		if ( ids.includes( ctx.state.item ) ) {
			openPreview( ctx, 0 );
		}
	}
	results.forEach( ( result, index ) => {
		void operations[ index ].operation.finish( result.status === 'fulfilled' );
	} );
	const failed = results.length - ids.length;
	ctx.host.toast?.( {
		message: failed > 0
			? sprintf( __( '%d item(s) could not be moved to Trash.' ), failed )
			: sprintf( __( 'Moved %d item(s) to the Trash.' ), ids.length ),
	} );
}
