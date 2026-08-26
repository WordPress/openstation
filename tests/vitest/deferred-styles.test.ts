/**
 * Deferred stylesheets for on-demand shell surfaces.
 *
 * The Preferences panel, the AI assistant and the bug-report window
 * are shell-built surfaces, not native windows, so their CSS cannot
 * ride a registration's `styles` companion list. It travels in
 * `openStationConfig.deferredStyles` instead, and the surface's open
 * path injects it through `ensureDeferredStyle()`. These tests pin
 * the injector's contract: once per handle, inline blobs replayed
 * after the link, a server-printed link adopted rather than
 * duplicated, and a clean no-op when the map has nothing — a missing
 * stylesheet must never block the surface from rendering.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	ensureDeferredStyle,
	__resetDeferredStylesForTests,
} from '../../src/deferred-styles';

type ConfigCarrier = {
	openStationConfig?: {
		deferredStyles?: Record<
			string,
			{ url: string; inline?: string[] }
		>;
	};
};

function setConfig(
	map: Record< string, { url: string; inline?: string[] } >,
): void {
	( window as unknown as ConfigCarrier ).openStationConfig = {
		deferredStyles: map,
	};
}

describe( 'ensureDeferredStyle', () => {
	beforeEach( () => {
		__resetDeferredStylesForTests();
	} );

	afterEach( () => {
		delete ( window as unknown as ConfigCarrier ).openStationConfig;
		document.head
			.querySelectorAll( '[data-os-style-handle]' )
			.forEach( ( el ) => el.remove() );
		document.head
			.querySelectorAll( 'link[rel="stylesheet"]' )
			.forEach( ( el ) => el.remove() );
	} );

	test( 'injects the link and replays inline blobs after it', () => {
		setConfig( {
			'os-settings': {
				url: 'https://example.test/os-settings.css',
				inline: [ '.os-settings{color:red}' ],
			},
		} );

		ensureDeferredStyle( 'os-settings' );

		const link = document.head.querySelector< HTMLLinkElement >(
			'link[data-os-style-handle="os-settings"]',
		);
		expect( link?.href ).toBe( 'https://example.test/os-settings.css' );
		const style = document.head.querySelector< HTMLStyleElement >(
			'style[data-os-style-handle="os-settings"]',
		);
		expect( style?.textContent ).toBe( '.os-settings{color:red}' );
		// The inline blob follows the link, matching print order.
		expect(
			link &&
				style &&
				link.compareDocumentPosition( style ) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	} );

	test( 'a second call is a no-op', () => {
		setConfig( {
			'os-settings': { url: 'https://example.test/os-settings.css' },
		} );

		ensureDeferredStyle( 'os-settings' );
		ensureDeferredStyle( 'os-settings' );

		expect(
			document.head.querySelectorAll(
				'link[data-os-style-handle="os-settings"]',
			),
		).toHaveLength( 1 );
	} );

	test( 'a handle missing from the map is a silent no-op', () => {
		setConfig( {} );

		expect( () => ensureDeferredStyle( 'nope' ) ).not.toThrow();
		expect(
			document.head.querySelector( '[data-os-style-handle]' ),
		).toBeNull();
	} );

	test( 'no config at all is a silent no-op', () => {
		delete ( window as unknown as ConfigCarrier ).openStationConfig;

		expect( () => ensureDeferredStyle( 'os-settings' ) ).not.toThrow();
	} );

	test( 'a server-printed link is adopted, not duplicated', () => {
		const printed = document.createElement( 'link' );
		printed.rel = 'stylesheet';
		printed.href = 'https://example.test/os-settings.css';
		document.head.appendChild( printed );

		setConfig( {
			'os-settings': { url: 'https://example.test/os-settings.css' },
		} );

		ensureDeferredStyle( 'os-settings' );

		expect(
			document.head.querySelectorAll(
				'link[rel="stylesheet"][href="https://example.test/os-settings.css"]',
			),
		).toHaveLength( 1 );
	} );
} );
