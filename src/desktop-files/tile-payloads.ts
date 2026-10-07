import { createSharedStore } from '../shared-store';
import type { DragPayload, DragSession } from '../drag';
import type { RestPlacementShape } from './rest';

export interface TilePayloadContext {

	placement: RestPlacementShape;
}

export interface TilePayloadHandler {

	appliesTo( ctx: TilePayloadContext ): boolean;

	accept( data: Record< string, unknown >, ctx: TilePayloadContext ): boolean;

	acceptLabel: string;
	onDrop(
		session: DragSession,
		ev: { clientX: number; clientY: number },
		ctx: TilePayloadContext,
	): void;
}

const store = createSharedStore< {
	handlers: Map< string, TilePayloadHandler[] >;
} >( 'desktop-mode/tile-payload-handlers', () => ( {
	handlers: new Map(),
} ) );

function handlerMap(): Map< string, TilePayloadHandler[] > {
	return store.state.handlers;
}

export function registerTilePayloadHandler(
	type: string,
	handler: TilePayloadHandler,
): () => void {
	const list = handlerMap().get( type );
	if ( list ) {
		list.push( handler );
	} else {
		handlerMap().set( type, [ handler ] );
	}
	return () => {
		const current = handlerMap().get( type );
		if ( ! current ) {
			return;
		}
		const at = current.indexOf( handler );
		if ( at !== -1 ) {
			current.splice( at, 1 );
		}
		if ( current.length === 0 ) {
			handlerMap().delete( type );
		}
	};
}

function resolveTileHandler(
	type: string,
	ctx: TilePayloadContext,
): TilePayloadHandler | undefined {
	const list = handlerMap().get( type );
	if ( ! list ) {
		return undefined;
	}
	return list.find( ( handler ) => handler.appliesTo( ctx ) );
}

export function tilePayloadAcceptLabel(
	type: string,
	ctx: TilePayloadContext,
): string | undefined {
	return resolveTileHandler( type, ctx )?.acceptLabel;
}

export function tilePayloadAccepts(
	payload: DragPayload,
	ctx: TilePayloadContext,
): boolean {
	const handler = resolveTileHandler( payload.type, ctx );
	return handler
		? handler.accept( payload.data as Record< string, unknown >, ctx )
		: false;
}

export function tilePayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
	ctx: TilePayloadContext,
): boolean {
	const handler = resolveTileHandler( session.payload.type, ctx );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

export function __resetTilePayloadHandlersForTests(): void {
	handlerMap().clear();
}
