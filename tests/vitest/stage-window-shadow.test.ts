/**
 * Tests for the drawn stand-in shadow.
 *
 * A window capture is taken from the border box and `box-shadow` paints
 * outside it, so the frozen copy never carried one — and the shadow
 * snapped into existence the instant an effect handed the window back.
 * The parser below is what turns the real CSS into something PixiJS can
 * draw, so its edge cases are the contract.
 */
import { describe, expect, test } from 'vitest';
import {
	blurStrength,
	createWindowShadow,
	parseBoxShadow,
	parseCornerRadius,
} from '../../src/stage/window-fx/shadow';

describe( 'parseBoxShadow', () => {
	test( 'reads the resolved form getComputedStyle produces', () => {
		expect( parseBoxShadow( 'rgba(0, 0, 0, 0.3) 0px 8px 32px 0px' ) ).toEqual(
			[
				{
					color: 0x000000,
					alpha: 0.3,
					offsetX: 0,
					offsetY: 8,
					blur: 32,
					spread: 0,
				},
			],
		);
	} );

	test( 'keeps EVERY layer, and is not fooled by commas inside rgba()', () => {
		// Both matter: a naive `value.split(',')` splits inside the colour
		// function and yields nonsense, and every window shadow we ship is
		// two layers — a wide ambient one and a tight contact one. Drawing
		// only the first left a soft grey smudge with no defined edge.
		const specs = parseBoxShadow(
			'rgba(0, 0, 0, 0.4) 0px 12px 48px 0px, rgba(0, 0, 0, 0.2) 0px 4px 12px 0px',
		);
		expect( specs ).toHaveLength( 2 );
		expect( specs[ 0 ].blur ).toBe( 48 );
		expect( specs[ 1 ].blur ).toBe( 12 );
		expect( specs[ 1 ].alpha ).toBe( 0.2 );
	} );

	test( 'handles opaque rgb() with no alpha channel', () => {
		expect( parseBoxShadow( 'rgb(17, 34, 51) 4px 6px 10px' ) ).toEqual( [
			{
				color: 0x112233,
				alpha: 1,
				offsetX: 4,
				offsetY: 6,
				blur: 10,
				spread: 0,
			},
		] );
	} );

	test( 'keeps negative offsets and a spread', () => {
		const [ spec ] = parseBoxShadow( 'rgba(0, 0, 0, 0.5) -6px -4px 12px 3px' );
		expect( spec.offsetX ).toBe( -6 );
		expect( spec.offsetY ).toBe( -4 );
		expect( spec.spread ).toBe( 3 );
	} );

	test( 'returns nothing for none, empty, and unparseable values', () => {
		expect( parseBoxShadow( 'none' ) ).toEqual( [] );
		expect( parseBoxShadow( '  ' ) ).toEqual( [] );
		expect( parseBoxShadow( 'currentColor 1px 1px' ) ).toEqual( [] );
		// Offsets are required.
		expect( parseBoxShadow( 'rgba(0, 0, 0, 0.3) 4px' ) ).toEqual( [] );
		// Fully transparent draws nothing but a blur pass.
		expect( parseBoxShadow( 'rgba(0, 0, 0, 0) 0px 8px 32px' ) ).toEqual( [] );
	} );

	test( 'skips inset layers but keeps their siblings', () => {
		// Inset shadows paint INSIDE the box, so they are already in the
		// capture and drawing them again would double them.
		const specs = parseBoxShadow(
			'rgba(0, 0, 0, 0.3) 0px 2px 4px 0px inset, rgba(0, 0, 0, 0.4) 0px 12px 48px 0px',
		);
		expect( specs ).toHaveLength( 1 );
		expect( specs[ 0 ].blur ).toBe( 48 );
	} );

	test( 'draws nothing for the staged desktop, which turns shadows off', () => {
		/*
		 * `stage.css` zeroes the shadow tokens while the desktop is in
		 * the canvas — as a TRANSPARENT zero-size shadow rather than
		 * `none`, because these tokens get composed into longer shadow
		 * lists and `none` is only valid on its own. This is the computed
		 * form that produces, and it must draw nothing rather than a
		 * clear quad and a wasted blur pass.
		 */
		expect(
			parseBoxShadow( 'rgba(0, 0, 0, 0) 0px 0px 0px 0px' ),
		).toEqual( [] );
	} );

	test( 'caps runaway layer counts', () => {
		const many = Array.from(
			{ length: 9 },
			( _, i ) => `rgba(0, 0, 0, 0.1) 0px ${ i }px 4px 0px`,
		).join( ', ' );
		expect( parseBoxShadow( many ).length ).toBeLessThanOrEqual( 4 );
	} );
} );

describe( 'blurStrength', () => {
	test( 'converts through BOTH halves of the mismatch', () => {
		/*
		 * CSS defines its blur radius as twice the Gaussian standard
		 * deviation. PixiJS's `strength` is the tap SPACING, and its
		 * 5-tap kernel has a deviation of ~1.292 taps of its own — so
		 * dividing by two alone left every shadow about 30% too soft.
		 */
		expect( blurStrength( 48 ) ).toBeCloseTo( 48 / 2 / 1.292, 5 );
		expect( blurStrength( 48 ) ).toBeLessThan( 48 / 2 );
		expect( blurStrength( 0 ) ).toBe( 0 );
	} );
} );

