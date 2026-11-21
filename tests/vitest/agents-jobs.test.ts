import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { agentRequestId, JobRequestError, runAgentJob } from '../../src/agents-jobs';
import { dispatchAgentSendTo, resumeAgentJobIntoTranscript } from '../../src/agents-dispatch';
import { agentsChatStore } from '../../src/agents-chat-store';

const rest = { restRoot: 'https://example.test/wp-json/', restNonce: 'nonce' };
const input = { message: 'Check SEO', source: 'send-to' as const, history: [] };
const id = '09a66ae0-077a-4000-8000-123456789abc';
const result = { text: 'SEO complete', toolCalls: [], callToActions: [], turns: 4 };
const job = ( status: string ) => ( { jobId: id, status, pollAfter: 3, result: status === 'completed' ? result : null } );
const response = ( body: unknown, status = 200 ) => new Response( JSON.stringify( body ), { status } );
const searched = { name: 'desktop-mode/search-posts', args: { search: 'seo' }, error: null };
const progress = ( ...toolCalls: Array< typeof searched > ) => ( { turn: toolCalls.length, toolCalls, updatedAt: 1700000000 } );

beforeEach( () => {
	vi.useFakeTimers();
	vi.spyOn( document, 'hidden', 'get' ).mockReturnValue( false );
} );
afterEach( () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

describe( 'async agent transport', () => {
	test( 'generates a valid unique UUID', () => {
		expect( agentRequestId() ).toMatch( /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/ );
		expect( agentRequestId() ).not.toBe( agentRequestId() );
	} );

	test( 'a job beyond 30 seconds completes with one POST and bounded, sequential polling', async () => {
		const started = Date.now();
		let active = 0;
		let maxActive = 0;
		const fetcher = vi.fn( async ( _url: string, init: RequestInit ) => {
			maxActive = Math.max( maxActive, ++active );
			await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
			--active;
			return response( job( init.method === 'POST' ? 'queued' : Date.now() - started > 35000 ? 'completed' : 'running' ), init.method === 'POST' ? 202 : 200 );
		} );
		vi.stubGlobal( 'fetch', fetcher );
		const status = vi.fn();
		const pending = runAgentJob( 9, input, rest, id, status );
		await vi.advanceTimersByTimeAsync( 34000 );
		expect( status ).toHaveBeenCalledWith( 'running', null );
		await vi.advanceTimersByTimeAsync( 12000 );
		await expect( pending ).resolves.toEqual( result );
		expect( maxActive ).toBe( 1 );
		expect( fetcher.mock.calls.filter( ( [ , init ] ) => init.method === 'POST' ) ).toHaveLength( 1 );
		expect( fetcher.mock.calls.length ).toBeLessThanOrEqual( 10 );
		expect( fetcher.mock.calls[ 1 ][ 0 ] ).toBe( `${ rest.restRoot }desktop-mode/v1/agents/9/jobs/${ id }` );
		expect( fetcher.mock.calls[ 1 ][ 1 ].cache ).toBe( 'no-store' );
	} );

	test( 'lost submission retries the same UUID; lost poll never resubmits', async () => {
		const fetcher = vi.fn()
			.mockRejectedValueOnce( new TypeError( 'offline' ) )
			.mockResolvedValueOnce( response( job( 'queued' ), 202 ) )
			.mockResolvedValueOnce( response( null, 504 ) )
			.mockResolvedValueOnce( response( job( 'completed' ) ) );
		vi.stubGlobal( 'fetch', fetcher );
		const progress = vi.fn();
		const pending = runAgentJob( 9, input, rest, id, progress );
		await vi.advanceTimersByTimeAsync( 60000 );
		await expect( pending ).resolves.toEqual( result );
		const bodies = fetcher.mock.calls.slice( 0, 2 ).map( ( [ , init ] ) => JSON.parse( init.body as string ) );
		expect( bodies[ 0 ] ).toEqual( bodies[ 1 ] );
		expect( bodies[ 0 ].requestId ).toBe( id );
		expect( fetcher.mock.calls.slice( 2 ).map( ( [ , init ] ) => init.method ) ).toEqual( [ 'GET', 'GET' ] );
		expect( progress ).toHaveBeenCalledWith( 'reconnecting' );
	} );

	test( 'terminal failures and expired authentication stop polling', async () => {
		const fetcher = vi.fn()
			.mockResolvedValueOnce( response( job( 'queued' ), 202 ) )
			.mockResolvedValueOnce( response( { message: 'Please sign in again.' }, 403 ) );
		vi.stubGlobal( 'fetch', fetcher );
		const pending = expect( runAgentJob( 9, input, rest, id ) ).rejects.toThrow( 'Please sign in again.' );
		await vi.advanceTimersByTimeAsync( 30000 );
		await pending;
		expect( fetcher ).toHaveBeenCalledTimes( 2 );
		fetcher.mockResolvedValueOnce( response( { ...job( 'failed' ), error: { code: 'failed', message: 'Worker stopped.' } }, 202 ) );
		await expect( runAgentJob( 9, input, rest, id ) ).rejects.toThrow( 'Worker stopped.' );
	} );

	test( 'Send to keeps the chat pending across a slow job and then shows its answer', async () => {
		const started = Date.now();
		let requestId = '';
		agentsChatStore.state.transcripts = {};
		const fetcher = vi.fn( async ( url: string, init: RequestInit ) => {
			if ( url.includes( '/conversations' ) ) return response( { id: 7 } );
			if ( init.method === 'POST' ) requestId = JSON.parse( String( init.body ) ).requestId;
			return response( { ...job( Date.now() - started > 35000 ? 'completed' : 'running' ), jobId: requestId }, init.method === 'POST' ? 202 : 200 );
		} );
		vi.stubGlobal( 'fetch', fetcher );
		const task = dispatchAgentSendTo( { id: 9, name: 'SEO Medic', description: '', avatarUrl: '' }, { kind: 'post', id: 12, title: 'Test post' }, rest );
		await vi.advanceTimersByTimeAsync( 31000 );
		const transcript = agentsChatStore.state.transcripts[ 9 ];
		expect( transcript[ 1 ].pending ).toBe( true );
		expect( transcript[ 1 ].text ).toContain( 'background' );
		await vi.advanceTimersByTimeAsync( 20000 );
		await task;
		expect( transcript[ 1 ].pending ).toBe( false );
		expect( transcript[ 1 ].text ).toBe( result.text );
		expect( transcript[ 1 ].role ).toBe( 'agent' );
	} );

	test( 'status reads hand progress to onStatus, and a failed job rejects with its progress', async () => {
		const ran = progress( searched );
		const fetcher = vi.fn()
			.mockResolvedValueOnce( response( job( 'queued' ), 202 ) )
			.mockResolvedValueOnce( response( { ...job( 'running' ), progress: ran } ) )
			.mockResolvedValueOnce( response( { ...job( 'failed' ), error: { code: 'qa_fail', message: 'QA forced failure' }, progress: ran } ) );
		vi.stubGlobal( 'fetch', fetcher );
		const status = vi.fn();
		const task = runAgentJob( 9, input, rest, id, status ).catch( ( error: unknown ) => error );
		await vi.advanceTimersByTimeAsync( 30000 );
		const error = await task;
		expect( status ).toHaveBeenCalledWith( 'running', ran );
		expect( error ).toBeInstanceOf( JobRequestError );
		expect( ( error as JobRequestError ).message ).toBe( 'QA forced failure' );
		expect( ( error as JobRequestError ).progress ).toEqual( ran );
	} );

	test( 'Send to shows progress on the pending row and keeps it on the error row', async () => {
		let requestId = '';
		let polls = 0;
		agentsChatStore.state.transcripts = {};
		const fetcher = vi.fn( async ( url: string, init: RequestInit ) => {
			if ( url.includes( '/conversations' ) ) return response( { id: 7 } );
			if ( init.method === 'POST' ) {
				requestId = JSON.parse( String( init.body ) ).requestId;
				return response( { ...job( 'queued' ), jobId: requestId }, 202 );
			}
			return ++polls === 1
				? response( { ...job( 'running' ), jobId: requestId, progress: progress( searched ) } )
				: response( { ...job( 'failed' ), jobId: requestId, error: { code: 'qa_fail', message: 'QA forced failure' }, progress: progress( searched, { ...searched, error: 'Not found.' } ) } );
		} );
		vi.stubGlobal( 'fetch', fetcher );
		const task = dispatchAgentSendTo( { id: 9, name: 'SEO Medic', description: '', avatarUrl: '' }, { kind: 'post', id: 12, title: 'Test post' }, rest );
		await vi.advanceTimersByTimeAsync( 3100 );
		const row = agentsChatStore.state.transcripts[ 9 ][ 1 ];
		expect( row.pending ).toBe( true );
		expect( row.toolCalls ).toEqual( [ { callId: '', ...searched, output: null } ] );
		await vi.advanceTimersByTimeAsync( 10000 );
		await task;
		expect( row.role ).toBe( 'error' );
		expect( row.text ).toBe( 'QA forced failure' );
		expect( row.toolCalls?.map( ( call ) => call.error ) ).toEqual( [ null, 'Not found.' ] );
	} );

	test( 'Send to saves the pending row and its job id once the job is accepted', async () => {
		let requestId = '';
		let completed = false;
		const saves: Array< { method: string; url: string; messages: Array< Record< string, unknown > > } > = [];
		agentsChatStore.state.transcripts = {};
		agentsChatStore.state.conversationIds = {};
		const fetcher = vi.fn( async ( url: string, init: RequestInit ) => {
			if ( url.includes( '/conversations' ) ) {
				saves.push( { method: String( init.method ), url, messages: JSON.parse( String( init.body ) ).messages } );
				return response( { id: 7 } );
			}
			if ( init.method === 'POST' ) {
				requestId = JSON.parse( String( init.body ) ).requestId;
				return response( { ...job( 'queued' ), jobId: requestId }, 202 );
			}
			completed = true;
			return response( { ...job( 'completed' ), jobId: requestId } );
		} );
		vi.stubGlobal( 'fetch', fetcher );
		const task = dispatchAgentSendTo( { id: 9, name: 'SEO Medic', description: '', avatarUrl: '' }, { kind: 'post', id: 12, title: 'Test post' }, rest );
		await vi.advanceTimersByTimeAsync( 100 );
		expect( completed ).toBe( false );
		expect( saves ).toHaveLength( 1 );
		expect( saves[ 0 ].method ).toBe( 'POST' );
		expect( saves[ 0 ].messages[ 0 ] ).toMatchObject( { role: 'user', attachment: { kind: 'post', id: 12 } } );
		expect( saves[ 0 ].messages[ 1 ] ).toMatchObject( { role: 'agent', pending: true, jobId: requestId } );
		expect( requestId ).toMatch( /^[a-f0-9-]{36}$/ );
		await vi.advanceTimersByTimeAsync( 5000 );
		await task;
		await vi.advanceTimersByTimeAsync( 0 );
		// The final save replaces the one the accepted job created.
		expect( saves ).toHaveLength( 2 );
		expect( saves[ 1 ].method ).toBe( 'PUT' );
		expect( saves[ 1 ].url ).toMatch( /\/conversations\/7$/ );
		expect( saves[ 1 ].messages[ 1 ] ).toEqual( expect.objectContaining( { role: 'agent', text: result.text, pending: false } ) );
		expect( saves[ 1 ].messages[ 1 ] ).not.toHaveProperty( 'jobId' );
	} );

	test( 'resuming a saved pending row only reads the job status, then saves the answer', async () => {
		agentsChatStore.state.transcripts = {
			9: [
				{ role: 'user', text: 'Check SEO', at: 1 },
				{ role: 'agent', text: 'Queued', at: 2, pending: true, jobId: id },
			],
		};
		agentsChatStore.state.conversationIds = { 9: 7 };
		const fetcher = vi.fn( async ( url: string ) => {
			if ( url.includes( '/conversations' ) ) return response( { id: 7 } );
			return response( fetcher.mock.calls.length < 2 ? { ...job( 'running' ), progress: progress( searched ) } : job( 'completed' ) );
		} );
		vi.stubGlobal( 'fetch', fetcher );
		const task = resumeAgentJobIntoTranscript( { id: 9, name: 'SEO Medic', description: '', avatarUrl: '' }, rest );
		await vi.advanceTimersByTimeAsync( 100 );
		const row = agentsChatStore.state.transcripts[ 9 ][ 1 ];
		expect( row.pending ).toBe( true );
		expect( row.text ).toContain( 'background' );
		expect( row.toolCalls ).toEqual( [ { callId: '', ...searched, output: null } ] );
		await vi.advanceTimersByTimeAsync( 5000 );
		await task;
		expect( row ).toMatchObject( { role: 'agent', text: result.text, pending: false } );
		expect( row ).not.toHaveProperty( 'jobId' );
		const calls = fetcher.mock.calls.map( ( [ url, init ] ) => [ init.method, url ] );
		expect( calls.filter( ( [ , url ] ) => url.includes( '/invoke' ) ) ).toEqual( [] );
		expect( calls.slice( 0, 2 ) ).toEqual( [
			[ 'GET', `${ rest.restRoot }desktop-mode/v1/agents/9/jobs/${ id }` ],
			[ 'GET', `${ rest.restRoot }desktop-mode/v1/agents/9/jobs/${ id }` ],
		] );
		expect( calls[ 2 ] ).toEqual( [ 'PUT', `${ rest.restRoot }desktop-mode/v1/agents/conversations/7` ] );
	} );

	test( 'resuming a job the server no longer knows settles as an error row and saves it', async () => {
		agentsChatStore.state.transcripts = {
			9: [
				{ role: 'user', text: 'Check SEO', at: 1 },
				{ role: 'agent', text: 'Queued', at: 2, pending: true, jobId: id },
			],
		};
		agentsChatStore.state.conversationIds = { 9: 7 };
		const fetcher = vi.fn( async ( url: string ) => url.includes( '/conversations' )
			? response( { id: 7 } )
			: response( { code: 'openstation_agent_job_not_found', message: 'Agent job not found.' }, 404 ) );
		vi.stubGlobal( 'fetch', fetcher );
		await resumeAgentJobIntoTranscript( { id: 9, name: 'SEO Medic', description: '', avatarUrl: '' }, rest );
		await vi.advanceTimersByTimeAsync( 0 );
		const gone = 'The result of this run is no longer available. Some work may already have been applied. Check the site before submitting the task again.';
		expect( agentsChatStore.state.transcripts[ 9 ][ 1 ] ).toMatchObject( { role: 'error', text: gone, pending: false } );
		const save = fetcher.mock.calls.find( ( [ url ] ) => url.includes( '/conversations/7' ) );
		const saved = JSON.parse( String( save?.[ 1 ].body ) ).messages[ 1 ];
		expect( saved ).toMatchObject( { role: 'error', text: gone, pending: false } );
		expect( saved ).not.toHaveProperty( 'jobId' );
	} );

	test( 'an individual hung poll times out and recovers without another POST', async () => {
		const fetcher = vi.fn()
			.mockResolvedValueOnce( response( job( 'queued' ), 202 ) )
			.mockImplementationOnce( ( _url: string, init: RequestInit ) => new Promise( ( _resolve, reject ) => {
				init.signal?.addEventListener( 'abort', () => reject( new DOMException( 'Aborted', 'AbortError' ) ) );
			} ) )
			.mockResolvedValueOnce( response( job( 'completed' ) ) );
		vi.stubGlobal( 'fetch', fetcher );
		const task = runAgentJob( 9, input, rest, id );
		await vi.advanceTimersByTimeAsync( 30000 );
		await expect( task ).resolves.toEqual( result );
		expect( fetcher.mock.calls.map( ( [ , init ] ) => init.method ) ).toEqual( [ 'POST', 'GET', 'GET' ] );
	} );

	test( 'hidden tabs use at least fifteen seconds between reads', async () => {
		vi.spyOn( document, 'hidden', 'get' ).mockReturnValue( true );
		const fetcher = vi.fn().mockResolvedValueOnce( response( job( 'queued' ), 202 ) ).mockResolvedValueOnce( response( job( 'completed' ) ) );
		vi.stubGlobal( 'fetch', fetcher );
		const pending = runAgentJob( 9, input, rest, id );
		await vi.advanceTimersByTimeAsync( 14999 );
		expect( fetcher ).toHaveBeenCalledTimes( 1 );
		await vi.advanceTimersByTimeAsync( 1 );
		await expect( pending ).resolves.toEqual( result );
	} );
} );
