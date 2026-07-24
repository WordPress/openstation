/**
 * Unit tests for the games framework's shareable score card
 * (`src/games/share-card.ts`): score formatting and the one-tap
 * share fallback chain (share sheet → clipboard → download).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	formatScore,
	renderShareCard,
	shareScoreCard,
} from '../../src/games/share-card';

/** A canvas stand-in — jsdom has no real 2D context or toBlob. */
function fakeCanvas(): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		getContext: () => null,
		toBlob: ( cb: ( blob: Blob | null ) => void ) =>
			cb( new Blob( [ 'png' ], { type: 'image/png' } ) ),
		toDataURL: () => 'data:image/png;base64,x',
	} as unknown as HTMLCanvasElement;
}

const nav = window.navigator as unknown as {
	share?: unknown;
	canShare?: unknown;
	clipboard?: unknown;
};

afterEach( () => {
	vi.restoreAllMocks();
	delete nav.share;
	delete nav.canShare;
	vi.unstubAllGlobals();
} );

describe( 'games/share-card.ts', () => {
	test( 'formatScore rounds and never goes negative', () => {
		expect( formatScore( 1234.4 ) ).toBe( ( 1234 ).toLocaleString() );
		expect( formatScore( -10 ) ).toBe( '0' );
	} );

	test( 'renderShareCard survives a context-less canvas', () => {
		const canvas = fakeCanvas();
		expect( () =>
			renderShareCard( canvas, {
				gameTitle: 'Alphabet Soup',
				puzzleLabel: 'Daily · 18-07-2026',
				score: 4520,
				scoreLabel: 'points',
				stats: [ { label: 'Words', value: '21' } ],
				footer: 'WordPress Desktop Mode',
			} ),
		).not.toThrow();
		// The backing size is still stamped for a later real render.
		expect( canvas.width ).toBe( 1200 );
		expect( canvas.height ).toBe( 630 );
	} );

	test( 'prefers the native share sheet with the PNG attached', async () => {
		const share = vi.fn().mockResolvedValue( undefined );
		nav.share = share;
		nav.canShare = () => true;
		const outcome = await shareScoreCard(
			fakeCanvas(),
			'soup.png',
			'Alphabet Soup',
		);
		expect( outcome ).toBe( 'shared' );
		expect( share ).toHaveBeenCalledTimes( 1 );
		const arg = share.mock.calls[ 0 ][ 0 ] as { files: File[] };
		expect( arg.files[ 0 ].name ).toBe( 'soup.png' );
		expect( arg.files[ 0 ].type ).toBe( 'image/png' );
	} );

	test( 'falls back to the clipboard when sharing is dismissed', async () => {
		nav.share = vi.fn().mockRejectedValue( new Error( 'dismissed' ) );
		nav.canShare = () => true;
		const write = vi.fn().mockResolvedValue( undefined );
		Object.defineProperty( window.navigator, 'clipboard', {
			value: { write },
			configurable: true,
		} );
		vi.stubGlobal(
			'ClipboardItem',
			class {
				public items: unknown;
				public constructor( items: unknown ) {
					this.items = items;
				}
			},
		);
		const outcome = await shareScoreCard(
			fakeCanvas(),
			'soup.png',
			'Alphabet Soup',
		);
		expect( outcome ).toBe( 'copied' );
		expect( write ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'falls back to a plain download when nothing else exists', async () => {
		Object.defineProperty( window.navigator, 'clipboard', {
			value: undefined,
			configurable: true,
		} );
		const click = vi
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => undefined );
		const outcome = await shareScoreCard(
			fakeCanvas(),
			'soup.png',
			'Alphabet Soup',
		);
		expect( outcome ).toBe( 'downloaded' );
		expect( click ).toHaveBeenCalledTimes( 1 );
	} );
} );
