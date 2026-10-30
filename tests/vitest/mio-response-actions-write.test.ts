import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MioSession } from '../../src/mio/assistant/session';
import { mountMioChat } from '../../src/mio/assistant/chat';
import type { MioOperation, MioOperationOutcome, MioResponseAction, MioResponseActionContext, MioTurn, MioTurnRequest, MioWindowContext } from '../../src/mio/assistant/types';

const flush = async () => { for ( let i = 0; i < 12; i++ ) { await Promise.resolve(); } };
// A real click is the only trusted source; the shell reads nothing but this flag.
const trusted = { isTrusted: true } as Event;
const confirmed: MioOperationOutcome = { effect: 'write', status: 'confirmed', receipt: 'form-42@7' };
const apply = ( overrides: Partial<MioResponseAction> = {} ): MioResponseAction => ( { id: 'apply', label: "Apply MIO's changes", effect: 'write', group: 'conflict', emphasis: 'primary', description: 'Applying replaces the edits you made since MIO started.', run: vi.fn( async () => confirmed ), ...overrides } );
const keep = ( overrides: Partial<MioResponseAction> = {} ): MioResponseAction => ( { id: 'keep', label: 'Keep my edits', effect: 'read', group: 'conflict', run: vi.fn(), ...overrides } );
const final: MioTurn = { message: 'The form changed while I was working. Apply my changes over yours, or keep your edits?', calls: [] };

function setup( actions: () => MioResponseAction[], extra: Partial<MioWindowContext> = {} ) {
	const transport = vi.fn( async ( _request: MioTurnRequest, _signal: AbortSignal ) => final );
	const context: MioWindowContext = { host: document.body, title: 'Forms', windowId: 'forms-1', revision: () => 'rev-9', prompt: () => 'Edit forms', documents: [], abilities: () => [], responseActions: actions, ...extra };
	const session = new MioSession( context, transport, () => true );
	return { session, transport, context };
}
const last = ( session: MioSession ) => session.conversation.read().at( -1 )!;
const ids = ( session: MioSession, message = last( session ) ) => message.actionIds!;
const click = ( session: MioSession, index: number, event: Event | undefined = trusted, message = last( session ) ) =>
	session.responseActions.run( message.id!, ids( session, message )[ index ], event );
const views = ( session: MioSession, message = last( session ) ) => session.responseActions.list( message );
const responseOps = ( session: MioSession ) => session.operations.list().filter( ( op ) => op.source === 'response-action' );

beforeEach( () => { vi.stubGlobal( 'ResizeObserver', class { observe() {} disconnect() {} } ); } );
afterEach( () => { vi.unstubAllGlobals(); document.body.innerHTML = ''; vi.restoreAllMocks(); } );

test( 'a write descriptor is kept, a second write on the same message is dropped, reads are unaffected', async () => {
	const { session } = setup( () => [ apply(), apply( { id: 'apply-again', label: 'Apply again' } ), keep() ] );
	await session.ask( 'Update the form' );
	expect( views( session ).map( ( view ) => [ view.label, view.effect ] ) ).toEqual( [ [ "Apply MIO's changes", 'write' ], [ 'Keep my edits', 'read' ] ] );
} );

test( 'a write runs only from a trusted click; programmatic, synthetic and render calls do nothing', async () => {
	const run = vi.fn( async () => confirmed );
	const allowed = vi.fn( () => true );
	const { session } = setup( () => [ apply( { run, allowed } ) ] );
	await session.ask( 'Update the form' );
	const chat = mountMioChat( document.body, 'Forms', session, vi.fn() );
	await session.responseActions.run( last( session ).id!, ids( session )[ 0 ] );
	await click( session, 0, new MouseEvent( 'click' ) );
	document.querySelector<HTMLElement>( '[data-mio-action]' )!.click(); await flush();
	views( session ); expect( allowed ).toHaveBeenCalled();
	expect( run ).not.toHaveBeenCalled(); expect( responseOps( session ) ).toEqual( [] );
	await click( session, 0 );
	expect( run ).toHaveBeenCalledOnce();
	chat.destroy();
} );

