/**
 * The site switcher: on a network every site is its own OpenStation,
 * and the row above overview's desktop tiles is how you reach another.
 */

import { describe, expect, test, vi } from 'vitest';
import {
	OVERVIEW_ARG,
	buildSiteSwitcher,
	shellUrlInOverview,
	siteSwitcherEntries,
} from '../../src/multisite/site-switcher';
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
		const el = buildSiteSwitcher( config(), vi.fn() );

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
				vi.fn(),
			),
		).toBeNull();
		expect( siteSwitcherEntries( config( { networkAdmin: null, sites: [] } ) ) ).toEqual( [] );
	} );

	test( 'picking another site slides out, then hops to its shell, landing in overview', async () => {
		const hop = vi.fn();
		const el = buildSiteSwitcher( config(), hop );
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );

		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '2' } } ) );
		// The desk slides out first; the navigation follows.
		expect( hop ).not.toHaveBeenCalled();
		await settle();
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1' );
		// Shop sits after this site in the row, so the next shell enters from the right.
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'next' );

		hop.mockClear();
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'network' } } ) );
		await settle();
		expect( hop ).toHaveBeenCalledWith( NETWORK_SHELL + '&openstation_overview=1' );
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'prev' );

		// This site is where the user already stands.
		hop.mockClear();
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '1' } } ) );
		await settle();
		expect( hop ).not.toHaveBeenCalled();
	} );

	test( 'a modifier click opens the site beside this one, without re-selecting', () => {
		const hop = vi.fn();
		const el = buildSiteSwitcher( config(), hop );
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
	} );
} );
