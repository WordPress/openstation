import { afterEach, describe, expect, test, vi } from 'vitest';
import { MioSession, memoryMioConversation } from '../../src/mio/assistant/session';
import { linkedMioHelp, searchMioHelp } from '../../src/mio/assistant/help';
import type { MioAbility, MioTransport, MioTurn, MioWindowContext } from '../../src/mio/assistant/types';

const documents = [
	{ id: 'index.md', title: 'Overview', markdown: '# Overview\nSee [Docks](guides/docks.md) and [external](https://evil.test/a.md).' },
	{ id: 'guides/docks.md', title: 'Dynamic docks', markdown: '# Dynamic docks\nDynamic docks fold to the edge.\n[Home](../index.md#top)\n[Missing](missing.md)' },
];
const noop = (): MioAbility => ( { name: 'change', description: 'Change one setting', parameters: { type: 'object' }, validate: ( args ) => Object.keys( args ).length === 1 && typeof args.value === 'string', run: vi.fn( () => ( { saved: true } ) ) } );
const context = ( abilities: MioAbility[] = [] ): MioWindowContext => ( { host: document.body, title: 'Settings', prompt: () => 'Live prompt', documents, abilities: () => abilities } );
const done: MioTurn = { message: 'Done.', calls: [] };
const call = ( value: string ) => ( { name: 'change', arguments: JSON.stringify( { value } ) } );
afterEach( () => vi.restoreAllMocks() );

describe( 'MIO help retrieval', () => {
	test( 'ranks relevant sections and follows only manifest links', () => {
		expect( searchMioHelp( documents, 'dynamic docks' )[ 0 ].id ).toBe( 'guides/docks.md' );
		expect( linkedMioHelp( documents, 'index.md' ).links ).toEqual( [ 'guides/docks.md' ] );
		expect( linkedMioHelp( documents, 'guides/docks.md' ).links ).toEqual( [ 'index.md' ] );
		expect( () => linkedMioHelp( documents, '../../private.md' ) ).toThrow();
	} );
} );

