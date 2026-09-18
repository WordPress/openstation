/**
 * Tests for the deactivation feedback dialog.
 *
 * Two promises are worth guarding: nothing is sent unless the admin
 * clicks Send, and the deactivation goes ahead whatever the send did.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type FetchArgs = ( url: string, init?: RequestInit, opts?: unknown ) => Promise< unknown >;

const trackedFetch = vi.fn< FetchArgs >( () => Promise.resolve( new Response( '{"sent":true}' ) ) );
vi.mock( '../tracked-fetch', () => ( {
	trackedFetch: ( url: string, init?: RequestInit, opts?: unknown ) => trackedFetch( url, init, opts ),
} ) );

import { interceptPluginsScreen, type DeactivationFeedbackConfig } from './index';

const PLUGIN = 'desktop-mode/desktop-mode.php';
const HREF = 'http://example.test/wp-admin/plugins.php?action=deactivate&plugin=desktop-mode%2Fdesktop-mode.php';

function config(): DeactivationFeedbackConfig {
	return {
		plugin: PLUGIN,
		restUrl: 'http://example.test/wp-json/desktop-mode/v1/feedback/deactivation',
		restNonce: 'nonce123',
		context: 'classic',
	};
}

/** A classic plugins.php row for our plugin, plus one for a bystander. */
function mountRows(): HTMLAnchorElement {
	document.body.innerHTML =
		'<table><tbody>' +
		'<tr data-plugin="akismet/akismet.php"><td><span class="deactivate"><a href="#other">Deactivate</a></span></td></tr>' +
		`<tr data-plugin="${ PLUGIN }"><td><span class="deactivate"><a href="${ HREF }">Deactivate</a></span></td></tr>` +
		'</tbody></table>';
	return document.querySelector< HTMLAnchorElement >( `tr[data-plugin="${ PLUGIN }"] a` )!;
}

const dialog = (): HTMLElement | null => document.querySelector( '.os-deactivation-feedback' );
const button = ( which: 'ghost' | 'primary' ): HTMLButtonElement =>
	document.querySelector< HTMLButtonElement >( `.os-deactivation-feedback__btn--${ which }` )!;

async function settle(): Promise< void > {
	for ( let i = 0; i < 5; i++ ) {
		await Promise.resolve();
	}
}

let dispose: ( () => void ) | null = null;

beforeEach( () => {
	trackedFetch.mockClear();
	trackedFetch.mockImplementation( () => Promise.resolve( new Response( '{"sent":true}' ) ) );
} );

afterEach( () => {
	dispose?.();
	dispose = null;
} );

describe( 'interceptPluginsScreen', () => {
	test( 'Skip sends nothing and follows the Deactivate link', async () => {
		const link = mountRows();
		const navigate = vi.fn();
		dispose = interceptPluginsScreen( config(), { navigate } );

		link.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } ) );
		expect( dialog() ).not.toBeNull();
		expect( navigate ).not.toHaveBeenCalled();
		// Send is inert until a reason is ticked.
		expect( button( 'primary' ).disabled ).toBe( true );

		button( 'ghost' ).click();
		await settle();

		expect( trackedFetch ).not.toHaveBeenCalled();
		expect( dialog() ).toBeNull();
		expect( navigate ).toHaveBeenCalledWith( HREF );
	} );

	test( 'Send posts once and still deactivates when the route fails', async () => {
		trackedFetch.mockImplementation( () => Promise.reject( new Error( 'offline' ) ) );
		const link = mountRows();
		const navigate = vi.fn();
		dispose = interceptPluginsScreen( config(), { navigate } );
		link.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } ) );

		for ( const value of [ 'too_buggy', 'other' ] ) {
			const box = document.querySelector< HTMLInputElement >( `input[value="${ value }"]` )!;
			box.checked = true;
			box.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		}
		const details = document.querySelector< HTMLTextAreaElement >( '.os-deactivation-feedback__details' )!;
		expect( details.placeholder ).toMatch( /page or plugin/ );
		details.value = 'Elementor editor went blank';
		expect( button( 'primary' ).disabled ).toBe( false );

		document.querySelector< HTMLFormElement >( '.os-deactivation-feedback__card' )!
			.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );
		await settle();

		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
		const [ url, init, opts ] = trackedFetch.mock.calls[ 0 ];
		expect( url ).toBe( config().restUrl );
		expect( init?.method ).toBe( 'POST' );
		expect( ( init?.headers as Record< string, string > )[ 'X-WP-Nonce' ] ).toBe( 'nonce123' );
		expect( JSON.parse( String( init?.body ) ) ).toEqual( {
			reasons: [ 'too_buggy', 'other' ],
			details: 'Elementor editor went blank',
			context: 'classic',
		} );
		expect( opts ).toMatchObject( { silent: true } );
		expect( dialog() ).toBeNull();
		expect( navigate ).toHaveBeenCalledWith( HREF );
	} );

	test( 'details alone are sent as Other', async () => {
		const link = mountRows();
		const navigate = vi.fn();
		dispose = interceptPluginsScreen( config(), { navigate } );
		link.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } ) );

		const details = document.querySelector< HTMLTextAreaElement >( '.os-deactivation-feedback__details' )!;
		details.value = 'Conflicts with my page builder';
		details.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( button( 'primary' ).disabled ).toBe( false );

		document.querySelector< HTMLFormElement >( '.os-deactivation-feedback__card' )!
			.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );
		await settle();

		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
		expect( JSON.parse( String( trackedFetch.mock.calls[ 0 ][ 1 ]?.body ) ) ).toMatchObject( {
			reasons: [ 'other' ],
			details: 'Conflicts with my page builder',
		} );
		expect( navigate ).toHaveBeenCalledWith( HREF );
	} );

	test( 'Escape is Skip, and another plugin\u2019s Deactivate link is left alone', async () => {
		const link = mountRows();
		const navigate = vi.fn();
		dispose = interceptPluginsScreen( config(), { navigate } );

		const other = document.querySelector< HTMLAnchorElement >( 'tr[data-plugin="akismet/akismet.php"] a' )!;
		const otherClick = new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } );
		other.dispatchEvent( otherClick );
		expect( otherClick.defaultPrevented ).toBe( false );
		expect( dialog() ).toBeNull();

		link.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		await settle();

		expect( trackedFetch ).not.toHaveBeenCalled();
		expect( dialog() ).toBeNull();
		expect( navigate ).toHaveBeenCalledWith( HREF );
	} );
} );
