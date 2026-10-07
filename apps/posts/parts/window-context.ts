import { sprintf, type ViewContext } from '@openstation/app';
import type { OsTable } from '../../../src/ui/components/os-table/os-table';
import { HOOK_ACTION_DATA_LOADED } from './columns';
import type { BulkAction, ListData, ListState, PostListItem, PostsListParams, PostsWindowContext } from './types';

export type Ctx = ViewContext< ListState, ListData >;

const LOG = '[openstation:desktop-mode-posts]';

export const tableOf = ( ctx: Ctx ): OsTable< PostListItem > | null =>
	ctx.root.querySelector< OsTable< PostListItem > >( '[data-os-posts-table]' );

function currentParams( state: ListState ): PostsListParams {
	return {
		page: state.page,
		perPage: state.perPage,
		search: state.search || undefined,
		status: state.status || undefined,
		orderby: state.orderby,
		order: state.order,
		author: state.author.length > 0 ? state.author : undefined,
		tag: state.tag.length > 0 ? state.tag : undefined,
	};
}

export function postsContext( ctx: Ctx, cache: { postsCtx: PostsWindowContext | null } ): PostsWindowContext {
	if ( ! cache.postsCtx ) {
		const context: PostsWindowContext = {
			body: ctx.root,
			get table() {
				return tableOf( ctx ) as OsTable< PostListItem >;
			},
			refresh: () => ctx.dispatch( 'refresh' ).then( () => undefined ),
			getSelectedIds: () => Array.from( tableOf( ctx )?.selection ?? [] ).map( ( id ) => Number( id ) ),
			getSelectedRows: () => {
				const ids = new Set( context.getSelectedIds() );
				return ( tableOf( ctx )?.data ?? [] ).filter( ( r ) => ids.has( r.id ) );
			},
			getCurrentParams: () => currentParams( ctx.state ),
		};
		cache.postsCtx = context;
	}
	return cache.postsCtx;
}

export async function runBulkAction( ctx: Ctx, action: BulkAction, postsCtx: PostsWindowContext ): Promise< void > {
	const ids = postsCtx.getSelectedIds();
	if ( ids.length === 0 ) {
		return;
	}
	const { confirm } = action;
	if ( confirm ) {
		const message =
			typeof confirm === 'function'
				? confirm( ids.length )
				: sprintf(

					confirm,
					ids.length,
				);
		const ok = await ( ctx.host.confirm?.( { message, danger: true } ) ?? Promise.resolve( false ) );
		if ( ! ok ) {
			return;
		}
	}
	try {
		if ( ( await action.run( ids, postsCtx ) ) === false ) {
			return;
		}
	} catch ( err ) {
		console.error( `${ LOG } bulk action "${ action.id }" failed`, err );
	}
	postsCtx.table.clearSelection();
	await postsCtx.refresh();
}

export function fireDataLoaded( data: ListData ): void {
	const detail = {
		items: data.list.items,
		total: data.list.total,
		totalPages: data.list.pages,
		page: data.list.page,
	};
	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( HOOK_ACTION_DATA_LOADED, detail );
	}
	document.dispatchEvent( new CustomEvent( 'os-posts-window-data-loaded', { detail } ) );
}