test( 'confirmed retires the whole group and records a confirmed ledger entry with its receipt', async () => {
	const onOperation = vi.fn();
	const { session, transport } = setup( () => [ apply(), keep() ], { onOperation } );
	await session.ask( 'Update the form' );
	expect( responseOps( session ) ).toEqual( [] );
	await click( session, 0 );
	expect( views( session ) ).toEqual( [ expect.objectContaining( { label: "Apply MIO's changes", status: 'Done.', available: false } ) ] );
	const [ op ] = responseOps( session );
	expect( op ).toMatchObject( { ability: 'response:apply', source: 'response-action', effect: 'write', status: 'confirmed', receipt: 'form-42@7', windowId: 'forms-1', revision: 'rev-9' } );
	expect( onOperation.mock.calls.map( ( [ entry ]: [ MioOperation ] ) => entry.status ) ).toEqual( [ 'running', 'confirmed' ] );
	// No model round: the click never reaches the provider.
	expect( transport ).toHaveBeenCalledOnce();
	await click( session, 0 ); expect( responseOps( session ) ).toHaveLength( 1 );
} );

test( 'a retryable rejection allows another deliberate click with the same idempotency key', async () => {
	const contexts: MioResponseActionContext[] = [];
	const outcomes: MioOperationOutcome[] = [ { effect: 'none', status: 'rejected', errors: [ { code: 'conflict', path: '$', message: 'The form changed again.' } ], retryable: true }, confirmed ];
	const { session, transport } = setup( () => [ apply( { run: async ( context ) => { contexts.push( context ); return outcomes.shift(); } } ), keep() ] );
	await session.ask( 'Update the form' );
	await click( session, 0 );
	expect( views( session )[ 0 ] ).toMatchObject( { status: 'The form changed again.', available: true } );
	expect( views( session ) ).toHaveLength( 2 ); // A rejection leaves the group open.
	await click( session, 0 );
	expect( contexts ).toHaveLength( 2 );
	expect( contexts[ 1 ].idempotencyKey ).toBe( contexts[ 0 ].idempotencyKey );
	expect( contexts[ 1 ].callId ).not.toBe( contexts[ 0 ].callId );
	expect( responseOps( session ).map( ( op ) => op.status ) ).toEqual( [ 'rejected', 'confirmed' ] );
	// One choice, one record: the confirmation replaces the rejection.
	await session.ask( 'Is it saved?' );
	expect( JSON.parse( transport.mock.calls.at( -1 )![ 0 ].transcript ).outcomes ).toEqual( [ { source: 'response-action', label: "Apply MIO's changes", effect: 'write', status: 'confirmed' } ] );
} );

test( 'a terminal rejection retires the button', async () => {
	const { session } = setup( () => [ apply( { run: async () => ( { effect: 'none', status: 'rejected', errors: [ { code: 'gone', path: '$', message: 'The form was deleted.' } ], retryable: false } ) } ) ] );
	await session.ask( 'Update the form' ); await click( session, 0 );
	expect( views( session )[ 0 ] ).toMatchObject( { status: 'The form was deleted.', available: false } );
} );

test.each( [
	[ 'a throw', async () => { throw new Error( 'Network down' ); } ],
	[ 'a missing outcome', async () => undefined ],
	[ 'a malformed outcome', async () => ( { effect: 'write', status: 'confirmed', receipt: '' } ) ],
	[ 'an unknown outcome', async () => ( { effect: 'write', status: 'unknown' } ) ],
	[ 'a read-style completion', async () => ( { effect: 'none', status: 'completed' } ) ],
] )( '%s is recorded as unknown and retires the button', async ( _name, run ) => {
	const { session } = setup( () => [ apply( { run: run as MioResponseAction['run'] } ), keep() ] );
	await session.ask( 'Update the form' ); await click( session, 0 );
	expect( views( session )[ 0 ] ).toMatchObject( { status: 'Could not confirm the result. Check before trying again.', available: false } );
	expect( responseOps( session ).map( ( op ) => op.status ) ).toEqual( [ 'unknown' ] );
	await click( session, 0 ); expect( responseOps( session ) ).toHaveLength( 1 );
} );