describe( 'parseCornerRadius', () => {
	test( 'reads the first px value', () => {
		expect( parseCornerRadius( '8px' ) ).toBe( 8 );
		expect( parseCornerRadius( '8px 8px 0px 0px' ) ).toBe( 8 );
	} );

	test( 'falls back to square corners', () => {
		expect( parseCornerRadius( '' ) ).toBe( 0 );
		// Percentages need a box to resolve against; square is the safe
		// answer for something about to be blurred anyway.
		expect( parseCornerRadius( '50%' ) ).toBe( 0 );
	} );
} );

/** Minimal Pixi stand-ins, recording what the shadow builder draws. */
function fakePixi() {
	const drawn: Array< Record< string, unknown > > = [];
	class FakeContainer {
		public children: unknown[] = [];
		public x = 0;
		public y = 0;
		public addChild( c: unknown ) {
			this.children.push( c );
			return c;
		}
	}
	class FakeGraphics {
		public filters: unknown[] = [];
		public roundRect(
			x: number,
			y: number,
			width: number,
			height: number,
			radius: number,
		) {
			drawn.push( { x, y, width, height, radius } );
			return this;
		}
		public fill( style: { color: number; alpha: number } ) {
			drawn.push( style );
			return this;
		}
	}
	class FakeBlurFilter {
		public constructor(
			public options: { strength: number; quality: number },
		) {}
	}
	return {
		drawn,
		pixi: {
			Container: FakeContainer,
			Graphics: FakeGraphics,
			BlurFilter: FakeBlurFilter,
		},
	};
}

/**
 * An element whose computed style is whatever the test says it is.
 *
 * @param boxShadow    Computed `box-shadow`.
 * @param borderRadius Computed `border-radius`.
 */
function elementWith( boxShadow: string, borderRadius = '8px' ): HTMLElement {
	const el = document.createElement( 'div' );
	el.style.boxShadow = boxShadow;
	el.style.borderRadius = borderRadius;
	return el;
}

describe( 'createWindowShadow', () => {
	const rect = { x: 40, y: 60, width: 300, height: 200 };

	test( 'draws the shadow offset and spread, positioned at the window', () => {
		const { pixi, drawn } = fakePixi();
		const shadow = createWindowShadow(
			pixi,
			elementWith( 'rgba(0, 0, 0, 0.3) 0px 8px 32px 4px' ),
			rect,
		);

		expect( shadow ).not.toBeNull();
		// Placed in the sprite's space, so the effect can move both
		// together without a second coordinate system.
		expect( shadow?.x ).toBe( 40 );
		expect( shadow?.y ).toBe( 60 );

		expect( drawn[ 0 ] ).toEqual( {
			x: -4,
			y: 4,
			width: 308,
			height: 208,
			radius: 12,
		} );
		expect( drawn[ 1 ] ).toEqual( { color: 0x000000, alpha: 0.3 } );
	} );

	test( 'draws every layer, back to front', () => {
		const { pixi, drawn } = fakePixi();
		createWindowShadow(
			pixi,
			elementWith(
				'rgba(0, 0, 0, 0.4) 0px 12px 48px 0px, rgba(0, 0, 0, 0.2) 0px 4px 12px 0px',
			),
			rect,
		);

		// CSS paints the FIRST-declared shadow on top, so the container
		// has to stack them in reverse: the tight contact shadow goes
		// down first, the wide ambient one over it.
		expect( drawn[ 1 ] ).toEqual( { color: 0x000000, alpha: 0.2 } );
		expect( drawn[ 3 ] ).toEqual( { color: 0x000000, alpha: 0.4 } );
	} );

	test( 'converts the CSS blur radius to a standard deviation', () => {
		const { pixi } = fakePixi();
		const shadow = createWindowShadow(
			pixi,
			elementWith( 'rgba(0, 0, 0, 0.3) 0px 8px 32px 0px' ),
			rect,
		);
		const graphics = ( shadow as unknown as { children: Array< {
			filters: Array< { options: { strength: number } } >;
		} > } ).children[ 0 ];

		expect( graphics.filters[ 0 ].options.strength ).toBeCloseTo(
			blurStrength( 32 ),
			5,
		);
	} );

	test( 'returns null when there is no shadow to draw', () => {
		const { pixi } = fakePixi();
		expect( createWindowShadow( pixi, elementWith( 'none' ), rect ) ).toBeNull();
		expect(
			createWindowShadow(
				pixi,
				elementWith( 'rgba(0, 0, 0, 0) 0px 8px 32px' ),
				rect,
			),
		).toBeNull();
	} );

	test( 'returns null rather than throwing on a Pixi build without graphics', () => {
		// A missing shadow is a blemish; a thrown constructor is a dead
		// animation.
		expect(
			createWindowShadow(
				{ Container: class {} },
				elementWith( 'rgba(0, 0, 0, 0.3) 0px 8px 32px' ),
				rect,
			),
		).toBeNull();
	} );
} );
