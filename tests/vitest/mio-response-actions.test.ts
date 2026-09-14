import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { MioSession, memoryMioConversation } from '../../src/mio/assistant/session';
import { mountMioChat } from '../../src/mio/assistant/chat';
import type { MioAbility, MioChatMessage, MioResponseAction, MioResponseContext, MioTurn, MioTurnRequest, MioWindowContext } from '../../src/mio/assistant/types';

const flush = async () => { for ( let i = 0; i < 12; i++ ) { await Promise.resolve(); } };
const action = ( overrides: Partial<MioResponseAction> = {} ): MioResponseAction => ( { id: 'preview', label: 'Preview', effect: 'navigate', run: vi.fn(), ...overrides } );
const save = ( overrides: Partial<MioAbility> = {} ): MioAbility => ( { name: 'save', effect: 'write', description: 'Save draft', parameters: {}, validate: () => true, run: async () => ( { effect: 'write', status: 'confirmed', receipt: 'receipt-42' } ), ...overrides } );
const final: MioTurn = { message: 'Saved as draft.', calls: [] };
function setup( responseActions?: MioWindowContext['responseActions'], turns = [ final ], abilities: MioAbility[] = [] ) {
	const transport = vi.fn( async ( _request: MioTurnRequest, _signal: AbortSignal ) => turns.shift() ?? final );
	const context: MioWindowContext = { host: document.body, title: 'Editor', prompt: () => 'Edit forms', documents: [], abilities: () => abilities, responseActions };
	const session = new MioSession( context, transport, () => true );
	return { session, transport, context };
}
const last = ( session: MioSession ) => session.conversation.read().at( -1 )!;
const run = ( session: MioSession, message = last( session ) ) => session.responseActions.run( message.id!, message.actionIds![ 0 ] );
beforeEach( () => { vi.stubGlobal( 'ResizeObserver', class { observe() {} disconnect() {} } ); } );

afterEach( () => { vi.unstubAllGlobals(); document.body.innerHTML = ''; vi.restoreAllMocks(); } );

test( 'confirmed receipt binds Preview to its original form; clicks do not call the provider or save again', async () => {
	let selected = 42;
	const savedForms = new Map( [ [ 'receipt-42', 42 ] ] );
	const preview = vi.fn(); const ability = save(); const write = vi.spyOn( ability, 'run' );
	let received!: MioResponseContext;
	const { session, transport } = setup( context => {
		received = context;
		const operation = context.operations.find( op => op.status === 'confirmed' && op.receipt );
		if ( context.summary.status !== 'completed' || context.summary.unknownWrites || ! operation ) { return []; }
		const formId = savedForms.get( operation.receipt! );
		return [ action( { run: () => { preview( formId ); } } ) ];
	}, [ { message: '', calls: [ { name: 'save', arguments: '{}' } ] }, final ], [ ability ] );
	await session.ask( 'Create this form' ); const message = last( session );
	expect( Object.isFrozen( received.operations ) ).toBe( true );
	expect( Object.isFrozen( received.operations[ 0 ] ) ).toBe( true );
	expect( Object.isFrozen( received.summary ) ).toBe( true );
	expect( received.summary.confirmedWrites ).toBe( 1 );
	expect( message.actionIds![ 0 ] ).not.toBe( 'preview' );
	selected = 77; await run( session, message ); await run( session, message );
	expect( selected ).toBe( 77 ); expect( preview.mock.calls ).toEqual( [ [ 42 ], [ 42 ] ] );
	expect( transport ).toHaveBeenCalledTimes( 2 ); expect( write ).toHaveBeenCalledOnce();
	await session.ask( 'Explain it' );
	const transcript = JSON.parse( transport.mock.calls.at( -1 )![ 0 ]?.transcript ?? '{}' );
	expect( JSON.stringify( transcript ) ).not.toContain( message.actionIds![ 0 ] );
	expect( transcript.messages.every( ( m: MioChatMessage ) => ! m.id && ! m.actionIds ) ).toBe( true );
	expect( received.operations ).toEqual( [] ); // Second turn only.
} );

test.each( [ 'validation', 'unknown' ] )( '%s failure does not offer a success action', async kind => {
	const descriptor = vi.fn( ( context: MioResponseContext ) => context.summary.status === 'completed' && ! context.summary.unknownWrites ? [ action() ] : [] );
	const call: MioTurn = { message: '', calls: [ { name: 'save', arguments: '{}' } ] };
	const ability = kind === 'validation' ? save( { validate: () => false } ) : save( { run: () => ( { effect: 'write', status: 'unknown' } ) } );
	const { session } = setup( descriptor, [ call, call, call ], [ ability ] );
	await expect( session.ask( 'Save' ) ).rejects.toThrow();
	expect( descriptor ).toHaveBeenCalledOnce();
	expect( last( session ).actionIds ).toBeUndefined();
} );

