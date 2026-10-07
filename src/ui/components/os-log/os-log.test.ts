import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import './os-log';

import type { OsLog } from './os-log';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

describe( '<os-log>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'shows the empty placeholder when no entries', async () => {
		host.innerHTML = `<os-log></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' )!;
		const empty = log.shadowRoot!.querySelector( '.empty' )!;
		expect( empty.textContent?.trim() ).toBe( 'No entries' );
	} );

	test( 'push() appends and emits os-log-append', async () => {
		host.innerHTML = `<os-log></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< string >;
		const events: Array< { entry: unknown; length: number } > = [];
		log.addEventListener( 'os-log-append', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );
		log.push( 'one' );
		log.push( 'two' );
		expect( events.map( ( e ) => e.entry ) ).toEqual( [ 'one', 'two' ] );
		expect( events[ 1 ].length ).toBe( 2 );
		expect( log.entries ).toEqual( [ 'one', 'two' ] );
	} );

	test( 'max-rows enforces an LRU cap', async () => {
		host.innerHTML = `<os-log max-rows="3"></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< number >;
		for ( let i = 0; i < 10; i++ ) {
			log.push( i );
		}
		expect( log.entries ).toEqual( [ 7, 8, 9 ] );
	} );

	test( 'clear() drops every entry', async () => {
		host.innerHTML = `<os-log></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< string >;
		log.pushMany( [ 'a', 'b', 'c' ] );
		log.clear();
		expect( log.entries ).toEqual( [] );
	} );

	test( 'renderRow setter overrides the default and is invoked per visible row', async () => {
		host.innerHTML = `<os-log row-height="22"></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< string >;
		log.renderRow = ( entry, index ) => `[${ index }] ${ entry }`;
		log.push( 'first' );
		await tick();
		const rows = log.shadowRoot!.querySelectorAll( '.row' );
		expect( rows.length ).toBeGreaterThan( 0 );
		expect( rows[ 0 ].textContent ).toBe( '[0] first' );
	} );

	test( 'auto-row-height: rows render without a pinned height', async () => {
		host.innerHTML = `<os-log auto-row-height></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< string >;
		log.renderRow = ( entry ) => {
			const el = document.createElement( 'div' );
			el.textContent = entry;
			return el;
		};
		log.push( 'a' );
		await tick();
		const row = log.shadowRoot!.querySelector< HTMLElement >( '.row' )!;

		expect( row.style.height ).toBe( 'auto' );
	} );

	test( 'auto-row-height: max-rows trims heights cache in lockstep', async () => {
		host.innerHTML = `<os-log auto-row-height max-rows="2"></os-log>`;
		await tick();
		const log = host.querySelector( 'os-log' ) as OsLog< number >;
		log.push( 1 );
		log.push( 2 );
		log.push( 3 );
		expect( log.entries ).toEqual( [ 2, 3 ] );

		const internal = log as unknown as { _heights: number[] };
		expect( internal._heights.length ).toBeLessThanOrEqual( 2 );
	} );
} );
