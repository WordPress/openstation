import { expect, test } from 'vitest';
import { advanceMioThinking, mioThinkingExpression } from '../../src/mio/thinking';
import { MIO_DEFAULTS } from '../../src/mio/config';
import { eyeLayout, type RenderFrame } from '../../src/mio/render';
import { createSoftBody } from '../../src/mio/soft-body';

function sampleFrame(): RenderFrame {
	const body = createSoftBody( 100, 100, 50, 24 );
	return { centre: body.core, rim: body.rim, radius: 50, elapsed: 1, gaze: null, blink: 0, tilt: { x: 1, y: 0 } };
}

test( 'thinking eases in and out, leaving user appearance untouched', () => {
	const start = advanceMioThinking( 0, true, 1 / 60, false );
	expect( start ).toBeGreaterThan( 0 ); expect( start ).toBeLessThan( 0.2 );
	const end = advanceMioThinking( start, false, 1 / 60, false );
	expect( end ).toBeGreaterThan( 0 ); expect( end ).toBeLessThan( start );
	const appearance = Object.freeze( { ...MIO_DEFAULTS.appearance } );
	const frame = sampleFrame();
	expect( mioThinkingExpression( frame, appearance, 0, false ) ).toEqual( { frame, appearance } );
	const active = mioThinkingExpression( frame, appearance, 1, false );
	expect( active.frame.gaze!.y ).toBeLessThan( frame.centre.y );
	expect( active.appearance ).not.toBe( appearance );
	expect( appearance ).toEqual( MIO_DEFAULTS.appearance );
} );
test( 'reduced motion keeps a static thinking expression', () => {
	const frame = sampleFrame();
	const a = mioThinkingExpression( frame, MIO_DEFAULTS.appearance, 1, true );
	const b = mioThinkingExpression( { ...frame, elapsed: 100 }, MIO_DEFAULTS.appearance, 1, true );
	expect( a.appearance ).toEqual( b.appearance ); expect( a.frame.gaze ).toEqual( b.frame.gaze );
	expect( advanceMioThinking( 0, true, 0.01, true ) ).toBe( 1 );
} );


test( 'the mascot itself breathes, tilts and narrows its eyes without moving its anchor', () => {
	const frame = sampleFrame();
	const original = JSON.parse( JSON.stringify( frame ) );
	const a = mioThinkingExpression( { ...frame, elapsed: 0.35 }, MIO_DEFAULTS.appearance, 1, false );
	const b = mioThinkingExpression( { ...frame, elapsed: 1.75 }, MIO_DEFAULTS.appearance, 1, false );
	const face = eyeLayout( a.frame, a.appearance );
	expect( Math.abs( face.left.y - face.right.y ) ).toBeGreaterThan( 2 );
	expect( face.height ).toBeLessThan( eyeLayout( frame, MIO_DEFAULTS.appearance ).height * 0.8 );
	expect( a.frame.rim ).not.toEqual( b.frame.rim );
	expect( a.frame.gaze!.x ).not.toBe( b.frame.gaze!.x );
	expect( a.frame.centre ).toEqual( frame.centre );
	expect( frame ).toEqual( original );
	const quiet = mioThinkingExpression( frame, { ...MIO_DEFAULTS.appearance, glow: 0 }, 1, false );
	expect( quiet.appearance.glow ).toBe( 0 );
	expect( quiet.frame.rim ).not.toEqual( frame.rim );
} );

test( 'the full reduced-motion pose stays still and gaze blends smoothly from a distant pointer', () => {
	const frame = sampleFrame();
	const a = mioThinkingExpression( frame, MIO_DEFAULTS.appearance, 1, true );
	const b = mioThinkingExpression( { ...frame, elapsed: 100 }, MIO_DEFAULTS.appearance, 1, true );
	expect( a.frame.rim ).toEqual( b.frame.rim );
	expect( eyeLayout( a.frame, a.appearance ) ).toEqual( eyeLayout( b.frame, b.appearance ) );
	const distant = { ...frame, gaze: { x: 10000, y: 10000 } };
	const idle = eyeLayout( distant, MIO_DEFAULTS.appearance );
	const beginning = mioThinkingExpression( distant, MIO_DEFAULTS.appearance, 0.01, false );
	const eyes = eyeLayout( beginning.frame, beginning.appearance );
	expect( Math.hypot( eyes.left.x - idle.left.x, eyes.left.y - idle.left.y ) ).toBeLessThan( 0.5 );
} );
