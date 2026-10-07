import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderDesktopIcons } from '../../src/desktop-icons';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
} from './helpers/hooks-stub';

const SVG_DATA_URI =
	'data:image/svg+xml;base64,' +
	btoa(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
	);

describe( 'desktop-icons render — data URI handling', () => {
	let host: HTMLElement;

	beforeEach( () => {
		installHooksStub();
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );

	afterEach( () => {
		host.remove();
		clearHooksStub();
	} );

	test( 'data:image/svg+xml URI renders as background-image, not a Dashicons class', () => {
		renderDesktopIcons(
			host,
			[
				{
					id:       'svg-icon',
					title:    'SVG Icon',
					icon:     SVG_DATA_URI,
					window:   'jorvy',
					url:      '',
					position: 0,
					pinned:   false,
				},
			],
			{ openWindow: () => true },
		);

		const tile = host.querySelector< HTMLElement >( '[data-icon-id="svg-icon"]' );
		expect( tile ).not.toBeNull();
		const iconEl = tile!.querySelector< HTMLElement >( '.os-icon__image' );
		expect( iconEl ).not.toBeNull();

		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( false );

		expect( iconEl!.style.backgroundImage ).toContain( 'data:image/svg+xml;base64,' );
	} );

	test( 'http(s) URL still renders as <img>', () => {
		renderDesktopIcons(
			host,
			[
				{
					id:       'url-icon',
					title:    'URL Icon',
					icon:     'https://example.com/icon.png',
					window:   'jorvy',
					url:      '',
					position: 0,
					pinned:   false,
				},
			],
			{ openWindow: () => true },
		);
		const tile = host.querySelector< HTMLElement >( '[data-icon-id="url-icon"]' );
		const img = tile!.querySelector< HTMLImageElement >( 'img.os-icon__image' );
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe( 'https://example.com/icon.png' );
	} );

	test( 'Dashicons class still renders with the dashicons + dashicons-* classes', () => {
		renderDesktopIcons(
			host,
			[
				{
					id:       'dashicon',
					title:    'Dashicon',
					icon:     'dashicons-star-filled',
					window:   'jorvy',
					url:      '',
					position: 0,
					pinned:   false,
				},
			],
			{ openWindow: () => true },
		);
		const tile = host.querySelector< HTMLElement >( '[data-icon-id="dashicon"]' );
		const iconEl = tile!.querySelector< HTMLElement >( '.os-icon__image' );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( true );
		expect( iconEl!.classList.contains( 'dashicons-star-filled' ) ).toBe( true );
	} );

	test( 'DESKTOP_ICONS_RENDERED payload carries ids + container + tiles map', () => {
		const hooks = installHooksStub();

		const log = recordActions( hooks, [ HOOKS.DESKTOP_ICONS_RENDERED ] );
		renderDesktopIcons(
			host,
			[
				{ id: 'a', title: 'A', icon: 'dashicons-admin-home', window: 'jorvy', url: '', position: 0, pinned: false },
				{ id: 'b', title: 'B', icon: 'dashicons-admin-home', window: 'jorvy', url: '', position: 1, pinned: false },
			],
			{ openWindow: () => true },
		);

		const fires = log.filter( ( e ) => e.name === HOOKS.DESKTOP_ICONS_RENDERED );
		expect( fires ).toHaveLength( 1 );
		const payload = fires[ 0 ].args[ 0 ] as {
			ids: string[];
			container: HTMLElement;
			tiles: ReadonlyMap< string, HTMLElement >;
		};
		expect( payload.ids ).toEqual( [ 'a', 'b' ] );
		expect( payload.container ).toBeInstanceOf( HTMLElement );
		expect( payload.container.classList.contains( 'os-icons' ) ).toBe( true );
		expect( payload.tiles.size ).toBe( 2 );
		expect( payload.tiles.get( 'a' )?.getAttribute( 'data-icon-id' ) ).toBe( 'a' );
		expect( payload.tiles.get( 'b' )?.getAttribute( 'data-icon-id' ) ).toBe( 'b' );

		expect( payload.container.contains( payload.tiles.get( 'a' )! ) ).toBe( true );
	} );

	test( 'unrecognised icon strings fall back to a letter badge instead of a broken Dashicons glue', () => {
		renderDesktopIcons(
			host,
			[
				{
					id:       'bogus',
					title:    'Bogus Plugin',
					icon:     'this-is-not-a-real-icon-string',
					window:   'jorvy',
					url:      '',
					position: 0,
					pinned:   false,
				},
			],
			{ openWindow: () => true },
		);
		const tile = host.querySelector< HTMLElement >( '[data-icon-id="bogus"]' );
		const iconEl = tile!.querySelector< HTMLElement >( '.os-icon__image' );
		expect( iconEl ).not.toBeNull();

		expect( iconEl!.classList.contains( 'os-icon-letter' ) ).toBe( true );

		expect( iconEl!.textContent ).toBe( 'BP' );
	} );
} );