test( 'a failing response callback cannot change an authoritative save into failure', async () => {
	const { session } = setup( () => { throw new Error( 'Adapter broke' ); }, [ { message: '', calls: [ { name: 'save', arguments: '{}' } ] }, final ], [ save() ] );
	await expect( session.ask( 'Save' ) ).resolves.toBe( final.message );
	expect( last( session ).text ).toBe( final.message );
	expect( session.operations.list()[ 0 ].status ).toBe( 'confirmed' );
} );

test( 'invalid descriptors are omitted independently, capped at three with one primary', async () => {
	const bad: unknown[] = [ null, {}, action( { id: '' } ), action( { label: 'x'.repeat( 41 ) } ), action( { ariaLabel: 'x'.repeat( 161 ) } ), action( { effect: 'write' as never } ), action( { run: 'javascript:evil' as never } ), action( { allowed: true as never } ), action( { emphasis: 'danger' as never } ) ];
	const { session } = setup( () => [ ...bad, action( { emphasis: 'primary', icon: '<svg>' } ), action(), action( { id: 'two', emphasis: 'primary' } ), action( { id: 'three' } ), action( { id: 'four' } ) ] as MioResponseAction[] );
	await session.ask( 'Help' );
	const views = session.responseActions.list( last( session ) );
	expect( views ).toHaveLength( 3 ); expect( views.map( v => v.emphasis ) ).toEqual( [ 'primary', 'secondary', 'secondary' ] );
	expect( views[ 0 ].icon ).toBeUndefined();
} );

test( 'duplicate clicks are single flight and a later deliberate click retries a local error', async () => {
	let reject!: ( error: Error ) => void;
	const execute = vi.fn( () => new Promise<void>( ( _, fail ) => { reject = fail; } ) );
	const { session, transport } = setup( () => [ action( { run: execute } ) ] );
	await session.ask( 'Help' ); const saved = last( session ).text;
	const first = run( session ); await run( session );
	expect( execute ).toHaveBeenCalledOnce(); expect( session.responseActions.list( last( session ) )[ 0 ].pending ).toBe( true );
	reject( new Error( 'Form was deleted.' ) ); await first;
	expect( session.responseActions.list( last( session ) )[ 0 ].status ).toBe( 'Form was deleted.' );
	expect( last( session ).text ).toBe( saved ); expect( transport ).toHaveBeenCalledOnce();
	execute.mockImplementation( async () => {} ); await run( session ); expect( execute ).toHaveBeenCalledTimes( 2 );
} );

test( 'permission is rechecked on render and click; revoked permissions never navigate', async () => {
	let allowed = true; const execute = vi.fn();
	const { session } = setup( () => [ action( { allowed: () => allowed, run: execute } ) ] );
	await session.ask( 'Help' ); const message = last( session );
	expect( session.responseActions.list( message ) ).toHaveLength( 1 );
	allowed = false; expect( session.responseActions.list( message ) ).toHaveLength( 0 );
	await run( session ); expect( execute ).not.toHaveBeenCalled();
	expect( session.responseActions.list( message )[ 0 ] ).toMatchObject( { available: false, status: 'This action is no longer available.' } );
} );

test( 'closing cancels pending work; reopening retains callbacks; disposal removes them forever', async () => {
	let signal!: AbortSignal; let settle!: () => void;
	const execute = vi.fn( context => { signal = context.signal; return new Promise<void>( resolve => { settle = resolve; } ); } );
	const { session } = setup( () => [ action( { run: execute } ) ] );
	await session.ask( 'Help' ); const message = last( session );
	const chat = mountMioChat( document.body, 'Editor', session, vi.fn() );
	const pending = run( session ); chat.destroy(); expect( signal.aborted ).toBe( true );
	const reopened = mountMioChat( document.body, 'Editor', session, vi.fn() );
	await run( session ); expect( execute ).toHaveBeenCalledOnce(); // Still in flight, even if the app ignores abort.
	settle(); await pending;
	expect( document.querySelector( '[data-mio-action]' ) ).not.toBeNull();
	reopened.destroy(); session.dispose();
	await run( session, message ); expect( execute ).toHaveBeenCalledOnce();
	expect( session.responseActions.list( message ) ).toEqual( [] );
} );

test( 'successful navigation can focus another window and abort chat without reporting failure', async () => {
	let active = true;
	const { session } = setup( () => [ action( { run: () => { active = false; session.cancel(); } } ) ] );
	await session.ask( 'Help' ); await run( session );
	expect( active ).toBe( false ); expect( session.responseActions.list( last( session ) )[ 0 ].status ).toBe( 'Done.' );
} );

