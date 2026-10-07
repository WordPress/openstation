import { addAction, addFilter, removeAction, removeFilter } from '../../../src/hooks';
import { __, sprintf } from '../../../src/i18n';
import { dispatchAgentSendTo } from '../../../src/agents-dispatch';
import { listAgents } from './agents-rest';
import type { Agent } from '../../../src/agents-types';

interface TileMenuOptionLike {
	id: string;
	label: string;
	icon: string;
	danger?: boolean;
	onSelect?: ( () => void ) | null;
}

interface TileMenuCtx {
	entityId: string;
	kind: string;
	item: Record< string, unknown >;
}

let cache: Agent[] | null = null;
let warming = false;

let enabledFlag: boolean | null = null;

export function setSendToEnabled( enabled: boolean ): void {
	if ( enabledFlag === false && enabled ) {
		cache = null;
	}
	enabledFlag = enabled;
}

function agentsConfigured(): boolean {
	return enabledFlag === true;
}

export async function warmSendToAgents(): Promise< void > {
	if ( warming || cache !== null || ! agentsConfigured() ) {
		return;
	}
	warming = true;
	try {
		cache = await listAgents();
	} catch {
		cache = [];
	} finally {
		warming = false;
	}
}

export function refreshSendToAgents(): void {
	cache = null;
	void warmSendToAgents();
}

export function sendToTargetsFor( kind: string ): Agent[] {
	if ( cache === null ) {
		void warmSendToAgents();
		return [];
	}
	return cache.filter( ( agent ) => {
		const trigger = agent.triggers.find( ( t ) => t.kind === 'send-to' );
		if ( ! trigger ) {
			return false;
		}
		const kinds = Array.isArray( trigger.config?.entityKinds )
			? ( trigger.config.entityKinds as string[] )
			: [];
		return kinds.length === 0 || kinds.includes( kind );
	} );
}

export function entityKindForMenuCtx( ctx: {
	entityId: string;
	kind: string;
} ): 'post' | 'page' | 'media' | 'user' | null {
	if ( ctx.kind === 'user' ) {
		return 'user';
	}
	if ( ctx.kind === 'attachment' || ctx.kind === 'media' ) {
		return 'media';
	}
	if ( ctx.kind === 'post' ) {
		return ctx.entityId === 'pages' ? 'page' : 'post';
	}
	return null;
}

function titleFromItem( item: Record< string, unknown > ): string {
	const rendered = ( item.title as { rendered?: unknown } | undefined )
		?.rendered;
	if ( typeof rendered === 'string' && rendered !== '' ) {
		const scratch = document.createElement( 'div' );
		scratch.innerHTML = rendered;
		return scratch.textContent ?? '';
	}
	if ( typeof item.title === 'string' && item.title !== '' ) {
		return item.title;
	}
	if ( typeof item.name === 'string' && item.name !== '' ) {
		return item.name;
	}
	return '';
}

const FILTER_NAMESPACE = 'desktop-mode/agents-send-to';

export function registerSendToMenuFilter(): void {
	removeFilter(
		'os.my-wordpress.tile-context-menu',
		FILTER_NAMESPACE,
	);
	addFilter< TileMenuOptionLike[], [ TileMenuCtx ] >(
		'os.my-wordpress.tile-context-menu',
		FILTER_NAMESPACE,
		sendToMenuFilter,
	);

	removeAction( 'os.agents.roster-changed', FILTER_NAMESPACE );
	addAction( 'os.agents.roster-changed', FILTER_NAMESPACE, () => {
		refreshSendToAgents();
	} );

	void warmSendToAgents();
}

function sendToMenuFilter(
	options: TileMenuOptionLike[],
	ctx: TileMenuCtx,
): TileMenuOptionLike[] {
	const kind = entityKindForMenuCtx( ctx );
	if ( ! kind ) {
		return options;
	}
	const id = Number.parseInt( String( ctx.item?.id ?? '' ), 10 );
	if ( ! id ) {
		return options;
	}
	const targets = sendToTargetsFor( kind );
	if ( targets.length === 0 ) {
		return options;
	}
	const title = titleFromItem( ctx.item ) || `#${ id }`;
	return [
		...options,
		...targets.map( ( agent ) => ( {
			id: `agent-send-to-${ agent.id }`,
			label: sprintf(

				__( 'Send to %s', 'desktop-mode' ),
				agent.name,
			),
			icon: 'dashicons-share-alt',
			onSelect: () => {
				const config = (
					window.wp as
						| { os?: { config?: { restUrl?: string; restNonce?: string } } }
						| undefined
				)?.os?.config;
				void dispatchAgentSendTo(
					{
						id: agent.id,
						name: agent.name,
						description: agent.description,
						avatarUrl: agent.avatarUrl,
					},
					{ kind, id, title },
					{
						restRoot: String( config?.restUrl ?? '' ),
						restNonce: String( config?.restNonce ?? '' ),
					},
				);
			},
		} ) ),
	];
}
