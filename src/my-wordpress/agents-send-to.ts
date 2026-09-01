/**
 * WP Explorer — Agents "Send to" context-menu intake.
 *
 * Agents whose triggers include a `send-to` row appear as
 * "Send to <agent>" entries in WP Explorer's tile context menus
 * (posts, pages, media, users), gated by the trigger's `entityKinds`
 * (empty = every kind). Picking one runs the same engine as drag &
 * drop: compose the message, open the chat window, invoke with
 * `source: 'send-to'`.
 *
 * The agents list is cached module-side and warmed when the bundle
 * loads (menus build synchronously, so the filter can only offer
 * agents it already knows). The Agents section calls
 * {@link refreshSendToAgents} after any agent mutation so the menu
 * reflects trigger edits without a reload.
 *
 * @public
 */

import { addAction, addFilter, removeAction, removeFilter } from '../hooks';
import { __, sprintf } from '../i18n';
import { dispatchAgentSendTo } from '../agents-dispatch';
import { listAgents } from './agents-rest';
import type { Agent } from './agents-types';
import { getConfig } from './rest';
import type { MyWordPressConfig } from './types';
import type { AgentsSectionConfig } from './agents-types';

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

/**
 * The section config ships on every WP Explorer window the user may
 * read agents in — including sites where the framework itself is off,
 * so the section can render its "turn it on" state. `enabled` is the
 * half that says whether the REST routes exist; without it the warm-up
 * below would fetch a 404 on every such site.
 */
function agentsConfigured(): boolean {
	try {
		const agents = ( getConfig() as MyWordPressConfig & {
			agents?: AgentsSectionConfig;
		} ).agents;
		return Boolean( agents?.enabled );
	} catch {
		return false;
	}
}

/** Fetch (once) the agents the menu can offer. */
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

/** Drop the cache and re-warm — called after any agent mutation. */
export function refreshSendToAgents(): void {
	cache = null;
	void warmSendToAgents();
}

/** Agents offering "Send to" for the given entity kind. */
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

/** Map a tile-menu context onto the trigger entity-kind enum. */
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

/**
 * Register the menu filter and warm the cache. Called by the site
 * folder bundle's entry (not at import time — importing a helper from
 * this module must not require a live hook bus).
 *
 * Idempotent ON THE BUS, not in module state: the bundle's IIFE can
 * execute twice (boot enqueue + the native-window lazy loader), which
 * resets module globals but shares `wp.hooks` — a plain boolean guard
 * shipped duplicate "Send to" menu entries.
 */
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
	// Another bundle changed the roster (the My WordPress APP's Agents
	// section creates, edits and deletes agents in its own bundle, so
	// it cannot reach this module's cache directly): drop it and
	// re-warm, the same as the section renderer's refresh.
	removeAction( 'os.agents.roster-changed', FILTER_NAMESPACE );
	addAction( 'os.agents.roster-changed', FILTER_NAMESPACE, () => {
		refreshSendToAgents();
	} );
	// Menus build synchronously — warm the cache up front so the first
	// right-click already offers the agents.
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
				/* translators: %s is the agent's name. */
				__( 'Send to %s', 'desktop-mode' ),
				agent.name,
			),
			icon: 'dashicons-share-alt',
			onSelect: () => {
				void dispatchAgentSendTo(
					{
						id: agent.id,
						name: agent.name,
						description: agent.description,
						avatarUrl: agent.avatarUrl,
					},
					{ kind, id, title },
					{
						restRoot: getConfig().restRoot,
						restNonce: getConfig().restNonce,
					},
				);
			},
		} ) ),
	];
}
