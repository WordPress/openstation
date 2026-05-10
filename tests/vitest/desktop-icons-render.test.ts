/**
 * Regression test for the desktop-icon wallpaper renderer.
 *
 * Pre-0.8.2, `buildIcon` in `src/desktop-icons.ts` only handled
 * http(s) URLs and Dashicons class strings — anything else fell
 * through to a `dashicons + sanitizeClassName(entry.icon)` glue
 * path. A `data:image/svg+xml;base64,…` icon (the shape produced
 * by `desktop_mode_register_icon( … 'icon_svg' => '<svg…/>' … )`
 * and by any plugin assigning a sanitized data URI) wound up as a
 * malformed Dashicons class name → empty square.
 *
 * The dock had a separate path through `renderIcon()` that did
 * the right thing. This regression test pins that the wallpaper
 * renderer now also routes through `renderIcon()` so SVG data
 * URIs paint as a real background-image instead of broken class
 * glue.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderDesktopIcons } from '../../src/desktop-icons';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

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
		const iconEl = tile!.querySelector< HTMLElement >( '.desktop-mode-icon__image' );
		expect( iconEl ).not.toBeNull();

		// Must NOT be misclassified as Dashicons. Pre-fix, the icon
		// element had `class="desktop-mode-icon__image dashicons data:image..."`.
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( false );

		// MUST paint as a CSS background-image referencing the data URI.
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
		const img = tile!.querySelector< HTMLImageElement >( 'img.desktop-mode-icon__image' );
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
		const iconEl = tile!.querySelector< HTMLElement >( '.desktop-mode-icon__image' );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( true );
		expect( iconEl!.classList.contains( 'dashicons-star-filled' ) ).toBe( true );
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
		const iconEl = tile!.querySelector< HTMLElement >( '.desktop-mode-icon__image' );
		expect( iconEl ).not.toBeNull();
		// Letter-badge fallback uses a class on the canonical renderer.
		expect( iconEl!.classList.contains( 'desktop-mode-icon-letter' ) ).toBe( true );
		// Letters from the title — first letters of each word, uppercased.
		expect( iconEl!.textContent ).toBe( 'BP' );
	} );
} );
