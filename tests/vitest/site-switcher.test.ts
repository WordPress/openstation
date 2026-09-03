/**
 * The site switcher: on a network every site is its own OpenStation,
 * and the row above overview's desktop tiles is how you reach another.
 */

import { describe, expect, test, vi } from 'vitest';
import {
	HOP_FROM_ARG,
	OVERVIEW_ARG,
	buildSiteSwitcher,
	isOtherOrigin,
	shellUrlInOverview,
	siteSwitcherEntries,
} from '../../src/multisite/site-switcher';
import { createHopMinter } from '../../src/multisite/hop';
import { shellUrlWithoutBootArgs } from '../../src/shell-url';
import type { MultisiteConfig } from '../../src/types';

const MAIN_SHELL = 'http://example.test/wp-admin/admin.php?page=openstation';
const SHOP_SHELL = 'http://example.test/shop/wp-admin/admin.php?page=openstation';
const NETWORK_SHELL =
	'http://example.test/wp-admin/network/admin.php?page=openstation';

const config = ( over: Partial< MultisiteConfig > = {} ): MultisiteConfig => ( {
	isNetworkAdmin: false,
	networkAdmin: {
		url: 'http://example.test/wp-admin/network/',
		shellUrl: NETWORK_SHELL,
		rows: [],
	},
	current: '1',
	sites: [
		{ id: '1', name: 'Main', shellUrl: MAIN_SHELL },
		{ id: '2', name: 'Shop', shellUrl: SHOP_SHELL },
	],
	...over,
} );

describe( 'the site switcher', () => {
	test( 'names the network admin first, then every site, with this one selected', () => {
		const el = buildSiteSwitcher( config() );

		expect( el?.tagName.toLowerCase() ).toBe( 'os-segmented' );
		expect( el?.getAttribute( 'value' ) ).toBe( '1' );
		expect(
			Array.from( el?.querySelectorAll( 'os-segment' ) ?? [] ).map( ( s ) => [
				s.getAttribute( 'value' ),
				s.textContent,
			] ),
		).toEqual( [
			[ 'network', 'Network Admin' ],
			[ '1', 'Main' ],
			[ '2', 'Shop' ],
		] );
	} );

	test( 'a lone instance gets no row', () => {
		// A site admin on one site: nothing to switch between.
		expect(
			buildSiteSwitcher(
				config( { networkAdmin: null, sites: config().sites.slice( 0, 1 ) } ),
			),
		).toBeNull();
		expect( siteSwitcherEntries( config( { networkAdmin: null, sites: [] } ) ) ).toEqual( [] );
	} );

	test( 'picking another site slides out, then hops to its shell, landing in overview', async () => {
		const hop = vi.fn();
		const el = buildSiteSwitcher( config(), { hop } );
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );

		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '2' } } ) );
		// The desk slides out first; the navigation follows.
		expect( hop ).not.toHaveBeenCalled();
		await settle();
		// example.test is another origin than this document, so the
		// direction rides on the URL too: sessionStorage stays here.
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop_from=next' );
		// Shop sits after this site in the row, so the next shell enters from the right.
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'next' );

		hop.mockClear();
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'network' } } ) );
		await settle();
		expect( hop ).toHaveBeenCalledWith( NETWORK_SHELL + '&openstation_overview=1&openstation_hop_from=prev' );
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'prev' );

		// This site is where the user already stands.
		hop.mockClear();
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '1' } } ) );
		await settle();
		expect( hop ).not.toHaveBeenCalled();
	} );

	test( 'a modifier click opens the site beside this one, without re-selecting', () => {
		const hop = vi.fn();
		const el = buildSiteSwitcher( config(), { hop } );
		document.body.appendChild( el as HTMLElement );
		const picked = vi.fn();
		el?.addEventListener( 'os-pick', picked );

		const click = new MouseEvent( 'click', {
			metaKey: true,
			bubbles: true,
			cancelable: true,
		} );
		el?.querySelector( 'os-segment[value="network"]' )?.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( true );
		expect( hop ).toHaveBeenCalledWith( shellUrlInOverview( NETWORK_SHELL ), click );
		expect( picked ).not.toHaveBeenCalled();
		el?.remove();
	} );

	test( 'the overview flag is one-shot: the shell strips it like the boot target', () => {
		const url = shellUrlInOverview( MAIN_SHELL );
		expect( new URL( url ).searchParams.get( OVERVIEW_ARG ) ).toBe( '1' );
		expect( shellUrlWithoutBootArgs( url ) ).toBe( MAIN_SHELL );
		// So are the hop token and the direction it lands with.
		expect(
			shellUrlWithoutBootArgs( MAIN_SHELL + '&openstation_hop=abc.def&' + HOP_FROM_ARG + '=next' ),
		).toBe( MAIN_SHELL );
	} );

	test( 'a site on this origin carries no direction arg and mints nothing', async () => {
		const here = window.location.origin + '/wp-admin/admin.php?page=openstation';
		expect( isOtherOrigin( here ) ).toBe( false );
		expect( isOtherOrigin( SHOP_SHELL ) ).toBe( true );
		expect( shellUrlInOverview( here, 'next' ) ).toBe( here + '&openstation_overview=1' );

		const hop = vi.fn();
		const mint = vi.fn( async () => 'https://never.test/' );
		const el = buildSiteSwitcher(
			config( { sites: [ { id: '1', name: 'Main', shellUrl: MAIN_SHELL }, { id: '9', name: 'Here', shellUrl: here } ] } ),
			{ hop, mint },
		);
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '9' } } ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( mint ).not.toHaveBeenCalled();
		expect( hop ).toHaveBeenCalledWith( here + '&openstation_overview=1' );
	} );

	test( 'another origin gets a login token minted, and hops without one when the mint fails', async () => {
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );
		const hop = vi.fn();
		const mint = vi.fn( async () => SHOP_SHELL + '&openstation_overview=1&openstation_hop=signed' );
		const el = buildSiteSwitcher( config(), { hop, mint } );

		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '2' } } ) );
		await settle();
		expect( mint ).toHaveBeenCalledWith( SHOP_SHELL, 'next' );
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop=signed' );

		// The route is down, or refused: the plain hop, and the login
		// screen over there, never a dead switch.
		hop.mockClear();
		mint.mockRejectedValueOnce( new Error( 'no' ) );
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'network' } } ) );
		await settle();
		expect( hop ).toHaveBeenCalledWith( NETWORK_SHELL + '&openstation_overview=1&openstation_hop_from=prev' );
	} );
} );

