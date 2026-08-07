/**
 * About tab — the poster that stands in for the PixiJS scene.
 *
 * The scene is gated on the PixiJS vendor bundle, the about-scene
 * bundle and the logotype PNG, so there is a real window where the
 * tabpanel has nothing to show. These tests pin what the user sees
 * during that window (the credits, the version, a spinner), and what
 * happens to it on both exits: the scene going live, and the scene
 * failing to load at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mountAboutSceneLazy = vi.fn();

vi.mock( '../../src/settings/sections/about-scene-loader', () => ( {
	mountAboutSceneLazy: ( ...args: unknown[] ) =>
		mountAboutSceneLazy( ...args ),
} ) );

/** Sized-element getters — jsdom reports every box as 0×0. */
let sizeSpies: Array< () => void > = [];

function stubLayoutBoxes( width: number, height: number ): void {
	for ( const prop of [ 'clientWidth', 'clientHeight' ] as const ) {
		const original = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			prop,
		);
		Object.defineProperty( HTMLElement.prototype, prop, {
			configurable: true,
			get: () => ( prop === 'clientWidth' ? width : height ),
		} );
		sizeSpies.push( () => {
			if ( original ) {
				Object.defineProperty( HTMLElement.prototype, prop, original );
			} else {
				delete ( HTMLElement.prototype as unknown as Record<
					string,
					unknown
				> )[ prop ];
			}
		} );
	}
}

/** Flush the deferred mount (rAF) plus the promise chain inside it. */
async function flushMount(): Promise< void > {
	for ( let i = 0; i < 8; i++ ) {
		await new Promise( ( resolve ) => {
			requestAnimationFrame( () => resolve( null ) );
		} );
		await Promise.resolve();
	}
}

async function buildSection(): Promise< HTMLElement > {
	const { buildAboutSection } = await import(
		'../../src/settings/sections/about'
	);
	const el = buildAboutSection();
	document.body.appendChild( el );
	return el;
}

describe( 'About tab poster', () => {
	beforeEach( () => {
		vi.resetModules();
		mountAboutSceneLazy.mockReset();
		sizeSpies = [];
		stubLayoutBoxes( 800, 600 );
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig =
			{
				pluginUrl: 'https://example.test/plugin',
				pluginVersion: '1.2.3',
				aboutSceneBundleUrl: 'https://example.test/about-scene.js',
			};
		( window as unknown as { ResizeObserver?: unknown } ).ResizeObserver =
			class {
				constructor( private readonly cb: () => void ) {}
				observe(): void {
					this.cb();
				}
				disconnect(): void {}
				unobserve(): void {}
			};
	} );

	afterEach( () => {
		for ( const restore of sizeSpies ) {
			restore();
		}
		sizeSpies = [];
		document.body.innerHTML = '';
		delete ( window as unknown as { openStationConfig?: unknown } )
			.openStationConfig;
		vi.restoreAllMocks();
	} );

	test( 'paints the credits and the version before the scene loads', async () => {
		mountAboutSceneLazy.mockReturnValue( new Promise( () => {} ) );
		const el = await buildSection();

		// Synchronous — no awaiting, no rAF: this is the first frame.
		const poster = el.querySelector( '[data-about-poster]' );
		expect( poster ).not.toBeNull();
		expect( poster?.textContent ).toContain( 'Crafted with curiosity' );
		expect( poster?.textContent ).toContain( 'an experiment by Automattic' );
		expect( poster?.textContent ).toContain( 'Version 1.2.3' );
		expect( el.querySelector( '[data-about-loader] os-spinner' ) ).not.toBeNull();
		expect( el.classList.contains( 'is-scene-ready' ) ).toBe( false );
	} );

	test( 'hands over to the canvas once the scene mounts', async () => {
		const destroy = vi.fn();
		mountAboutSceneLazy.mockResolvedValue( {
			destroy,
			setAnimating: vi.fn(),
		} );
		const el = await buildSection();
		await flushMount();

		expect( mountAboutSceneLazy ).toHaveBeenCalledTimes( 1 );
		expect( el.classList.contains( 'is-scene-ready' ) ).toBe( true );
		// Spinner gone, poster still in the DOM: the canvas exposes no
		// text, so the faded poster stays the accessible copy.
		expect( el.querySelector( '[data-about-loader] os-spinner' ) ).toBeNull();
		expect( el.querySelector( '[data-about-poster]' ) ).not.toBeNull();
		expect(
			el.querySelector( '[data-about-poster]' )?.textContent,
		).toContain( 'Version 1.2.3' );
	} );

	test( 'keeps the credits readable when the scene fails to load', async () => {
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		mountAboutSceneLazy.mockRejectedValue( new Error( 'no webgl' ) );
		const el = await buildSection();
		await flushMount();

		expect( el.classList.contains( 'is-scene-failed' ) ).toBe( true );
		expect( el.classList.contains( 'is-scene-ready' ) ).toBe( false );
		// A spinner that spins forever would be a lie.
		expect( el.querySelector( '[data-about-loader] os-spinner' ) ).toBeNull();
		expect(
			el.querySelector( '[data-about-poster]' )?.textContent,
		).toContain( 'Crafted with curiosity' );
	} );

	test( 'forwards one set of labels to the poster and the scene', async () => {
		mountAboutSceneLazy.mockResolvedValue( {
			destroy: vi.fn(),
			setAnimating: vi.fn(),
		} );
		const el = await buildSection();
		await flushMount();

		const opts = mountAboutSceneLazy.mock.calls[ 0 ][ 0 ] as {
			labels: Record< string, string >;
		};
		const posterText =
			el.querySelector( '[data-about-poster]' )?.textContent ?? '';
		for ( const key of [ 'eyebrow', 'title', 'byline', 'version' ] ) {
			expect( posterText ).toContain( opts.labels[ key ] );
		}
	} );
} );
