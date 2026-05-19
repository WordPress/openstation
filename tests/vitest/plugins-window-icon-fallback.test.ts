/**
 * Tests for `attachIconFallback` — the JS-side wp.org icon candidate
 * walker that papers over the format zoo at `ps.w.org/<slug>/assets/`
 * (SVG, PNG, animated GIF). For each `<img>` `error`, the chain
 * advances to the next variant; when every candidate fails, the
 * caller's `onExhausted` callback fires (which paints the placeholder).
 *
 * Why this matters: plugins like Elementor ship animated GIF icons —
 * `icon-128x128.gif` / `icon-256x256.gif` — and the PHP REST field
 * always returns the SVG default. Without the GIF variants in the
 * chain, Elementor (and any other GIF-only row) painted the
 * placeholder despite having art on the wp.org SVN.
 */

import { describe, expect, test } from 'vitest';
import { attachIconFallback } from '../../src/plugins-window/icon-fallback';

function makeImg(): HTMLImageElement {
	return document.createElement( 'img' );
}

function fireError( img: HTMLImageElement ): void {
	img.dispatchEvent( new Event( 'error' ) );
}

describe( 'attachIconFallback', () => {
	test( 'returns the input URL as the first src for wp.org default', () => {
		const img         = makeImg();
		const initial     = 'https://ps.w.org/elementor/assets/icon.svg';
		const firstSrc    = attachIconFallback( img, initial, () => {} );

		expect( firstSrc ).toBe( initial );
	} );

	test( 'walks SVG → 256 PNG → 256 GIF → 128 PNG → 128 GIF for wp.org URLs', () => {
		const img    = makeImg();
		const base   = 'https://ps.w.org/elementor/assets/';
		const seen: string[] = [];

		const firstSrc = attachIconFallback(
			img,
			base + 'icon.svg',
			() => seen.push( '__exhausted__' ),
		);
		seen.push( firstSrc );
		img.src = firstSrc;

		// Fire 4 errors → should advance through 4 fallback variants.
		for ( let i = 0; i < 4; i++ ) {
			fireError( img );
			seen.push( img.src );
		}

		expect( seen ).toEqual( [
			base + 'icon.svg',
			base + 'icon-256x256.png',
			base + 'icon-256x256.gif',
			base + 'icon-128x128.png',
			base + 'icon-128x128.gif',
		] );
	} );

	test( 'calls onExhausted after every variant has 404d', () => {
		const img        = makeImg();
		const base       = 'https://ps.w.org/elementor/assets/';
		let   exhausted  = false;

		const firstSrc = attachIconFallback(
			img,
			base + 'icon.svg',
			() => {
				exhausted = true;
			},
		);
		img.src = firstSrc;

		// 5 candidates total → 5 errors triggers onExhausted on the 5th.
		for ( let i = 0; i < 5; i++ ) {
			fireError( img );
		}

		expect( exhausted ).toBe( true );
	} );

	test( 'custom (non-wp.org) URLs bypass the fallback chain', () => {
		const img        = makeImg();
		const custom     = 'https://cdn.example.com/my-plugin/icon.png';
		let   exhausted  = false;

		const firstSrc = attachIconFallback( img, custom, () => {
			exhausted = true;
		} );

		expect( firstSrc ).toBe( custom );

		// One-shot: a single error should exhaust immediately.
		img.src = firstSrc;
		fireError( img );
		expect( exhausted ).toBe( true );
	} );

	test( 'local plugin folder URLs are treated as custom (one-shot)', () => {
		const img        = makeImg();
		// `plugins_url()` shape — same host as the site, under wp-content.
		const local      = 'http://example.test/wp-content/plugins/my-plugin/assets/icon.svg';
		let   exhausted  = false;

		const firstSrc = attachIconFallback( img, local, () => {
			exhausted = true;
		} );

		expect( firstSrc ).toBe( local );

		img.src = firstSrc;
		fireError( img );
		expect( exhausted ).toBe( true );
	} );
} );
