/**
 * Routines — REST client.
 *
 * Thin fetch wrappers. Every call carries the `X-WP-Nonce` header;
 * any non-2xx response throws a typed `RestError` so callers can
 * decide how to surface it.
 *
 * @since 0.22.0
 */

import type {
	Catalog,
	Routine,
	RoutineDef,
	RoutineRun,
	Template,
} from './types';

export class RestError extends Error {
	readonly status: number;
	readonly code: string;
	constructor( status: number, code: string, message: string ) {
		super( message );
		this.status = status;
		this.code = code;
	}
}

export function cfg() {
	const c = window.wpDesktopRoutinesConfig;
	if ( ! c ) {
		throw new RestError( 0, 'no_config', 'Routines config missing.' );
	}
	return c;
}

async function request< T >(
	url: string,
	init: RequestInit = {},
): Promise< T > {
	const c = cfg();
	const headers = new Headers( init.headers );
	headers.set( 'X-WP-Nonce', c.restNonce );
	if ( init.body && ! headers.has( 'Content-Type' ) ) {
		headers.set( 'Content-Type', 'application/json' );
	}
	const res = await fetch( url, { ...init, headers, credentials: 'same-origin' } );
	const text = await res.text();
	let json: unknown = null;
	if ( text ) {
		try {
			json = JSON.parse( text );
		} catch {
			json = null;
		}
	}
	if ( ! res.ok ) {
		const j = json as { code?: string; message?: string } | null;
		throw new RestError(
			res.status,
			j?.code ?? `http_${ res.status }`,
			j?.message ?? `Request failed (${ res.status })`,
		);
	}
	return json as T;
}

export function listRoutines(): Promise< { items: Routine[] } > {
	return request( cfg().rootUrl );
}

export function readRoutine( id: number ): Promise< Routine > {
	return request( `${ cfg().rootUrl }/${ id }` );
}

export function createRoutine(
	body: { title: string; enabled?: boolean; def: RoutineDef },
): Promise< Routine > {
	return request( cfg().rootUrl, {
		method: 'POST',
		body: JSON.stringify( body ),
	} );
}

export function updateRoutine(
	id: number,
	body: Partial< { title: string; enabled: boolean; def: RoutineDef } >,
): Promise< Routine > {
	return request( `${ cfg().rootUrl }/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
	} );
}

export function deleteRoutine( id: number ): Promise< { deleted: boolean } > {
	return request( `${ cfg().rootUrl }/${ id }`, { method: 'DELETE' } );
}

export function testRoutine(
	id: number,
	payload: unknown,
): Promise< {
	status: 'success' | 'failure' | 'skipped';
	duration_ms: number;
	steps_log: RoutineRun[ 'steps_log' ];
	error: string;
} > {
	return request( `${ cfg().rootUrl }/${ id }/test`, {
		method: 'POST',
		body: JSON.stringify( { payload } ),
	} );
}

export function runRoutine( id: number, payload: unknown ) {
	return request< {
		status: 'success' | 'failure' | 'skipped';
		duration_ms: number;
		steps_log: RoutineRun[ 'steps_log' ];
		error: string;
	} >( `${ cfg().rootUrl }/${ id }/run`, {
		method: 'POST',
		body: JSON.stringify( { payload } ),
	} );
}

export function setEnabled( id: number, enabled: boolean ): Promise< Routine > {
	return request( `${ cfg().rootUrl }/${ id }/enable`, {
		method: 'POST',
		body: JSON.stringify( { enabled } ),
	} );
}

export function listRuns(
	id: number,
	limit = 50,
): Promise< { items: RoutineRun[] } > {
	return request( `${ cfg().rootUrl }/${ id }/runs?limit=${ limit }` );
}

export function fetchCatalog(): Promise< Catalog > {
	return request( cfg().catalogUrl );
}

export function fetchTemplates(): Promise< { items: Template[] } > {
	return request( cfg().templatesUrl );
}

export function generateFromPrompt(
	prompt: string,
): Promise< { def: import( './types' ).RoutineDef; used_model: string; latency_ms: number } > {
	return request( `${ cfg().rootUrl }/from-prompt`, {
		method: 'POST',
		body: JSON.stringify( { prompt } ),
	} );
}

export function installTemplate(
	templateId: string,
	title?: string,
): Promise< Routine > {
	return request( cfg().fromTemplateUrl, {
		method: 'POST',
		body: JSON.stringify( { template_id: templateId, title } ),
	} );
}