test( 'eviction and a restored custom conversation cannot revive callbacks', async () => {
	const execute = vi.fn(); const { session, context, transport } = setup( () => [ action( { run: execute } ) ] );
	await session.ask( 'Help' ); const old = last( session );
	const snapshot = JSON.parse( JSON.stringify( session.conversation.read() ) );
	const store = memoryMioConversation(); store.write( snapshot );
	const restored = new MioSession( context, transport, () => true, store );
	expect( restored.responseActions.list( old ) ).toEqual( [] ); await run( restored, old );
	session.conversation.write( [] ); session.responseActions.prune(); session.conversation.write( snapshot );
	await run( session, old ); expect( execute ).not.toHaveBeenCalled();
	await session.ask( 'New' ); const oldest = last( session );
	for ( let i = 0; i < 21; i++ ) { await session.ask( 'Next' ); }
	await run( session, oldest ); expect( execute ).not.toHaveBeenCalled();
	expect( session.conversation.read() ).toHaveLength( 40 );
} );

test( 'callback declarations are resolved once and their metadata cannot be changed afterwards', async () => {
	const descriptor = action(); const callback = vi.fn( () => [ descriptor ] );
	const { session } = setup( callback ); await session.ask( 'Help' );
	descriptor.label = 'Changed'; descriptor.run = vi.fn();
	const chat = mountMioChat( document.body, 'Editor', session, vi.fn() );
	expect( session.responseActions.list( last( session ) )[ 0 ].label ).toBe( 'Preview' );
	chat.destroy(); const reopened = mountMioChat( document.body, 'Editor', session, vi.fn() );
	expect( callback ).toHaveBeenCalledOnce(); reopened.destroy();
} );

test( 'action labels and errors are text; state changes preserve button nodes and scrolling', async () => {
	const { session } = setup( () => [ action( { label: '<img src=x onerror=evil()>', ariaLabel: 'Preview saved form', icon: 'dashicons-visibility', run: async () => { throw new Error( '<script>bad</script>' ); } } ) ] );
	await session.ask( 'Help' ); const chat = mountMioChat( document.body, 'Editor', session, vi.fn() );
	const button = document.querySelector<HTMLElement>( '[data-mio-action]' )!;
	const log = document.querySelector<HTMLElement>( '.os-mio-chat__log' )!;
	log.scrollTop = 93; button.click(); await flush();
	expect( document.querySelector( '[data-mio-action]' ) ).toBe( button );
	expect( log.scrollTop ).toBe( 93 ); expect( document.querySelector( '.os-mio-chat img, .os-mio-chat script' ) ).toBeNull();
	expect( document.querySelector( '.os-mio-chat__action-status' )?.textContent ).toBe( '<script>bad</script>' );
	expect( document.querySelector( '.os-mio-chat__actions' )?.getAttribute( 'aria-label' ) ).toBe( 'Suggested actions' );
	expect( button.textContent ).toContain( 'Preview saved form' );
	// Another reply must not replace this row, either.
	const input = document.querySelector( 'os-textarea' )!;
	input.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 'Explain more' } } ) ); input.dispatchEvent( new CustomEvent( 'os-submit' ) ); await flush();
	expect( document.querySelector( '[data-mio-action]' ) ).toBe( button ); chat.destroy();
} );

test( 'registrations without the callback retain ordinary messages and no controls', async () => {
	const { session } = setup(); await session.ask( 'Help' );
	const chat = mountMioChat( document.body, 'Editor', session, vi.fn() );
	expect( last( session ).actionIds ).toBeUndefined(); expect( document.querySelector( '[data-mio-action]' ) ).toBeNull(); chat.destroy();
} );

test.each( [ false, true ] )( 'native button focus is restored after pending unless the user moved it (%s)', async moved => {
	await import( '../../src/ui/components/os-button/os-button' );
	let settle!: () => void;
	const { session } = setup( () => [ action( { run: () => new Promise<void>( resolve => { settle = resolve; } ) } ) ] );
	await session.ask( 'Help' ); const chat = mountMioChat( document.body, 'Editor', session, vi.fn() ); await flush();
	const host = document.querySelector<HTMLElement>( '[data-mio-action]' )!;
	const native = host.shadowRoot!.querySelector<HTMLButtonElement>( 'button' )!;
	native.focus(); expect( document.activeElement ).toBe( host );
	const pending = run( session ); await flush();
	const other = document.createElement( 'button' ); document.body.append( other );
	if ( moved ) { other.focus(); } else { native.blur(); }
	settle(); await pending; await flush();
	expect( document.activeElement ).toBe( moved ? other : host );
	chat.destroy();
} );

test( 'permission or disposal during pending notification prevents even synchronous invocation', async () => {
	const execute = vi.fn(); const { session } = setup( () => [ action( { run: execute } ) ] );
	await session.ask( 'Help' );
	session.responseActions.subscribe( () => session.dispose() );
	await run( session ); expect( execute ).not.toHaveBeenCalled();
} );