describe( 'createHopMinter', () => {
	test( 'posts the target and direction with the nonce, and answers the minted URL or null', async () => {
		const calls: Array< { url: string; init: RequestInit } > = [];
		const respond = vi.fn( async () => new Response( JSON.stringify( { url: 'https://shop.test/?openstation_hop=t' } ), { status: 200 } ) );
		vi.stubGlobal( 'fetch', ( url: string, init: RequestInit ) => {
			calls.push( { url, init } );
			return respond();
		} );
		const mint = createHopMinter( { hopUrl: 'https://hub.test/wp-json/desktop-mode/v1/network/hop', restNonce: 'n0nce' } );

		expect( await mint( 'https://shop.test/wp-admin/admin.php?page=openstation', 'next' ) ).toBe( 'https://shop.test/?openstation_hop=t' );
		expect( calls[ 0 ].url ).toBe( 'https://hub.test/wp-json/desktop-mode/v1/network/hop' );
		expect( ( calls[ 0 ].init.headers as Record< string, string > )[ 'X-WP-Nonce' ] ).toBe( 'n0nce' );
		expect( JSON.parse( calls[ 0 ].init.body as string ) ).toEqual( { target: 'https://shop.test/wp-admin/admin.php?page=openstation', direction: 'next' } );

		respond.mockResolvedValueOnce( new Response( '{}', { status: 403 } ) );
		expect( await mint( 'https://shop.test/', 'prev' ) ).toBeNull();
		respond.mockRejectedValueOnce( new Error( 'offline' ) );
		expect( await mint( 'https://shop.test/', 'prev' ) ).toBeNull();
		vi.unstubAllGlobals();
	} );
} );
