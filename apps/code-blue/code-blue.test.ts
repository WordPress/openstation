/**
 * Code Blue — the client half: the pure model, the local actions,
 * and one render of the view into jsdom.
 */
import { describe, expect, it } from 'vitest';
import { formatBytes } from '@openstation/app';
import { mockViewContext } from '../../src/app-runtime/testing';
import app, {
	BUCKETS,
	buildReport,
	bucketOf,
	bucketize,
	countBuckets,
	filterEntries,
	groupEntries,
	sortGroups,
	type LogEntry,
} from './code-blue.os';

function entry( over: Partial< LogEntry > ): LogEntry {
	return {
		timestamp: 1000,
		level: 'notice',
		label: 'PHP Notice',
		message: 'msg',
		file: '/a.php',
		line: 1,
		trace: '',
		signature: 'sig',
		origin: { kind: 'unknown', slug: '' },
		...over,
	};
}

describe( 'model', () => {
	it( 'folds severities into four display buckets', () => {
		expect( bucketOf( 'fatal' ) ).toBe( 'error' );
		expect( bucketOf( 'notice' ) ).toBe( 'info' );
		expect( BUCKETS ).toEqual( [ 'error', 'warning', 'deprecated', 'info' ] );
	} );

	it( 'filters by time floor, query and hidden buckets', () => {
		const entries = [
			entry( { timestamp: null, message: 'plain', signature: 'p' } ),
			entry( { timestamp: 100, message: 'alpha', signature: 'a' } ),
			entry( { timestamp: 200, level: 'warning', message: 'beta', file: '/b.php', signature: 'b' } ),
		];
		expect( filterEntries( entries, 150, '', [] ) ).toHaveLength( 1 );
		expect( filterEntries( entries, null, 'BETA', [] ) ).toHaveLength( 1 );
		expect( filterEntries( entries, null, '.php', [] ) ).toHaveLength( 3 );
		expect( filterEntries( entries, null, '', [ 'info' ] ) ).toHaveLength( 1 );
		expect( countBuckets( entries ) ).toEqual( { error: 0, warning: 1, deprecated: 0, info: 2 } );
	} );

	it( 'groups by signature, keeping the most severe level and the latest message', () => {
		const groups = groupEntries( [
			entry( { timestamp: 1, message: 'Thing 1', signature: 's' } ),
			entry( { timestamp: 5, level: 'warning', message: 'Other', signature: 'o' } ),
			entry( { timestamp: 9, level: 'fatal', message: 'Thing 2', signature: 's', trace: '#0 {main}' } ),
		] );
		expect( groups ).toHaveLength( 2 );
		const thing = groups[ 0 ];
		expect( thing.count ).toBe( 2 );
		expect( thing.level ).toBe( 'fatal' );
		expect( thing.message ).toBe( 'Thing 2' );
		expect( thing.trace ).toBe( '#0 {main}' );
		expect( [ thing.firstTs, thing.lastTs, thing.occurrences ] ).toEqual( [ 1, 9, [ 9, 1 ] ] );
		expect( sortGroups( groups, 'recent' )[ 0 ].message ).toBe( 'Thing 2' );
		expect( sortGroups( groups, 'frequent' )[ 1 ].message ).toBe( 'Other' );
	} );

	it( 'buckets timestamped entries into the requested columns', () => {
		const now = 3600;
		const chart = bucketize(
			[
				entry( { timestamp: 0, level: 'warning' } ),
				entry( { timestamp: 3590, level: 'fatal' } ),
				entry( { timestamp: 3595, level: 'notice' } ),
				entry( { timestamp: null } ),
			],
			0,
			now,
			12,
		);
		expect( chart.columns ).toHaveLength( 12 );
		expect( chart.columns[ 0 ] ).toEqual( [ 0, 1, 0, 0 ] );
		expect( chart.columns[ 11 ] ).toEqual( [ 1, 0, 0, 1 ] );
		expect( bucketize( [ entry( { timestamp: null } ) ], null, now, 12 ).columns ).toEqual( [] );
	} );

	it( 'carries the server-classified origin onto the group', () => {
		// Attribution is `log-reader.php`'s job (`Tests_OpenStation_CodeBlue`
		// pins the classification); the client only has to keep it.
		const woo = { kind: 'plugin', slug: 'woocommerce' } as const;
		const groups = groupEntries( [
			entry( { timestamp: 1, signature: 's', origin: woo } ),
			entry( { timestamp: 2, signature: 's', origin: woo } ),
		] );
		expect( groups[ 0 ].origin ).toEqual( woo );
	} );

	it( 'builds a paste-ready report carrying the environment', () => {
		const group = groupEntries( [ entry( { timestamp: 100, level: 'fatal', label: 'PHP Fatal error', message: 'Boom', trace: '#0 {main}' } ) ] )[ 0 ];
		const report = buildReport( group, { kind: 'plugin', slug: 'woocommerce' }, [ { label: 'PHP', value: '8.3', on: null } ] );
		expect( report ).toContain( '### PHP Fatal error' );
		expect( report ).toContain( 'Boom' );
		expect( report ).toContain( '- **File:** `/a.php:1`' );
		expect( report ).toContain( '- **Source:** Plugin — woocommerce' );
		expect( report ).toContain( '- **Occurrences:** 1' );
		expect( report ).toContain( '- **Environment:** PHP 8.3' );
		expect( report ).toContain( '```\n#0 {main}\n```' );
	} );

	it( 'formats bytes like the shell', () => {
		expect( formatBytes( 563200 ) ).toBe( '550 KB' );
		expect( formatBytes( 1024 * 1024 * 1.25 ) ).toBe( '1.3 MB' );
		expect( formatBytes( 12 ) ).toBe( '12 B' );
	} );
} );

