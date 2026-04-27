/**
 * `<wpd-log>` — virtualization smoke tests.
 *
 * Verifies append + clear, the LRU cap, the empty placeholder,
 * and the `wpd-log-append` event payload. Pixel-perfect
 * windowing assertions are skipped (jsdom doesn't lay out CSS,
 * so `clientHeight` is always 0 — the windowing math reduces
 * to "render every row" which still exercises the renderer).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// Side-effect import registers the custom element; the type import
// keeps `as WpdLog<…>` casts honest. ESLint's `no-duplicate-imports`
// can't tell the two apart — runtime + type split is the canonical
// shape and is allowed via the explicit override below.
import './wpd-log';
// eslint-disable-next-line no-duplicate-imports
import type { WpdLog } from './wpd-log';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

describe( '<wpd-log>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'shows the empty placeholder when no entries', async () => {
		host.innerHTML = `<wpd-log></wpd-log>`;
		await tick();
		const log = host.querySelector( 'wpd-log' )!;
		const empty = log.shadowRoot!.querySelector( '.empty' )!;
		expect( empty.textContent?.trim() ).toBe( 'No entries' );
	} );

	test( 'push() appends and emits wpd-log-append', async () => {
		host.innerHTML = `<wpd-log></wpd-log>`;
		await tick();
		const log = host.querySelector( 'wpd-log' ) as WpdLog< string >;
		const events: Array< { entry: unknown; length: number } > = [];
		log.addEventListener( 'wpd-log-append', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );
		log.push( 'one' );
		log.push( 'two' );
		expect( events.map( ( e ) => e.entry ) ).toEqual( [ 'one', 'two' ] );
		expect( events[ 1 ].length ).toBe( 2 );
		expect( log.entries ).toEqual( [ 'one', 'two' ] );
	} );

	test( 'max-rows enforces an LRU cap', async () => {
		host.innerHTML = `<wpd-log max-rows="3"></wpd-log>`;
		await tick();
		const log = host.querySelector( 'wpd-log' ) as WpdLog< number >;
		for ( let i = 0; i < 10; i++ ) {
			log.push( i );
		}
		expect( log.entries ).toEqual( [ 7, 8, 9 ] );
	} );

	test( 'clear() drops every entry', async () => {
		host.innerHTML = `<wpd-log></wpd-log>`;
		await tick();
		const log = host.querySelector( 'wpd-log' ) as WpdLog< string >;
		log.pushMany( [ 'a', 'b', 'c' ] );
		log.clear();
		expect( log.entries ).toEqual( [] );
	} );

	test( 'renderRow setter overrides the default and is invoked per visible row', async () => {
		host.innerHTML = `<wpd-log row-height="22"></wpd-log>`;
		await tick();
		const log = host.querySelector( 'wpd-log' ) as WpdLog< string >;
		log.renderRow = ( entry, index ) => `[${ index }] ${ entry }`;
		log.push( 'first' );
		await tick();
		const rows = log.shadowRoot!.querySelectorAll( '.row' );
		expect( rows.length ).toBeGreaterThan( 0 );
		expect( rows[ 0 ].textContent ).toBe( '[0] first' );
	} );
} );
