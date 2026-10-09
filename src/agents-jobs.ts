/** Async agent transport: short submission, sequential status reads, no replay. */
import { __ } from './i18n';
import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';
import { RestError, restErrorFromBody } from './core/api-client';
import type { AgentInvokeResult } from './agents-types';
import type { RestAuth } from './agents-conversations';

export interface AgentJobStatus {
	jobId: string;
	status: 'queued' | 'running' | 'completed' | 'failed';
	pollAfter: number;
	result: AgentInvokeResult | null;
	error: { code: string; message: string } | null;
}

export interface AgentJobInput {
	message: string;
	source: 'chat' | 'drag' | 'send-to';
	history: Array< { role: string; text: string } >;
}

/** UUID on both HTTPS and local HTTP installations. */
export function agentRequestId(): string {
	const bytes = crypto.getRandomValues( new Uint8Array( 16 ) );
	bytes[ 6 ] = ( bytes[ 6 ] % 16 ) + 64;
	bytes[ 8 ] = ( bytes[ 8 ] % 64 ) + 128;
	const hex = Array.from( bytes, ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	return `${ hex.slice( 0, 8 ) }-${ hex.slice( 8, 12 ) }-${ hex.slice( 12, 16 ) }-${ hex.slice( 16, 20 ) }-${ hex.slice( 20 ) }`;
}

/** A failed job request, plus whether the poller should try again. */
class JobRequestError extends RestError {
	readonly retryable: boolean;

	constructor( message: string, retryable: boolean, base: RestError = new RestError( '', { status: 0 } ) ) {
		super( message, {
			status: base.status,
			code: base.code,
			data: base.data,
			serverMessage: base.serverMessage,
		} );
		this.name = 'JobRequestError';
		this.retryable = retryable;
	}
}

async function request(
	rest: RestAuth,
	path: string,
	input?: AgentJobInput & { async: true; requestId: string },
): Promise< AgentJobStatus | AgentInvokeResult > {
	const controller = new AbortController();
	// The handle must survive both the request and body parsing for cleanup.
	// eslint-disable-next-line @wordpress/no-unused-vars-before-return
	const timeout = window.setTimeout( () => controller.abort(), 15000 );
	try {
		const response = await trackedFetch(
			joinRestUrl( rest.restRoot, path ),
			{
				method: input ? 'POST' : 'GET',
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': rest.restNonce },
				body: input ? JSON.stringify( input ) : undefined,
				signal: controller.signal,
				cache: 'no-store',
			},
			{ source: 'desktop-mode/agents', silent: ! input },
		);
		const body = await response.json().catch( () => null ) as
			| ( AgentJobStatus & AgentInvokeResult & { message?: string; code?: string; data?: unknown } ) | null;
		if ( ! response.ok ) {
			throw new JobRequestError(
				body?.message || `HTTP ${ response.status }`,
				( response.status >= 500 && ! body?.code ) || response.status === 408,
				restErrorFromBody( response.status, body ),
			);
		}
		if ( ! body || ( ! body.jobId && typeof body.text !== 'string' ) ) {
			throw new JobRequestError(
				__( 'The job status could not be read.', 'desktop-mode' ),
				true,
				restErrorFromBody( response.status, null ),
			);
		}
		return body;
	} finally {
		window.clearTimeout( timeout );
	}
}

function delay( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => window.setTimeout( resolve, ms ) );
}

/**
 * Submit once logically, then poll until terminal. Network retries reuse the UUID.
 * Each status fetch finishes before the next timer starts; hidden tabs poll slower.
 */
export async function runAgentJob(
	agentId: number,
	input: AgentJobInput,
	rest: RestAuth,
	requestId: string,
	onStatus: ( status: 'queued' | 'running' | 'reconnecting' ) => void = () => {},
): Promise< AgentInvokeResult > {
	const base = `desktop-mode/v1/agents/${ agentId }`;
	const deadline = Date.now() + 2 * 60 * 60 * 1000;
	let submitted = false;
	let interval = 2000;
	while ( Date.now() < deadline ) {
		try {
			const body = await request(
				rest,
				submitted ? `${ base }/jobs/${ requestId }` : `${ base }/invoke`,
				submitted ? undefined : { ...input, async: true, requestId },
			);
			// Compatibility with an older server during a rolling upgrade.
			if ( ! ( 'jobId' in body ) ) {
				return body;
			}
			if ( body.jobId !== requestId ) {
				throw new JobRequestError( __( 'The server returned a different job.', 'desktop-mode' ), false );
			}
			submitted = true;
			if ( body.status === 'completed' && body.result ) {
				return body.result;
			}
			if ( body.status === 'failed' ) {
				throw new JobRequestError( body.error?.message || __( 'The agent job failed.', 'desktop-mode' ), false );
			}
			if ( body.status !== 'queued' && body.status !== 'running' ) {
				throw new JobRequestError( __( 'The server returned an invalid job state.', 'desktop-mode' ), false );
			}
			onStatus( body.status );
			interval = Math.min( 10000, Math.max( interval * 1.25, ( body.pollAfter || 3 ) * 1000 ) );
		} catch ( error ) {
			if ( error instanceof JobRequestError && ! error.retryable ) {
				throw error;
			}
			onStatus( 'reconnecting' );
			interval = Math.min( interval * 2, 30000 );
		}
		await delay( document.hidden ? Math.max( interval, 15000 ) : interval );
	}
	throw new Error( __( 'The background job has not returned a result. Some work may already have been applied. Check the site before submitting again.', 'desktop-mode' ) );
}