describe( 'app', () => {
	const state = () => ( {
		source: 'test',
		range: 'all',
		query: '',
		sort: 'recent',
		hidden: [] as string[],
		expanded: [] as string[],
		auto: false,
		error: '',
	} );
	const data = () => ( {
		sources: [ { id: 'test', label: 'Test log', path: '/t.log', exists: true, readable: true, writable: true, size: 563200, mtime: 1 } ],
		source: { id: 'test', label: 'Test log', path: '/t.log', exists: true, readable: true, writable: true, size: 563200, mtime: 1 },
		environment: [ { label: 'WP_DEBUG', value: 'on', on: true } ],
		entries: [ entry( { timestamp: 50, message: 'Needle', signature: 'n' } ) ],
		scanned: 10,
		truncated: false,
		readError: '',
		now: 100,
		searchUrl: 'https://duckduckgo.com/?q=%s',
	} );

	it( 'declares the instant actions as local', () => {
		expect( app.hasLocal( 'toggle' ) ).toBe( true );
		expect( app.hasLocal( 'series' ) ).toBe( true );
		expect( app.hasLocal( 'refresh' ) ).toBe( false );
		expect( app.hasLocal( 'clear' ) ).toBe( false );
		expect( app.runLocal( 'toggle', state(), { key: 'n' }, data() ).expanded ).toEqual( [ 'n' ] );
		expect( app.runLocal( 'series', state(), { hidden: [ 'info' ] }, data() ).hidden ).toEqual( [ 'info' ] );
	} );

	it( 'renders the body from state + data and re-renders in place', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const ctx = mockViewContext( { state: state(), data: data(), root } );
		app.render( ctx );
		expect( root.querySelector( '.os-cb-issue__message' )?.textContent ).toBe( 'Needle' );
		expect( root.querySelector( 'os-option' )?.textContent ).toBe( 'Test log (550 KB)' );
		expect( root.querySelector( 'os-histogram' )?.getAttribute( 'hidden-series' ) ?? '' ).toBe( '' );
		expect( root.querySelector( '.os-cb-issue__detail' ) ).toBeNull();

		// The whole row is the toggle — an error list is scanned, so
		// expanding must not ask for aim at a chevron.
		const row = root.querySelector( '.os-cb-issue__row' )!;
		expect( row.tagName ).toBe( 'BUTTON' );
		expect( row.getAttribute( 'os-action' ) ).toBe( 'toggle' );

		const stack = root.querySelector( 'os-stack' );
		app.render( { ...ctx, state: { ...state(), expanded: [ 'n' ], hidden: [ 'warning' ] } } );
		expect( root.querySelector( 'os-stack' ) ).toBe( stack );
		expect( root.querySelector( '.os-cb-issue__detail' ) ).not.toBeNull();
		expect( root.querySelector( 'os-histogram' )?.getAttribute( 'hidden-series' ) ).toBe( 'warning' );

		// The detail is where the error can be taken away: the full
		// message and the file path both carry a copy button, and
		// neither sits inside the row's button.
		const full = root.querySelector( '.os-cb-issue__full' )!;
		expect( full.textContent ).toBe( 'Needle' );
		expect( full.hasAttribute( 'copy' ) && full.hasAttribute( 'wrap' ) ).toBe( true );
		expect( full.closest( 'button' ) ).toBeNull();
		expect( root.querySelector( '.os-cb-issue__facts os-code' )?.textContent ).toBe( '/a.php:1' );
		expect( root.querySelector< HTMLAnchorElement >( '.os-cb-issue__search' )?.href ).toBe( 'https://duckduckgo.com/?q=Needle' );
	} );
} );
