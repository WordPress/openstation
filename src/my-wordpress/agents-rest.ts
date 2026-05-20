/**
 * My WordPress — Agents REST adapter.
 *
 * All HTTP for the Agents section funnels through this module so the
 * renderer never touches `wp.desktop.fetch` directly. Pattern matches
 * `rest.ts` in the same folder: read the window config, wrap
 * `trackedFetch` with the window id + source tag, surface failures as
 * plain `Error` instances with the REST `message` field.
 *
 * @internal
 * @since 0.23.0
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type {
	Ability,
	Agent,
	AgentDraft,
	AgentPatch,
	HookSuggestion,
	Trigger,
	TriggerKindDescriptor,
} from './agents-types';
import { getConfig } from './rest';

const WINDOW_ID = 'desktop-mode-my-wordpress';

async function shellFetch(
	input: RequestInfo,
	init: RequestInit,
): Promise< Response > {
	return trackedFetch( input, init, {
		windowId: WINDOW_ID,
		source: 'desktop-mode/agents',
	} );
}

function buildUrl( path: string ): string {
	return joinRestUrl( getConfig().restRoot, path );
}

async function readErrorMessage(
	response: Response,
	fallback: string,
): Promise< string > {
	try {
		const body = ( await response.clone().json() ) as
			| { message?: string }
			| undefined;
		if ( body && typeof body.message === 'string' && body.message ) {
			return body.message;
		}
	} catch ( _err ) {
		// Ignore — non-JSON responses fall through to the text path.
	}
	try {
		const text = await response.text();
		if ( text ) {
			return text.slice( 0, 240 );
		}
	} catch ( _err ) {
		// Ignore.
	}
	return fallback;
}

async function jsonFetch< T >(
	method: string,
	path: string,
	body?: unknown,
): Promise< T > {
	const cfg = getConfig();
	const init: RequestInit = {
		method,
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	};
	if ( body !== undefined ) {
		init.body = JSON.stringify( body );
		( init.headers as Record< string, string > )[ 'Content-Type' ] =
			'application/json';
	}
	const response = await shellFetch( buildUrl( path ), init );
	if ( ! response.ok ) {
		const message = await readErrorMessage(
			response,
			`Request failed (${ response.status })`,
		);
		const error = new Error( message ) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}
	if ( response.status === 204 ) {
		// 'no content' — let callers cast as appropriate
		return undefined as unknown as T;
	}
	return ( await response.json() ) as T;
}

/**
 * GET `/desktop-mode/v1/agents` — list every agent on the site.
 *
 * @public
 */
export async function listAgents(): Promise< Agent[] > {
	return jsonFetch< Agent[] >( 'GET', 'desktop-mode/v1/agents' );
}

/**
 * GET `/desktop-mode/v1/agents/<id>`.
 *
 * @public
 */
export async function getAgent( id: number ): Promise< Agent > {
	return jsonFetch< Agent >( 'GET', `desktop-mode/v1/agents/${ id }` );
}

/**
 * POST `/desktop-mode/v1/agents` — create.
 *
 * @public
 */
export async function createAgent( draft: AgentDraft ): Promise< Agent > {
	return jsonFetch< Agent >( 'POST', 'desktop-mode/v1/agents', draft );
}

/**
 * POST `/desktop-mode/v1/agents/<id>` — patch.
 *
 * @public
 */
export async function updateAgent(
	id: number,
	patch: AgentPatch,
): Promise< Agent > {
	return jsonFetch< Agent >(
		'POST',
		`desktop-mode/v1/agents/${ id }`,
		patch,
	);
}

/**
 * Convenience wrapper around `updateAgent` for ability toggling.
 *
 * @public
 */
export async function setAbilities(
	id: number,
	abilities: string[],
): Promise< Agent > {
	return updateAgent( id, { abilities } );
}

/**
 * Convenience wrapper around `updateAgent` for trigger array writes.
 *
 * @public
 */
export async function setTriggers(
	id: number,
	triggers: Trigger[],
): Promise< Agent > {
	return updateAgent( id, { triggers } );
}

/**
 * Convenience wrapper around `updateAgent` for role flips.
 *
 * @public
 */
export async function setRole( id: number, role: string ): Promise< Agent > {
	return updateAgent( id, { role } );
}

/**
 * DELETE `/desktop-mode/v1/agents/<id>` — destructive (cascades the
 * linked `wp_guideline`).
 *
 * @public
 */
