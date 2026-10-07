import { __ } from '../i18n';
import type { DragSession } from '../drag';
import {
	registerTilePayloadHandler,
	type TilePayloadContext,
	type TilePayloadHandler,
} from './tile-payloads';
import {
	agentAcceptsDrop,
	describeDragEntity,
	dispatchAgentDrop,
} from '../agents-dispatch';

interface AgentFileShape {
	type?: string;
	ref?: string;
	title?: string;
	previewUrl?: string;
	isAgent?: boolean;
	agentDragKinds?: string[] | null;
}

function agentFileOf( ctx: TilePayloadContext ): AgentFileShape | null {
	const file = ( ctx.placement as { file?: AgentFileShape } ).file;
	if ( ! file || file.type !== 'user' || file.isAgent !== true ) {
		return null;
	}
	return file;
}

function agentRestDeps(): { restRoot: string; restNonce: string } | null {
	const cfg = (
		window as unknown as {
			openStationConfig?: { restUrl?: string; restNonce?: string };
		}
	).openStationConfig;
	if ( cfg?.restUrl && cfg?.restNonce ) {
		return { restRoot: cfg.restUrl, restNonce: cfg.restNonce };
	}
	return null;
}

function makeAgentTileHandler( payloadType: string ): TilePayloadHandler {
	return {
		appliesTo( ctx ) {
			return agentFileOf( ctx ) !== null;
		},
		accept( data, ctx ) {
			const file = agentFileOf( ctx );
			if ( ! file ) {
				return false;
			}
			const entity = describeDragEntity( { type: payloadType, data } );
			return agentAcceptsDrop(
				file.agentDragKinds ?? null,
				entity,
				Number.parseInt( String( file.ref ?? '' ), 10 ) || undefined,
			);
		},
		acceptLabel: __( 'Send to agent', 'desktop-mode' ),
		onDrop( session: DragSession, _ev, ctx ) {
			const file = agentFileOf( ctx );
			if ( ! file ) {
				return;
			}
			const entity = describeDragEntity( {
				type: session.payload.type,
				data: session.payload.data,
			} );
			const rest = agentRestDeps();
			if ( ! entity || ! rest ) {
				return;
			}
			void dispatchAgentDrop(
				{
					id: Number.parseInt( String( file.ref ?? '' ), 10 ),
					name: String( file.title ?? '' ),
					description: '',
					avatarUrl: String( file.previewUrl ?? '' ),
				},
				entity,
				rest,
			);
		},
	};
}

let installed = false;

export function installAgentTileDropHandlers(): void {
	if ( installed ) {
		return;
	}
	installed = true;
	registerTilePayloadHandler( 'shortcut', makeAgentTileHandler( 'shortcut' ) );
	registerTilePayloadHandler(
		'desktop-file',
		makeAgentTileHandler( 'desktop-file' ),
	);
}

export function __resetAgentTileDropHandlersForTests(): void {
	installed = false;
}
