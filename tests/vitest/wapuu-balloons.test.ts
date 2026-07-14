/**
 * Wapuu widget — edge-aware balloon mirroring (`balloons.ts`).
 *
 * The pet engine flips a balloon to whichever side of Wapuu actually
 * has room (widget parked against a screen edge). The flip is done in
 * `fitBalloon` via `BalloonMirror`: the SVG drawing mirrors wholesale
 * inside a `<g>` transform while the HTML content stays readable, the
 * tail tip reflects numerically, and `updateChatTail` converts its
 * element-local aim target into the mirrored drawing space.
 *
 * @since 0.19.0
 */
import { describe, expect, test } from 'vitest';
import {
	createBalloon,
	fitBalloon,
	updateChatTail,
} from '../../src/plugins/wapuu-widget/balloons';

/** Content box the shapes are fitted around (jsdom measures 0×0). */
const CW = 120;
const CH = 40;

function fitted( type: 'speak' | 'yell' | 'think', tailSide: 'bottom' | 'right', mirror?: { mirrorX?: boolean; mirrorY?: boolean } ) {
	const el = createBalloon( type, 'Hello there' );
	document.body.appendChild( el );
	const content = el.querySelector< HTMLElement >( '.wapuu-balloon__content' );
	if ( ! content ) {
		throw new Error( 'balloon content missing' );
	}
	Object.defineProperty( content, 'offsetWidth', { value: CW, configurable: true } );
	Object.defineProperty( content, 'offsetHeight', { value: CH, configurable: true } );
	const tip = fitBalloon( el, type, tailSide, mirror );
	return { el, content, tip };
}

describe( 'wapuu balloons — mirroring', () => {
	test( 'mirrorX reflects the tail tip across the element width', () => {
		const normal = fitted( 'speak', 'bottom' );
		const mirrored = fitted( 'speak', 'bottom', { mirrorX: true } );
		const width = parseFloat( normal.el.style.width );
		expect( width ).toBeGreaterThan( 0 );
		// Same box either way — only the drawing flips.
		expect( mirrored.el.style.width ).toBe( normal.el.style.width );
		expect( mirrored.el.style.height ).toBe( normal.el.style.height );
		expect( mirrored.tip.x ).toBeCloseTo( width - normal.tip.x, 1 );
		expect( mirrored.tip.y ).toBeCloseTo( normal.tip.y, 1 );
	} );

	test( 'mirrorY reflects the tail tip across the element height', () => {
		const normal = fitted( 'think', 'bottom' );
		const mirrored = fitted( 'think', 'bottom', { mirrorY: true } );
		const height = parseFloat( normal.el.style.height );
		expect( height ).toBeGreaterThan( 0 );
		expect( mirrored.tip.y ).toBeCloseTo( height - normal.tip.y, 1 );
		expect( mirrored.tip.x ).toBeCloseTo( normal.tip.x, 1 );
	} );

	test( 'mirrored drawing is wrapped in a flip <g>; content is not mirrored', () => {
		const normal = fitted( 'speak', 'bottom' );
		const mirrored = fitted( 'speak', 'bottom', { mirrorX: true, mirrorY: true } );
		expect( normal.el.innerHTML ).not.toContain( 'scale(-1 -1)' );
		expect( mirrored.el.innerHTML ).toContain( 'scale(-1 -1)' );
		// Symmetric horizontal padding → the (unmirrored) HTML content
		// keeps its left offset. Vertically the speak bubble's BODY flips
		// to the bottom (tail on top), so the content follows it down by
		// exactly the tail region: contentY 22 (padY) → 74 (tailH+padY).
		expect( mirrored.content.style.left ).toBe( normal.content.style.left );
		const normalTop = parseFloat( normal.content.style.top );
		const mirroredTop = parseFloat( mirrored.content.style.top );
		const height = parseFloat( normal.el.style.height );
		expect( mirroredTop ).toBeCloseTo( height - normalTop - CH, 1 );
	} );

	test( 'mirrorY keeps the balloon lit from the visual top (gradient ramp swapped)', () => {
		const normal = fitted( 'speak', 'bottom' );
		const mirrored = fitted( 'speak', 'bottom', { mirrorY: true } );
		const grad = ( el: HTMLElement ): SVGLinearGradientElement => {
			const g = el.querySelector( 'linearGradient' );
			if ( ! g ) {
				throw new Error( 'gradient missing' );
			}
			return g as SVGLinearGradientElement;
		};
		expect( grad( normal.el ).getAttribute( 'y1' ) ).toBe( '0' );
		expect( grad( mirrored.el ).getAttribute( 'y2' ) ).toBe( '0' );
	} );

	test( 'fitBalloon flags the element so the chat tail aims in mirrored space', () => {
		const normal = fitted( 'speak', 'right' );
		const mirrored = fitted( 'speak', 'right', { mirrorX: true } );
		expect( normal.el.dataset.wapuuMirrorX ).toBe( '0' );
		expect( mirrored.el.dataset.wapuuMirrorX ).toBe( '1' );
	} );

	test( 'updateChatTail on a mirrored bubble equals the reflected aim on a normal one', () => {
		// Property: converting the target into mirrored drawing space
		// means aiming a mirrored bubble at x is the same path as aiming
		// a normal bubble at (bw - x).
		const normal = fitted( 'speak', 'right' );
		const mirrored = fitted( 'speak', 'right', { mirrorX: true } );
		const bw = parseFloat( normal.el.dataset.wapuuBw || '0' );
		expect( bw ).toBeGreaterThan( 0 );
		const ty = parseFloat( normal.el.dataset.wapuuBh || '0' ) / 2;
		updateChatTail( mirrored.el, -70, ty ); // target left of the bubble
		updateChatTail( normal.el, bw + 70, ty ); // reflected target, right side
		const d = ( el: HTMLElement ): string =>
			el
				.querySelector( '.wapuu-balloon__bubble' )
				?.getAttribute( 'd' ) || '';
		expect( d( mirrored.el ) ).toBe( d( normal.el ) );
		expect( d( mirrored.el ) ).not.toBe( '' );
	} );
} );
