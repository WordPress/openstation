/**
 * OpenStation — "Send to <agent>" on desktop and folder tiles.
 *
 * WP Explorer's tile menus have offered agents with a `send-to` trigger
 * since the agents framework landed; a post, page, media item or user
 * on the wallpaper or in a folder offered nothing. This puts the same
 * entries on those tiles, through the public `os.files.tile-menu`
 * filter like every other built-in entry, so a plugin can reorder or
 * hide them.
 *
 * The roster is inlined by the server (`openStationConfig.agentsSendTo`,
 * from `openstation_agents_send_to_targets()`): only agents this user
 * may invoke, with the entity kinds their trigger accepts. Menus build
 * synchronously, so a list in hand is what lets the first right-click
 * offer them. A roster change elsewhere (`os.agents.roster-changed`)
 * refetches it.
 *
 * Activated once on boot from `src/desktop-files/index.ts`.
 */

import { addAction, addFilter } from '../hooks';
import { __, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { describeDragEntity, dispatchAgentSendTo, type DroppedEntity } from '../agents-dispatch';
import type { RestPlacementShape } from './rest';
import type { TileMenuItem } from './tile-menu';

/** One agent the menu can offer. */
export interface SendToTarget {
	id: number;
	name: string;
	description: string;
	avatarUrl: string;
	/** Entity kinds the trigger accepts; empty = every kind. */
	entityKinds: string[];
}

interface ShellConfigShape {
	agentsSendTo?: SendToTarget[];
	restUrl?: string;
	restNonce?: string;
}

function shellConfig(): ShellConfigShape {
	return ( window as unknown as { openStationConfig?: ShellConfigShape } ).openStationConfig ?? {};
}

let targets: SendToTarget[] = [];

/** The agents that accept an entity of `kind`. */
export function sendToTargetsForKind( list: SendToTarget[], kind: string ): SendToTarget[] {
	return list.filter( ( agent ) => agent.entityKinds.length === 0 || agent.entityKinds.includes( kind ) );
}

/**
 * The entity a tile stands for, in the agents' vocabulary — or `null`
 * for a tile no agent can receive (a folder, a link, an upload…) or an
 * agent's own tile.
 */
export function entityForPlacement( placement: RestPlacementShape ): DroppedEntity | null {
	const file = placement.file as RestPlacementShape[ 'file' ] & { isAgent?: boolean; postType?: unknown };
	if ( file.isAgent === true ) {
		return null;
	}
	const entity = describeDragEntity( { type: 'desktop-file', data: { placement } } );
	if ( entity && entity.kind === 'post' && file.postType === 'page' ) {
		return { ...entity, kind: 'page' };
	}
	return entity;
}

interface AgentRow {
	id: number;
	name: string;
	description?: string;
	avatarUrl?: string;
	triggers?: Array< { kind?: string; config?: { entityKinds?: unknown; capability?: unknown } } >;
}

/**
 * Rebuild the roster from `GET /agents` after a change elsewhere. The
 * per-agent capability gate is the server's to judge, so an agent that
 * declares one keeps its place only if the server already offered it.
 */
async function refetchTargets(): Promise< void > {
	const cfg = shellConfig();
	if ( ! cfg.restUrl || ! cfg.restNonce ) {
		return;
	}
	try {
		// Silent: a roster refresh is background bookkeeping, not
		// activity on any window.
		const res = await trackedFetch(
			joinRestUrl( cfg.restUrl, 'desktop-mode/v1/agents' ),
			{
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': cfg.restNonce, Accept: 'application/json' },
			},
			{ silent: true },
		);
		if ( ! res.ok ) {
			return;
		}
		const rows = ( await res.json() ) as AgentRow[];
		const vetted = new Set( targets.map( ( t ) => t.id ) );
		targets = ( Array.isArray( rows ) ? rows : [] ).flatMap( ( row ) => {
			const triggers = row.triggers ?? [];
			const sendTo = triggers.find( ( t ) => t.kind === 'send-to' );
			const gated = triggers.some( ( t ) => typeof t.config?.capability === 'string' && t.config.capability !== '' );
			if ( ! sendTo || ( gated && ! vetted.has( row.id ) ) ) {
				return [];
			}
			const kinds = Array.isArray( sendTo.config?.entityKinds ) ? ( sendTo.config.entityKinds as unknown[] ).map( String ) : [];
			return [ {
				id: row.id,
				name: row.name,
				description: row.description ?? '',
				avatarUrl: row.avatarUrl ?? '',
				entityKinds: kinds,
			} ];
		} );
	} catch {
		// Keep the roster in hand; the next change retries.
	}
}

/**
 * The tile-menu filter: one "Send to <agent>" entry per agent that
 * accepts this tile's entity.
 */
export function agentMenuItems( items: TileMenuItem[], placement: RestPlacementShape ): TileMenuItem[] {
	const entity = entityForPlacement( placement );
	if ( ! entity ) {
		return items;
	}
	const cfg = shellConfig();
	for ( const agent of sendToTargetsForKind( targets, entity.kind ) ) {
		items.push( {
			id: `desktop-mode/agent-send-to-${ agent.id }`,
			label: sprintf(
				/* translators: %s is the agent's name. */
				__( 'Send to %s', 'desktop-mode' ),
				agent.name,
			),
			icon: 'dashicons-share-alt',
			sort: 70,
			onClick: () => {
				void dispatchAgentSendTo(
					{ id: agent.id, name: agent.name, description: agent.description, avatarUrl: agent.avatarUrl },
					entity,
					{ restRoot: String( cfg.restUrl ?? '' ), restNonce: String( cfg.restNonce ?? '' ) },
				);
			},
		} );
	}
	return items;
}

/**
 * Boot — read the inlined roster and register the tile-menu entries.
 */
export function installAgentMenuItems(): void {
	const inlined = shellConfig().agentsSendTo;
	targets = Array.isArray( inlined ) ? inlined : [];
	addFilter( 'os.files.tile-menu', 'desktop-mode/agents-send-to', agentMenuItems );
	addAction( 'os.agents.roster-changed', 'desktop-mode/agents-send-to/desktop', () => {
		void refetchTargets();
	} );
}

/**
 * Test seam — replace the roster in hand.
 *
 * @internal
 */
export function _setSendToTargets( next: SendToTarget[] ): void {
	targets = next;
}
