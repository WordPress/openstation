/**
 * The site switcher: on a network every site is its own OpenStation,
 * and the row above overview's desktop tiles is how you reach another.
 */

import { describe, expect, test, vi } from 'vitest';
import {
	HOP_FROM_ARG,
	OVERVIEW_ARG,
	buildSiteSwitcher,
	installSiteSwitcherKeys,
	isOtherOrigin,
	shellUrlInOverview,
	siteSwitcherEntries,
	switchToSite,
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
		foreign: true,
	},
	current: '1',
	sites: [
		{ id: '1', name: 'Main', shellUrl: MAIN_SHELL },
		// Another install: a switch there mints a login token.
		{ id: '2', name: 'Shop', shellUrl: SHOP_SHELL, foreign: true },
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

	test( 'an install that joined from elsewhere is marked as external, after a line', () => {
		const el = buildSiteSwitcher(
			config( {
				sites: [
					{ id: '1', name: 'Main', shellUrl: MAIN_SHELL, kind: 'local' },
					{ id: 'member:abc', name: 'Studio', shellUrl: 'https://studio.test/wp-admin/admin.php?page=openstation', kind: 'member' },
					{ id: 'member:def', name: 'Shop', shellUrl: 'https://shop.test/wp-admin/admin.php?page=openstation', kind: 'member' },
				],
			} ),
		);
		const children = Array.from( el?.children ?? [] ).map( ( c ) => c.tagName.toLowerCase() + ( c.hasAttribute( 'data-external' ) ? '[external]' : '' ) );
		// The line once, before the first external site; the network's own sites carry nothing.
		expect( children ).toEqual( [ 'os-segment', 'os-segment', 'span', 'os-segment[external]', 'os-segment[external]' ] );
		const divider = el?.querySelector( '.os-site-switcher__divider' );
		expect( divider?.getAttribute( 'role' ) ).toBe( 'separator' );

		const studio = el?.querySelector( 'os-segment[value="member:abc"]' ) as HTMLElement;
		expect( studio.title ).toBe( 'External site' );
		expect( studio.querySelector( '.os-site-switcher__mark' )?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// The name stays the visible label; the mark and the spoken prefix ride before it.
		expect( studio.textContent ).toBe( 'External site: Studio' );
		expect( ( el?.querySelector( 'os-segment[value="1"]' ) as HTMLElement ).title ).toBe( '' );
		expect( siteSwitcherEntries( config() ).map( ( e ) => e.external ) ).toEqual( [ false, false, false ] );
	} );

	test( 'a site without OpenStation is marked and opens its admin in a browser tab', async () => {
		const hop = vi.fn();
		const picked = vi.fn();
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );
		const multisite = config( {
			sites: [
				{ id: '1', name: 'Main', shellUrl: MAIN_SHELL, active: true },
				{ id: '3', name: 'Blog', shellUrl: 'http://example.test/blog/wp-admin/admin.php?page=openstation', adminUrl: 'http://example.test/blog/wp-admin/', active: false },
				{ id: '2', name: 'Shop', shellUrl: SHOP_SHELL, foreign: true },
			],
		} );
		const el = buildSiteSwitcher( multisite, { hop } );
		document.body.appendChild( el as HTMLElement );
		el?.addEventListener( 'os-pick', picked );

		const blog = el?.querySelector( 'os-segment[value="3"]' ) as HTMLElement;
		expect( blog.hasAttribute( 'data-opens-tab' ) ).toBe( true );
		expect( blog.querySelector( '.os-site-switcher__mark' ) ).not.toBeNull();
		expect( blog.textContent ).toBe( 'Opens in a new tab: Blog' );
		// It is still this network's site: no divider.
		expect( el?.querySelector( '.os-site-switcher__divider' ) ).toBeNull();

		// A plain click opens the admin beside this shell and never re-selects.
		const click = new MouseEvent( 'click', { bubbles: true, cancelable: true } );
		blog.dispatchEvent( click );
		expect( click.defaultPrevented ).toBe( true );
		expect( open ).toHaveBeenCalledWith( 'http://example.test/blog/wp-admin/', '_blank', 'noopener' );
		expect( picked ).not.toHaveBeenCalled();

		// Reached any other way, it still never hops to the missing shell.
		open.mockClear();
		expect( switchToSite( multisite, '3', { hop } ) ).toBe( true );
		expect( open ).toHaveBeenCalledWith( 'http://example.test/blog/wp-admin/', '_blank', 'noopener' );

		// Tab steps over it, to the next site with a shell.
		open.mockClear();
		const teardown = installSiteSwitcherKeys( { multisite: () => multisite, isShown: () => true, hop } );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Tab', bubbles: true, cancelable: true } ) );
		await settle();
		expect( open ).not.toHaveBeenCalled();
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop_from=next' );

		teardown();
		open.mockRestore();
		el?.remove();
	} );

	test( 'switchToSite takes the same hop a pick does, for a value the row offers and nowhere else', async () => {
		const hop = vi.fn();
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( switchToSite( config(), '2', { hop } ) ).toBe( true );
		await settle();
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop_from=next' );
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'next' );

		hop.mockClear();
		// This very shell, and a value the switcher never offered: no hop.
		expect( switchToSite( config(), '1', { hop } ) ).toBe( false );
		expect( switchToSite( config(), 'member:nope', { hop } ) ).toBe( false );
		await settle();
		expect( hop ).not.toHaveBeenCalled();
	} );

	test( 'Tab moves to the next site and Shift+Tab to the previous, only while the row is displayed', async () => {
		const hop = vi.fn();
		let shown = true;
		let multisite = config();
		const teardown = installSiteSwitcherKeys( { multisite: () => multisite, isShown: () => shown, hop } );
		const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );
		const press = ( shiftKey = false ): KeyboardEvent => {
			const e = new KeyboardEvent( 'keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true } );
			document.dispatchEvent( e );
			return e;
		};

		// The row: Network Admin, Main (this one), Shop.
		let e = press();
		await settle();
		expect( e.defaultPrevented ).toBe( true );
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop_from=next' );

		hop.mockClear();
		e = press( true );
		await settle();
		expect( hop ).toHaveBeenCalledWith( NETWORK_SHELL + '&openstation_overview=1&openstation_hop_from=prev' );

		// The ends wrap.
		hop.mockClear();
		multisite = config( { current: '2' } );
		press();
		await settle();
		expect( hop ).toHaveBeenCalledWith( expect.stringContaining( NETWORK_SHELL ) );

		// Not displayed: the browser keeps its Tab.
		hop.mockClear();
		shown = false;
		e = press();
		await settle();
		expect( e.defaultPrevented ).toBe( false );
		expect( hop ).not.toHaveBeenCalled();

		// Displayed, but the user is typing (a desk being renamed).
		shown = true;
		const field = document.createElement( 'input' );
		document.body.appendChild( field );
		field.focus();
		e = press();
		await settle();
		expect( e.defaultPrevented ).toBe( false );
		expect( hop ).not.toHaveBeenCalled();
		field.remove();

		// Modified Tab is not this key.
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true } ) );
		await settle();
		expect( hop ).not.toHaveBeenCalled();

		// Focus on another control of the top bar (a tile's close, the
		// "+") keeps the browser's Tab, so those stay reachable; focus
		// back on the switcher hands Tab back to the sites.
		const bar = document.createElement( 'div' );
		bar.className = 'os-overview-top-bar';
		bar.innerHTML = '<div class="os-site-switcher"><button class="segment">Main</button></div><button class="tile">Close</button>';
		document.body.appendChild( bar );
		( bar.querySelector( '.tile' ) as HTMLElement ).focus();
		e = press();
		await settle();
		expect( e.defaultPrevented ).toBe( false );
		expect( hop ).not.toHaveBeenCalled();
		( bar.querySelector( '.segment' ) as HTMLElement ).focus();
		multisite = config();
		e = press();
		await settle();
		expect( e.defaultPrevented ).toBe( true );
		expect( hop ).toHaveBeenCalledWith( SHOP_SHELL + '&openstation_overview=1&openstation_hop_from=next' );
		hop.mockClear();
		bar.remove();

		teardown();
		press();
		await settle();
		expect( hop ).not.toHaveBeenCalled();
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

	test( 'a modifier click on another origin opens the tab at once and hands it the minted URL', async () => {
		const hop = vi.fn();
		const mint = vi.fn().mockResolvedValue( 'https://studio.test/wp-admin/admin.php?page=openstation&openstation_hop=tok' );
		const tab = { location: { href: '' } };
		const open = vi.spyOn( window, 'open' ).mockReturnValue( tab as unknown as Window );
		const el = buildSiteSwitcher(
			config( {
				sites: [
					{ id: '1', name: 'Main', shellUrl: MAIN_SHELL },
					{ id: 'member:abc', name: 'Studio', shellUrl: 'https://studio.test/wp-admin/admin.php?page=openstation', kind: 'member', foreign: true },
				],
			} ),
			{ hop, mint },
		);
		document.body.appendChild( el as HTMLElement );

		el?.querySelector( 'os-segment[value="member:abc"]' )?.dispatchEvent( new MouseEvent( 'click', { metaKey: true, bubbles: true, cancelable: true } ) );
		// The tab is open before anything awaits: that is what keeps it from being a popup.
		expect( open ).toHaveBeenCalledWith( '', '_blank' );
		expect( tab.location.href ).toBe( '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( tab.location.href ).toContain( 'openstation_hop=tok' );
		expect( hop ).not.toHaveBeenCalled();

		// A mint that fails still lands the tab on the plain shell.
		mint.mockRejectedValueOnce( new Error( 'no' ) );
		tab.location.href = '';
		el?.querySelector( 'os-segment[value="member:abc"]' )?.dispatchEvent( new MouseEvent( 'click', { metaKey: true, bubbles: true, cancelable: true } ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( tab.location.href ).toBe( shellUrlInOverview( 'https://studio.test/wp-admin/admin.php?page=openstation' ) );

		open.mockRestore();
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

	test( 'a site of this install mints nothing, and another install mints even on this origin', async () => {
		const here = window.location.origin + '/wp-admin/admin.php?page=openstation';
		const twin = window.location.origin + '/site-b/wp-admin/admin.php?page=openstation';
		expect( isOtherOrigin( here ) ).toBe( false );
		expect( isOtherOrigin( SHOP_SHELL ) ).toBe( true );
		// The direction arg rides only across origins: on this one the
		// sessionStorage hint follows the navigation by itself.
		expect( shellUrlInOverview( here, 'next' ) ).toBe( here + '&openstation_overview=1' );

		const hop = vi.fn();
		const mint = vi.fn( async ( target: string ) => target + '&openstation_overview=1&openstation_hop=signed' );
		const el = buildSiteSwitcher(
			config( {
				sites: [
					{ id: '1', name: 'Main', shellUrl: MAIN_SHELL },
					{ id: '9', name: 'Here', shellUrl: here },
					{ id: 'member:twin', name: 'Twin', shellUrl: twin, kind: 'member', foreign: true },
				],
			} ),
			{ hop, mint },
		);
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '9' } } ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( mint ).not.toHaveBeenCalled();
		expect( hop ).toHaveBeenCalledWith( here + '&openstation_overview=1' );

		// Same hostname, separate install: a token all the same.
		hop.mockClear();
		el?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'member:twin' } } ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( mint ).toHaveBeenCalledWith( twin, 'next' );
		expect( hop ).toHaveBeenCalledWith( twin + '&openstation_overview=1&openstation_hop=signed' );
	} );

	test( 'another install gets a login token minted, and hops without one when the mint fails', async () => {
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