test( 'a write on an older message is retired when a new user message is sent', async () => {
	const run = vi.fn( async () => confirmed );
	const { session } = setup( () => [ apply( { run } ) ] );
	await session.ask( 'Update the form' ); const old = last( session );
	await session.ask( 'Actually, what changed?' );
	expect( views( session, old ) ).toEqual( [ expect.objectContaining( { status: 'No longer available.', available: false } ) ] );
	await click( session, 0, trusted, old ); expect( run ).not.toHaveBeenCalled();
	// The newest message's own write is still live.
	expect( views( session )[ 0 ].available ).toBe( true );
} );

test( 'a new user message retires the whole choice, not just the write', async () => {
	const kept = vi.fn();
	const { session } = setup( () => [ apply(), keep( { run: kept } ), { id: 'help', label: 'Open help', effect: 'navigate', run: vi.fn() } ] );
	await session.ask( 'Update the form' ); const old = last( session );
	await session.ask( 'Actually, what changed?' );
	expect( views( session, old ).map( ( view ) => [ view.label, view.available, view.status ] ) ).toEqual( [
		[ "Apply MIO's changes", false, 'No longer available.' ],
		[ 'Keep my edits', false, 'No longer available.' ],
		[ 'Open help', true, '' ], // Outside the group: unaffected.
	] );
	await click( session, 1, trusted, old ); expect( kept ).not.toHaveBeenCalled();
} );

test( 'closing the chat mid-write keeps the pending entry and shows the late outcome on reopen', async () => {
	let signal!: AbortSignal; let settle!: ( outcome: MioOperationOutcome ) => void;
	const { session } = setup( () => [ apply( { run: ( context ) => { signal = context.signal; return new Promise( ( resolve ) => { settle = resolve; } ); } } ) ] );
	await session.ask( 'Update the form' );
	const chat = mountMioChat( document.body, 'Forms', session, vi.fn() );
	const pending = click( session, 0 ); chat.destroy();
	expect( signal.aborted ).toBe( true );
	expect( responseOps( session )[ 0 ].status ).toBe( 'running' );
	expect( views( session )[ 0 ].pending ).toBe( true );
	settle( confirmed ); await pending;
	const reopened = mountMioChat( document.body, 'Forms', session, vi.fn() ); await flush();
	expect( responseOps( session )[ 0 ] ).toMatchObject( { status: 'confirmed', receipt: 'form-42@7' } );
	expect( document.querySelector( '.os-mio-chat__action-status' )?.textContent ).toBe( 'Done.' );
	reopened.destroy();
} );

test( 'disposing the lease while a write is pending marks it unknown, and a late outcome cannot change that', async () => {
	let settle!: ( outcome: MioOperationOutcome ) => void;
	const onOperation = vi.fn();
	const { session } = setup( () => [ apply( { run: () => new Promise( ( resolve ) => { settle = resolve; } ) } ) ], { onOperation } );
	await session.ask( 'Update the form' );
	const pending = click( session, 0 ); session.dispose();
	expect( responseOps( session )[ 0 ].status ).toBe( 'unknown' );
	settle( confirmed ); await pending;
	expect( responseOps( session )[ 0 ].status ).toBe( 'unknown' );
	expect( onOperation ).toHaveBeenCalledTimes( 2 );
} );