describe( 'MIO private action loop', () => {
	test( 'chains in order and refreshes the caller prompt with prior results', async () => {
		const ability = noop();
		let state = 'before';
		ability.run = vi.fn( ( args ) => { state = args.value as string; return { saved: true }; } );
		const transport = vi.fn< MioTransport >().mockResolvedValueOnce( { message: '', calls: [ call( 'round' ), call( 'unified' ), call( 'dynamic' ) ] } ).mockResolvedValueOnce( done );
		const ctx = context( [ ability ] );
		ctx.prompt = () => state;
		const session = new MioSession( ctx, transport, () => true );
		expect( await session.ask( 'Round corners, unify docks, make dynamic' ) ).toBe( 'Done.' );
		expect( vi.mocked( ability.run ).mock.calls.map( ( args ) => args[ 0 ].value ) ).toEqual( [ 'round', 'unified', 'dynamic' ] );
		expect( transport.mock.calls[ 0 ][ 0 ].prompt ).toBe( 'before' );
		expect( transport.mock.calls[ 1 ][ 0 ].prompt ).toBe( 'dynamic' );
		expect( JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes ).toHaveLength( 3 );
	} );
	test( 'a late reply after focus leaves cannot execute', async () => {
		let resolve!: ( turn: MioTurn ) => void;
		let active = true;
		const ability = noop();
		const session = new MioSession( context( [ ability ] ), () => new Promise( ( doneTurn ) => { resolve = doneTurn; } ), () => active );
		const pending = session.ask( 'Change it' );
		await Promise.resolve();
		active = false;
		resolve( { message: '', calls: [ call( 'round' ) ] } );
		await expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( ability.run ).not.toHaveBeenCalled();
	} );
	test( 'rechecks permission between two calls', async () => {
		let allowed = true;
		const ability = noop();
		ability.allowed = () => allowed;
		ability.run = vi.fn( () => { allowed = false; return { saved: true }; } );
		const session = new MioSession( context( [ ability ] ), async () => ( { message: '', calls: [ call( 'one' ), call( 'two' ) ] } ), () => true );
		await expect( session.ask( 'Both' ) ).rejects.toThrow( 'unavailable' );
		expect( ability.run ).toHaveBeenCalledTimes( 1 );
		expect( session.conversation.read().at( -1 )?.text ).toContain( 'confirmed writes: 1' );
	} );
	test.each( [ { name: 'delete_all', arguments: '{}' }, { name: 'change', arguments: '{"value":"x","extra":true}' }, { name: 'change', arguments: '[]' } ] )( 'rejects unoffered or malformed calls %#', async ( bad ) => {
		const ability = noop();
		const session = new MioSession( context( [ ability ] ), async () => ( { message: '', calls: [ bad ] } ), () => true );
		await expect( session.ask( 'Change it' ) ).rejects.toThrow();
		expect( ability.run ).not.toHaveBeenCalled();
	} );
	test( 'bounds total tool executions across provider rounds', async () => {
		const ability = noop();
		let round = 0;
		const session = new MioSession( context( [ ability ] ), async () => { const offset = round++ * 9; return { message: '', calls: Array.from( { length: 9 }, ( _, i ) => call( String( offset + i ) ) ) }; }, () => true );
		await expect( session.ask( 'Apply many changes' ) ).rejects.toThrow( 'action limit' );
		expect( ability.run ).toHaveBeenCalledTimes( 16 );
	} );
	test( 'never repeats a completed identical action', async () => {
		const ability = noop();
		const session = new MioSession( context( [ ability ] ), async () => ( { message: '', calls: [ call( 'x' ), call( 'x' ) ] } ), () => true );
		await expect( session.ask( 'Change it' ) ).rejects.toThrow( 'repeated' );
		expect( ability.run ).toHaveBeenCalledTimes( 1 );
	} );
	test( 'cancels provider work and clears memory on disposal without storage writes', async () => {
		const storage = vi.spyOn( Storage.prototype, 'setItem' );
		let signal: AbortSignal | undefined;
		const session = new MioSession( context(), async ( _request, nextSignal ) => { signal = nextSignal; return done; }, () => true );
		await session.ask( 'Hello' );
		expect( session.conversation.read() ).toHaveLength( 2 );
		session.dispose();
		expect( session.conversation.read() ).toHaveLength( 0 );
		expect( storage ).not.toHaveBeenCalled();
		expect( signal ).toBeDefined();
	} );
	test( 'conversation stores return defensive copies and have a bounded backscroll', () => {
		const store = memoryMioConversation();
		store.write( Array.from( { length: 100 }, () => ( { role: 'user', text: 'Hello' } ) ) );
		const messages = store.read();
		messages[ 0 ].text = 'changed';
		expect( store.read() ).toHaveLength( 40 );
		expect( store.read()[ 0 ].text ).toBe( 'Hello' );
	} );
} );

test( 'thinking stops on cancel immediately and a stale reply cannot stop a newer turn', async () => {
	const replies: Array<( turn: MioTurn ) => void> = [];
	const session = new MioSession( context(), () => new Promise( resolve => replies.push( resolve ) ), () => true );
	const states: boolean[] = [];
	const unsubscribe = session.subscribeThinking( value => states.push( value ) );
	const first = session.ask( 'First' ); await Promise.resolve();
	expect( states ).toEqual( [ false, true ] );
	session.cancel(); expect( states.at( -1 ) ).toBe( false );
	const second = session.ask( 'Second' ); await Promise.resolve();
	replies[ 0 ]( done ); await expect( first ).rejects.toMatchObject( { name: 'AbortError' } );
	expect( states.at( -1 ) ).toBe( true );
	replies[ 1 ]( done ); await second;
	expect( states.at( -1 ) ).toBe( false );
	unsubscribe();
} );

test( 'freezes read results before subsequent actions mutate the same store', async () => {
	const state = { wallpaper: 'galaxy' };
	const read = { ...noop(), effect: 'read' as const, name: 'read', validate: () => true, run: () => state };
	const change = { ...noop(), run: () => { state.wallpaper = 'dark'; return { saved: true, changed: true }; } };
	const transport = vi.fn<MioTransport>().mockResolvedValueOnce( { message: '', calls: [ { name: 'read', arguments: '{}' }, call( 'dark' ) ] } ).mockResolvedValueOnce( done );
	const session = new MioSession( context( [ read, change ] ), transport, () => true );
	await session.ask( 'Change Galaxy to Graphite' );
	const { outcomes } = JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript );
	expect( outcomes[ 0 ].result.wallpaper ).toBe( 'galaxy' );
	expect( state.wallpaper ).toBe( 'dark' );
} );