export async function deleteAgent( id: number ): Promise< void > {
	await jsonFetch< { deleted: boolean; id: number } >(
		'DELETE',
		`desktop-mode/v1/agents/${ id }`,
	);
}

export interface AgentActivityEntry {
	time: number;
	userId: number;
	userName: string;
	message: string;
	status: 'done' | 'error' | string;
	error: string;
	text: string;
	turns: number;
	toolCallsCount: number;
	toolNames: string[];
}

export interface AgentDossier extends Agent {
	identity: {
		login: string;
		email: string;
		registered: string;
		loginBlocked: boolean;
		pwResetBlocked: boolean;
	};
	guideline: {
		id: number;
		slug: string;
		status: string;
		modified: string;
		created: string;
		source: string;
		editLink: string;
	} | null;
	enabledAbilities: Ability[];
	revisions: {
		count: number;
		recent: Array< {
			id: number;
			date: string;
			authorId: number;
			authorName: string;
		} >;
	};
	authored: {
		total: number;
		recent: Array< {
			id: number;
			type: string;
			title: string;
			status: string;
			modified: string;
			editLink: string;
		} >;
	};
	activity: {
		total: number;
		recent: AgentActivityEntry[];
	};
}

export interface AgentToolCall {
	callId: string;
	name: string;
	args: Record< string, unknown >;
	output: unknown;
	error: string | null;
}

export interface AgentInvokeResult {
	text: string;
	toolCalls: AgentToolCall[];
	turns: number;
}

/**
 * GET `/desktop-mode/v1/agents/<id>/dossier` — extended view used
 * when the user navigates INTO an agent.
 *
 * @public
 */
export async function fetchAgentDossier( id: number ): Promise< AgentDossier > {
	return jsonFetch< AgentDossier >(
		'GET',
		`desktop-mode/v1/agents/${ id }/dossier`,
	);
}

/**
 * POST `/desktop-mode/v1/agents/<id>/invoke` — run the agent.
 *
 * @public
 */
export async function invokeAgent(
	id: number,
	message: string,
): Promise< AgentInvokeResult > {
	return jsonFetch< AgentInvokeResult >(
		'POST',
		`desktop-mode/v1/agents/${ id }/invoke`,
		{ message },
	);
}

/**
 * GET `/desktop-mode/v1/agents/abilities`.
 *
 * @public
 */
export async function fetchAbilitiesCatalogue(): Promise< Ability[] > {
	return jsonFetch< Ability[] >( 'GET', 'desktop-mode/v1/agents/abilities' );
}

/**
 * GET `/desktop-mode/v1/agents/hooks-catalogue`.
 *
 * @public
 */
export async function fetchHooksCatalogue(): Promise< HookSuggestion[] > {
	return jsonFetch< HookSuggestion[] >(
		'GET',
		'desktop-mode/v1/agents/hooks-catalogue',
	);
}

/**
 * GET `/desktop-mode/v1/agents/trigger-kinds`.
 *
 * @public
 */
export async function fetchTriggerKinds(): Promise< TriggerKindDescriptor[] > {
	return jsonFetch< TriggerKindDescriptor[] >(
		'GET',
		'desktop-mode/v1/agents/trigger-kinds',
	);
}

/**
 * POST `/wp-admin/admin-ajax.php?action=desktop_mode_enable_guidelines_experiment`.
 *
 * Used by the soft-gate empty state's "Enable Guidelines experiment"
 * button. Goes through admin-ajax rather than REST because flipping a
 * Gutenberg option is a one-shot, manage_options-only action with no
 * meaningful place in our REST surface.
 *
 * @public
 */
export async function enableGuidelinesExperiment(
	nonce: string,
): Promise< void > {
	const form = new FormData();
	form.set( 'action', 'desktop_mode_enable_guidelines_experiment' );
	form.set( 'nonce', nonce );
	const response = await shellFetch(
		`${ window.ajaxurl ?? '/wp-admin/admin-ajax.php' }`,
		{
			method: 'POST',
			credentials: 'same-origin',
			body: form,
		},
	);
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage(
				response,
				`Couldn't enable Guidelines experiment (${ response.status })`,
			),
		);
	}
	const body = ( await response.json() ) as {
		success?: boolean;
		data?: { reload?: boolean };
	};
	if ( ! body.success ) {
		throw new Error( `Couldn't enable Guidelines experiment.` );
	}
}

declare global {
	interface Window {
		ajaxurl?: string;
	}
}
