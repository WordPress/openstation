import { addAction, addFilter } from '../hooks';
import { __, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { describeDragEntity, dispatchAgentSendTo, type DroppedEntity } from '../agents-dispatch';
import type { RestPlacementShape } from './rest';
import type { TileMenuItem } from './tile-menu';

export interface SendToTarget {
	id: number;
	name: string;
	description: string;
	avatarUrl: string;
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

export function sendToTargetsForKind( list: SendToTarget[], kind: string ): SendToTarget[] {
	return list.filter( ( agent ) => agent.entityKinds.length === 0 || agent.entityKinds.includes( kind ) );
}

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

async function refetchTargets(): Promise< void > {
	const cfg = shellConfig();
	if ( ! cfg.restUrl || ! cfg.restNonce ) {
		return;
	}
	try {
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
	}
}

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

export function installAgentMenuItems(): void {
	const inlined = shellConfig().agentsSendTo;
	targets = Array.isArray( inlined ) ? inlined : [];
	addFilter( 'os.files.tile-menu', 'desktop-mode/agents-send-to', agentMenuItems );
	addAction( 'os.agents.roster-changed', 'desktop-mode/agents-send-to/desktop', () => {
		void refetchTargets();
	} );
}

export function _setSendToTargets( next: SendToTarget[] ): void {
	targets = next;
}