test( 'within a group a pending action disables its siblings, and a completed Keep retires Apply', async () => {
	let settle!: () => void;
	const write = vi.fn( async () => confirmed );
	const { session } = setup( () => [ apply( { run: write } ), keep( { run: () => new Promise<void>( ( resolve ) => { settle = resolve; } ) } ) ] );
	await session.ask( 'Update the form' );
	const pending = click( session, 1 );
	expect( views( session ).map( ( view ) => [ view.label, view.available, view.pending ] ) ).toEqual( [ [ "Apply MIO's changes", false, false ], [ 'Keep my edits', true, true ] ] );
	await click( session, 0 ); expect( write ).not.toHaveBeenCalled();
	settle(); await pending;
	expect( views( session ) ).toEqual( [ expect.objectContaining( { label: 'Keep my edits', status: 'Done.', available: false } ) ] );
	await click( session, 0 ); expect( write ).not.toHaveBeenCalled();
	expect( responseOps( session ) ).toEqual( [] ); // A read writes nothing to the ledger.
} );

test( 'a Keep that throws leaves the group open', async () => {
	const { session } = setup( () => [ apply(), keep( { run: () => { throw new Error( 'Draft lost' ); } } ) ] );
	await session.ask( 'Update the form' ); await click( session, 1 );
	expect( views( session ).map( ( view ) => view.available ) ).toEqual( [ true, true ] );
} );

test( 'the next turn history carries a shell-authored record of the choice and nothing executable', async () => {
	const { session, transport } = setup( () => [ apply(), keep() ] );
	await session.ask( 'Update the form' ); await click( session, 0 );
	await session.ask( 'Is it saved?' );
	const transcript = transport.mock.calls.at( -1 )![ 0 ].transcript;
	expect( JSON.parse( transcript ).outcomes ).toEqual( [ { source: 'response-action', label: "Apply MIO's changes", effect: 'write', status: 'confirmed' } ] );
	expect( transcript ).not.toContain( 'form-42@7' );
	expect( transcript ).not.toContain( ids( session, session.conversation.read().at( -3 ) )[ 0 ] );
	// Reported once: the turn after does not repeat it.
	await session.ask( 'Thanks' );
	expect( JSON.parse( transport.mock.calls.at( -1 )![ 0 ].transcript ).outcomes ).toEqual( [] );
} );

test( 'inspectOperation reconciles an unknown response-action write through operationStatus', async () => {
	const operationStatus = vi.fn( async ( _operation: MioOperation ) => confirmed );
	const { session } = setup( () => [ apply( { run: async () => ( { effect: 'write', status: 'unknown' } ) } ) ], { operationStatus } );
	await session.ask( 'Update the form' ); await click( session, 0 );
	const [ op ] = responseOps( session );
	await expect( session.operations.inspect( op.callId, new AbortController().signal ) ).resolves.toMatchObject( { status: 'confirmed', receipt: 'form-42@7', source: 'response-action' } );
	expect( operationStatus.mock.calls[ 0 ][ 0 ] ).toMatchObject( { ability: 'response:apply', idempotencyKey: op.idempotencyKey } );
} );

test( 'one description per message renders below the row and is announced with the button that owns it', async () => {
	const { session } = setup( () => [ apply(), keep( { description: 'A second description is dropped.' } ) ] );
	await session.ask( 'Update the form' );
	const chat = mountMioChat( document.body, 'Forms', session, vi.fn() ); await flush();
	const row = document.querySelector( '.os-mio-chat__actions' )!;
	const descriptions = row.querySelectorAll( '.os-mio-chat__action-description' );
	expect( descriptions ).toHaveLength( 1 );
	expect( descriptions[ 0 ].textContent ).toBe( 'Applying replaces the edits you made since MIO started.' );
	expect( row.lastElementChild ).toBe( descriptions[ 0 ] );
	const [ write, read ] = row.querySelectorAll( '[data-mio-action]' );
	expect( write.getAttribute( 'aria-description' ) ).toBe( 'Applying replaces the edits you made since MIO started.' );
	expect( read.hasAttribute( 'aria-description' ) ).toBe( false );
	expect( views( session )[ 1 ].description ).toBeUndefined();
	// Once the choice is made, the warning is history and goes away.
	await click( session, 0 ); await flush();
	expect( row.querySelector( '.os-mio-chat__action-description' ) ).toBeNull();
	expect( write.hasAttribute( 'aria-description' ) ).toBe( false );
	chat.destroy();
} );

