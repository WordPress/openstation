/**
 * WP Explorer — Agents: REST client over `/desktop-mode/v1/agents`.
 *
 * Every call routes through `trackedFetch` (source
 * `desktop-mode/agents`) with the shell's REST root + nonce
 * (`wp.os.config` — the boot payload every shell page carries).
 * Errors are normalized to `Error` instances carrying the server's
 * `message` when one exists.
 *
 * @public
 */

import { trackedFetch } from '../../../src/tracked-fetch';
import type {
	AgentDraft,
	Ability,
	Agent,
	AgentInvokeResult,
	HookSuggestion,
	MioLook,
	RoleChoice,
	Trigger,
	TriggerKindDescriptor,
} from '../../../src/agents-types';

const SOURCE = { source: 'desktop-mode/agents' };

function shellRest(): { restRoot: string; restNonce: string } {
	const config = (
		window.wp as
			| { os?: { config?: { restUrl?: string; restNonce?: string } } }
			| undefined
	)?.os?.config;
	return {
		restRoot: String( config?.restUrl ?? '' ),
		restNonce: String( config?.restNonce ?? '' ),
	};
}

function agentsUrl( path = '' ): string {
	const root = shellRest().restRoot.replace( /\/+$/, '' );
	return `${ root }/desktop-mode/v1/agents${ path }`;
}

async function request< T >(
	url: string,
	init: RequestInit = {},
): Promise< T > {
	const res = await trackedFetch(
		url,
		{
			...init,
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': shellRest().restNonce,
				...( init.headers || {} ),
			},
		},
		SOURCE,
	);
	const body = ( await res.json().catch( () => null ) ) as
		| ( T & { message?: string } )
		| { message?: string }
		| null;
	if ( ! res.ok ) {
		const message =
			body && typeof body === 'object' && typeof body.message === 'string'
				? body.message
				: `HTTP ${ res.status }`;
		throw new Error( message );
	}
	return body as T;
}

export function listAgents(): Promise< Agent[] > {
	return request< Agent[] >( agentsUrl() );
}

export function getAgent( id: number ): Promise< Agent > {
	return request< Agent >( agentsUrl( `/${ id }` ) );
}

export interface CreateAgentPayload {
	name: string;
	role: string;
	description?: string;
	instructions?: string;
	/**
	 * The whole definition goes in the CREATE call, abilities and
	 * triggers included. No follow-up patch: the route's arg list
	 * accepts every one of these and `openstation_agent_create()`
	 * writes them, so an agent is never briefly on the site in a
	 * half-configured state.
	 */
	abilities?: string[];
	triggers?: Trigger[];
	vibes?: string;
	face?: MioLook;
	faceSeed?: number;
}

export function createAgent( payload: CreateAgentPayload ): Promise< Agent > {
	return request< Agent >( agentsUrl(), {
		method: 'POST',
		body: JSON.stringify( payload ),
	} );
}

/**
 * `POST /agents/draft`: a definition drafted from a brief.
 *
 * One AI generate call with a strict answer schema, filtered against
 * the site's catalogues on the server. Creates nothing.
 */
export function draftAgent( brief: string ): Promise< AgentDraft > {
	return request< AgentDraft >( agentsUrl( '/draft' ), {
		method: 'POST',
		body: JSON.stringify( { brief } ),
	} );
}

export interface UpdateAgentPayload {
	name?: string;
	role?: string;
	description?: string;
	instructions?: string;
	abilities?: string[];
	triggers?: Trigger[];
	model?: string;
	rateLimit?: number;
	vibes?: string;
	face?: MioLook;
	faceSeed?: number;
}

export function updateAgent(
	id: number,
	patch: UpdateAgentPayload,
): Promise< Agent > {
	return request< Agent >( agentsUrl( `/${ id }` ), {
		method: 'POST',
		body: JSON.stringify( patch ),
	} );
}

export function deleteAgent(
	id: number,
): Promise< { deleted: boolean; id: number } > {
	return request< { deleted: boolean; id: number } >(
		agentsUrl( `/${ id }` ),
		{ method: 'DELETE' },
	);
}

export function invokeAgent(
	id: number,
	message: string,
): Promise< AgentInvokeResult > {
	return request< AgentInvokeResult >( agentsUrl( `/${ id }/invoke` ), {
		method: 'POST',
		body: JSON.stringify( { message } ),
	} );
}

export function fetchAbilitiesCatalogue(): Promise< Ability[] > {
	return request< Ability[] >( agentsUrl( '/abilities' ) );
}

export function fetchTriggerKinds(): Promise< TriggerKindDescriptor[] > {
	return request< TriggerKindDescriptor[] >( agentsUrl( '/trigger-kinds' ) );
}

export function fetchHooksCatalogue(): Promise< HookSuggestion[] > {
	return request< HookSuggestion[] >( agentsUrl( '/hooks-catalogue' ) );
}

export function fetchRoles(): Promise< RoleChoice[] > {
	return request< RoleChoice[] >( agentsUrl( '/roles' ) );
}

/**
 * Live AI-provider probe against the Copilot's `/ai/status` route.
 * Returns null when the route errors (e.g. AI unavailable) — the
 * caller treats that as "not configured".
 */
export async function fetchAiStatus(
	statusUrl: string,
): Promise< { available: boolean; providerConfigured: boolean } | null > {
	try {
		const res = await trackedFetch(
			statusUrl,
			{ headers: { 'X-WP-Nonce': shellRest().restNonce } },
			{ ...SOURCE, silent: true },
		);
		if ( ! res.ok ) {
			return null;
		}
		const body = ( await res.json() ) as {
			available?: boolean;
			providerConfigured?: boolean;
			assistantProviderConfigured?: boolean;
		};
		return {
			available: body.available === true,
			providerConfigured:
				body.assistantProviderConfigured === true ||
				body.providerConfigured === true,
		};
	} catch {
		return null;
	}
}
