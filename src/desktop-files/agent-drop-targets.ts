/**
 * OpenStation — agent tiles on the wallpaper as drop targets.
 *
 * A user file tile whose user is an agent (`file.isAgent`) accepts
 * entity drops — the PR #240 North Star: "drop this image onto the
 * Remove BG agent". Gating is fully payload-driven: the server
 * inlines the agent's drag-trigger entity kinds into the user-file
 * payload (`agentDragKinds`), so `accept()` stays synchronous with no
 * REST roundtrip.
 *
 * The files layer owns every tile's actual `DropTarget`; this module
 * opts the `'shortcut'` and `'desktop-file'` payload types into agent
 * tiles through the {@link registerTilePayloadHandler} seam, exactly
 * like the pinned-notes convert-to-post drop. Inert while the agents
 * extended option is off — no tile ever carries `isAgent` then.
 *
 * @public
 */

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

/**
 * REST root + nonce for the invoke call. The shell config's `restUrl`
 * is `rest_url()` — NOT the files layer's `baseUrl`, which already
 * ends in `desktop-mode/v1/files` and would double-prefix the route.
 */
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

/**
 * Register the agent tile payload handlers. Idempotent — called from
 * the shell's idle boot alongside the recycle-bin targets.
 *
 * @public
 */
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

/** Test-only. */
export function __resetAgentTileDropHandlersForTests(): void {
	installed = false;
}