test( 'a read or navigate action can own the description, and announces it', async () => {
	const { session } = setup( () => [ keep( { description: 'Discards the draft MIO prepared.' } ) ] );
	await session.ask( 'Update the form' );
	const chat = mountMioChat( document.body, 'Forms', session, vi.fn() ); await flush();
	expect( document.querySelector( '[data-mio-action]' )!.getAttribute( 'aria-description' ) ).toBe( 'Discards the draft MIO prepared.' );
	chat.destroy();
} );

test.each( [
	[ 'the prompt hook throws', { prompt: () => { throw new Error( 'Prompt unavailable' ); } } ],
	[ 'the request is over budget', { prompt: () => 'x'.repeat( 2_000_000 ) } ],
] )( 'a choice survives a next turn that fails before the provider answers (%s)', async ( _name, failing ) => {
	const { session, transport, context } = setup( () => [ apply(), keep() ] );
	await session.ask( 'Update the form' ); await click( session, 0 );
	const prompt = context.prompt; Object.assign( context, failing );
	await expect( session.ask( 'Is it saved?' ) ).rejects.toThrow();
	context.prompt = prompt;
	await session.ask( 'Is it saved now?' );
	expect( JSON.parse( transport.mock.calls.at( -1 )![ 0 ].transcript ).outcomes ).toEqual( [ { source: 'response-action', label: "Apply MIO's changes", effect: 'write', status: 'confirmed' } ] );
} );

test( 'a choice survives a next turn stopped before the provider answers', async () => {
	const { session, transport } = setup( () => [ apply(), keep() ] );
	await session.ask( 'Update the form' ); await click( session, 0 );
	transport.mockImplementationOnce( ( _request, signal ) => new Promise( ( _resolve, reject ) => { signal.addEventListener( 'abort', () => reject( new DOMException( 'Stopped', 'AbortError' ) ) ); } ) );
	const stopped = session.ask( 'Is it saved?' ); await flush(); session.cancel();
	await expect( stopped ).rejects.toThrow();
	await session.ask( 'Is it saved now?' );
	expect( JSON.parse( transport.mock.calls.at( -1 )![ 0 ].transcript ).outcomes ).toHaveLength( 1 );
} );

test( 'a grouped read stopped mid-way leaves the group open', async () => {
	const { session } = setup( () => [ apply(), keep( { run: ( { signal } ) => new Promise<void>( ( _resolve, reject ) => { signal.addEventListener( 'abort', () => reject( signal.reason ) ); } ) } ) ] );
	await session.ask( 'Update the form' );
	const pending = click( session, 1 ); session.cancel(); await pending;
	expect( views( session ).map( ( view ) => [ view.label, view.available, view.status ] ) ).toEqual( [ [ "Apply MIO's changes", true, '' ], [ 'Keep my edits', true, '' ] ] );
} );

test( 'ability writes keep their source', async () => {
	const turns: MioTurn[] = [ { message: '', calls: [ { name: 'save', arguments: '{}' } ] }, final ];
	const context: MioWindowContext = { host: document.body, title: 'Forms', prompt: () => 'Edit forms', documents: [], abilities: () => [ { name: 'save', effect: 'write', description: 'Save', parameters: {}, validate: () => true, run: async () => confirmed } ] };
	const session = new MioSession( context, async () => turns.shift() ?? final, () => true );
	await session.ask( 'Save' );
	expect( session.operations.list()[ 0 ] ).toMatchObject( { ability: 'save', source: 'ability', status: 'confirmed' } );
} );
