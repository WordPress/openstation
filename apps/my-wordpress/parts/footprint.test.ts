/**
 * The activity footprint — WP Explorer's full-body surface, ported
 * 1:1 into the app: one round-trip, the section order, the class
 * names its stylesheet and plugin CSS target, and the status-bar
 * strings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app, { type AppData, type AppState } from '../my-wordpress.os';
import { footprintStatus } from './footprint';

function state( over: Partial< AppState > = {} ): AppState {
	return {
		group: '',
		section: 'users',
		item: 0,
		into: 0,
		relation: '',
		footprint: 12,
		fpName: 'Sofia Ramirez',
		query: '',
		page: 1,
		sort: '',
		selected: [],
		pane: 'define',
		casting: false,
		wstep: 0,
		cast: null,
		agentNotice: '',
		briefError: '',
		...over,
	};
}

function data(): AppData {
	return {
		siteName: 'Alcázar Estates',
		restRoot: 'http://example.test/wp-json/',
		restNonce: 'nonce',
		agentsEnabled: false,
		sections: [
			{
				id: 'users',
				label: 'Users',
				icon: 'dashicons-admin-users',
				kind: 'user',
				post_type: '',
				thumbnails: true,
				count: 4,
			},
		],
		groups: [],
		sortOptions: {},
		list: null,
		detail: null,
		folder: null,
		sub: null,
		subDetail: null,
		authors: [],
		categories: [],
		tags: [],
		previewActions: [],
		agents: null,
	};
}

const PAYLOAD = {
	profile: {
		id: 12,
		name: 'Sofia Ramirez',
		avatarUrl: '',
		link: 'https://example.test/author/sofia',
		roleLabels: [ 'Author' ],
		registered: '2026-06-02T00:00:00',
	},
	range: { from: '2025-09-01', to: '2026-09-01', days: 3 },
	daily: [
		{ date: '2026-08-30', posts: 2, comments: 1, updates: 0 },
		{ date: '2026-08-31', posts: 0, comments: 0, updates: 0 },
		{ date: '2026-09-01', posts: 4, comments: 0, updates: 1 },
	],
	weekday: [ 0, 1, 2, 3, 4, 5, 6 ],
	hour: Array.from( { length: 24 }, ( _u, i ) => i % 5 ),
	streak: {
		longest: 9,
		current: 2,
		longestRange: { from: '2026-05-01', to: '2026-05-09' },
	},
	timeline: [
		{ kind: 'post', date: '2026-09-01', title: 'Hello', link: 'https://example.test/?p=1', status: 'publish' },
		{ kind: 'comment', date: '2026-08-30', title: 'A post', link: '', status: 'approved' },
	],
	totals: {
		posts: 104,
		pages: 2,
		comments: 7,
		updates: 3,
		mostProlificMonth: { ym: '2026-05', n: 12 },
	},
};

function stubFetch( body: unknown, ok = true ): ReturnType< typeof vi.fn > {
	const fn = vi.fn( async () => ( {
		ok,
		status: ok ? 200 : 500,
		json: async () => body,
	} ) as unknown as Response );
	vi.stubGlobal( 'fetch', fn );
	return fn;
}

interface TestCtx {
	state: AppState;
	data: AppData;
	root: HTMLElement;
	dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean >;
	local: ( action: string, args?: Record< string, unknown > ) => void;
}

function mount(): { root: HTMLElement; ctx: TestCtx } {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx: TestCtx = {
		state: state(),
		data: data(),
		root,
		dispatch: async () => true,
		local: () => undefined,
	};
	app.render( ctx );
	return { root, ctx };
}

const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = { os: {} };
} );

afterEach( () => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the activity footprint', () => {
	it( 'replaces the body, fetches once, and paints every section in order', async () => {
		const fetchMock = stubFetch( PAYLOAD );
		const { root, ctx } = mount();

		// Loading first — the spinner in the full-body host.
		expect( root.querySelector( '.os-my-wordpress__footprint' ) ).not.toBeNull();
		expect( root.querySelector( '.os-mywp__tiles' ) ).toBeNull();

		await flush();
		app.render( ctx );

		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		expect( String( fetchMock.mock.calls[ 0 ][ 0 ] ) ).toBe(
			'http://example.test/wp-json/desktop-mode/v1/user-footprint/12',
		);

		const text = root.textContent ?? '';
		// Hero.
		expect( text ).toContain( 'Sofia Ramirez' );
		expect( text ).toContain( 'Author archive' );
		expect( text ).toContain( 'Member since' );
		// Stat strip.
		expect( text ).toContain( 'Total content' );
		expect( text ).toContain( '104 posts · 2 pages' );
		expect( text ).toContain( 'Longest streak' );
		expect( text ).toContain( '9 days' );
		// Calendar + legend.
		expect( text ).toContain( 'A year of activity' );
		expect(
			root.querySelectorAll( '.os-my-wordpress__footprint-cell--l4' ).length,
		).toBeGreaterThan( 0 );
		expect( text ).toContain( 'Less' );
		// Rhythm, callout, timeline, footer.
		expect( text ).toContain( 'Publishing rhythm' );
		expect( text ).toContain( 'Most prolific month' );
		expect( text ).toContain( 'Commented on “A post”' );
		expect( text ).toContain( 'Show profile' );

		// A repaint reuses the cache — no second round trip.
		app.render( ctx );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

		// The status bar speaks the original's two lines.
		const status = footprintStatus( ctx as never );
		expect( status?.[ 0 ] ).toBe( '106 posts · 7 comments tracked' );
		expect( status?.[ 1 ] ).toContain( 'Window' );
	} );

	it( 'shows the failure instead of sitting on the spinner', async () => {
		stubFetch( { message: 'nope' }, false );
		const { root, ctx } = mount();
		await flush();
		app.render( ctx );

		expect( root.textContent ).toContain( 'Could not load footprint.' );
		expect(
			footprintStatus( ctx as never )?.[ 0 ],
		).toBe( 'Could not load footprint.' );
	} );

	it( 'keeps the breadcrumb on the person and the section linkable', () => {
		stubFetch( PAYLOAD );
		const { root } = mount();
		const crumbs = root.querySelector( '.os-mywp__crumbs' );
		expect( crumbs?.textContent ).toContain( 'Sofia Ramirez' );
		// The section crumb is a LINK back out of the footprint.
		const links = Array.from( crumbs?.querySelectorAll( 'button' ) ?? [] ).map(
			( b ) => b.textContent,
		);
		expect( links ).toContain( 'Users' );
	} );
} );
