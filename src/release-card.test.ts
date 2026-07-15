/**
 * Tests for the release-card module (`showReleaseCard`). The art paint is
 * skipped in jsdom (the image never loads), so we assert the DOM the card
 * builds and its close / update behavior.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { showReleaseCard, type ReleaseCardOptions } from './release-card';
import { isNoticeDismissed } from './ui/components/wpd-notice/storage';

function open( over: Partial< ReleaseCardOptions > = {} ): {
	dismiss: () => void;
	root: HTMLElement;
} {
	const dismiss = showReleaseCard( {
		message: 'WordPress 7.0 "Armstrong" is available.',
		artUrl: 'https://example.com/7.0.png',
		dismissKey: 'desktop-mode/core-update:7.0',
		onUpdate: () => undefined,
		...over,
	} );
	const root = document.querySelector( '.dm-release-card' ) as HTMLElement;
	return { dismiss, root };
}

beforeEach( () => localStorage.clear() );
afterEach( () => {
	document.querySelector( '.desktop-mode-release-host' )?.remove();
	document.getElementById( 'desktop-mode-release-card-styles' )?.remove();
	localStorage.clear();
} );

describe( 'showReleaseCard', () => {
	test( 'mounts the card with the WordPress-logo label and the given message', () => {
		const { root } = open();
		expect( root ).not.toBeNull();
		expect( root.querySelector( '.dm-rc__label svg' ) ).not.toBeNull();
		expect( root.querySelector( '.dm-rc__canvas' ) ).not.toBeNull();
		expect( root.querySelector( '.dm-rc__text' )!.textContent ).toBe(
			'WordPress 7.0 "Armstrong" is available.',
		);
		expect( root.querySelector( '.dm-rc__btn' )!.textContent ).toBeTruthy();
	} );

	test( 'renders the message as plain text (no HTML injection)', () => {
		const { root } = open( { message: 'WordPress 7.0.1 is available.' } );
		expect( root.querySelector( '.dm-rc__text' )!.textContent ).toBe(
			'WordPress 7.0.1 is available.',
		);
	} );

	test( 'an explicit accent is applied to the card', () => {
		const { root } = open( { accent: '#ef5a3c', accentInk: '#171717' } );
		expect( root.style.getPropertyValue( '--accent' ) ).toBe( '#ef5a3c' );
		expect( root.style.getPropertyValue( '--accent-ink' ) ).toBe( '#171717' );
	} );

	test( 'Update button fires onUpdate and removes the card', () => {
		const onUpdate = vi.fn();
		const { root } = open( { onUpdate } );
		( root.querySelector( '.dm-rc__btn' ) as HTMLButtonElement ).click();
		expect( onUpdate ).toHaveBeenCalledTimes( 1 );
		expect( document.querySelector( '.dm-release-card' ) ).toBeNull();
	} );

	test( 'close button persists the dismissal and fades the card out', () => {
		const { root } = open();
		( root.querySelector( '.dm-rc__close' ) as HTMLButtonElement ).click();
		expect( isNoticeDismissed( 'desktop-mode/core-update:7.0' ) ).toBe( true );
		// Fade started: entrance animation cleared + opacity transition set.
		expect( root.style.animation ).toBe( 'none' );
		expect( root.style.transition ).toContain( 'opacity' );
	} );

	test( 'the returned dismiss removes the card without persisting', () => {
		const { dismiss } = open();
		dismiss();
		expect( document.querySelector( '.dm-release-card' ) ).toBeNull();
		expect( isNoticeDismissed( 'desktop-mode/core-update:7.0' ) ).toBe( false );
	} );
} );
