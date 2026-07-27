/**
 * Unit tests for `src/stage/feature-detect.ts`.
 *
 * jsdom ships none of the HTML-in-Canvas API, so the "unsupported"
 * branch is the natural state and the "supported" branch is built by
 * stubbing the prototype members the detector checks.
 *
 * The contract these lock down is deliberately narrow: the stage
 * requires **only** the two primitives it actually calls —
 * `canvas.requestPaint()` and `gl.texElementImage2D()`. An earlier
 * version also demanded the 2D `drawElementImage`, which the renderer
 * never touches; that produced a false "unsupported" on a real Chrome
 * Canary with the flag on. Requiring an unused capability is a bug, and
 * the last two tests here exist to keep it from coming back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	isStageSupported,
	stageSupportDetail,
} from '../../src/stage/feature-detect';

type Restore = () => void;
const restores: Restore[] = [];

type Bag = Record< string, unknown >;

/** Define a missing prototype member, remembering how to remove it. */
function stub( proto: object, key: string, value: unknown ): void {
	const had = Object.prototype.hasOwnProperty.call( proto, key );
	const previous = ( proto as Bag )[ key ];
	( proto as Bag )[ key ] = value;
	restores.push( () => {
		if ( had ) {
			( proto as Bag )[ key ] = previous;
		} else {
			delete ( proto as Bag )[ key ];
		}
	} );
}

/**
 * jsdom implements neither `CanvasRenderingContext2D` nor the WebGL
 * contexts, so the constructors the detector reads have to be conjured
 * before their prototypes can be stubbed. That absence is itself worth
 * covering — a browser missing the constructor entirely must read as
 * unsupported, which the first test asserts before anything here runs.
 */
function ensureCtor( name: string ): object {
	const w = window as unknown as Bag;
	if ( ! w[ name ] ) {
		w[ name ] = function StubCtor() {};
		restores.push( () => {
			delete w[ name ];
		} );
	}
	return ( w[ name ] as { prototype: object } ).prototype;
}

function protoOf( name: string ): object {
	const ctor = ( window as unknown as Bag )[ name ] as
		| { prototype: object }
		| undefined;
	return ctor ? ctor.prototype : {};
}

/** The minimum a browser needs for the stage to run. */
function stubRequired( glContext = 'WebGL2RenderingContext' ): void {
	stub( ensureCtor( 'HTMLCanvasElement' ), 'requestPaint', () => undefined );
	stub( ensureCtor( glContext ), 'texElementImage2D', () => undefined );
}

/*
 * jsdom's `getContext` throws "Not implemented" and reports it through
 * the virtual console before the detector's try/catch can swallow it,
 * which floods the run with noise. Returning null is exactly what a
 * context-less environment should look like anyway.
 */
beforeEach( () => {
	stub( protoOf( 'HTMLCanvasElement' ), 'getContext', () => null );
} );

afterEach( () => {
	while ( restores.length ) {
		restores.pop()?.();
	}
} );

describe( 'isStageSupported', () => {
	test( 'false in a browser without the API', () => {
		expect( isStageSupported() ).toBe( false );
	} );

	test( 'true with texElementImage2D on WebGL2', () => {
		stubRequired( 'WebGL2RenderingContext' );
		expect( isStageSupported() ).toBe( true );
	} );

	test( 'true when texElementImage2D lives on WebGL1 instead', () => {
		// Which context prototype carries the method depends on the
		// build; betting on one of them is how you get a false negative.
		stubRequired( 'WebGLRenderingContext' );
		expect( isStageSupported() ).toBe( true );
	} );

	test( 'STILL supported when requestPaint is missing — PixiJS treats it as optional', () => {
		// `HTMLSource` does `_isReady = !_autoUpdate || !canvas.requestPaint`
		// and its own requestPaint() returns false rather than throwing.
		// Gating on it produced a false "unsupported" on a working Canary.
		stubRequired();
		delete ( protoOf( 'HTMLCanvasElement' ) as Bag ).requestPaint;
		expect( isStageSupported() ).toBe( true );
	} );

	test( 'false when the WebGL upload path is missing — the ONLY hard gate', () => {
		// Without this, Pixi's HTMLSource throws from inside its uploader
		// on the first rendered frame — after the shell has already been
		// moved into the canvas.
		stub( ensureCtor( 'HTMLCanvasElement' ), 'requestPaint', () => undefined );
		expect( isStageSupported() ).toBe( false );
	} );

	test( 'a non-callable requestPaint is reported but does not block', () => {
		stubRequired();
		stub( protoOf( 'HTMLCanvasElement' ), 'requestPaint', true );
		expect( stageSupportDetail().requestPaint ).toBe( false );
		expect( isStageSupported() ).toBe( true );
	} );

	test( 'supported WITHOUT the 2D drawElementImage — the stage never calls it', () => {
		stubRequired();
		// No CanvasRenderingContext2D stub at all.
		expect( stageSupportDetail().drawElementImage ).toBe( false );
		expect( isStageSupported() ).toBe( true );
	} );
} );

describe( 'stageSupportDetail', () => {
	test( 'reports every capability as false in a bare environment', () => {
		expect( stageSupportDetail() ).toEqual( {
			requestPaint: false,
			texElementImage2D: false,
			texElementImage2DOn: null,
			drawElementImage: false,
			layoutSubtree: false,
			needsUploadShim: false,
		} );
	} );

	test( 'names which context prototype carried texElementImage2D', () => {
		stubRequired( 'WebGLRenderingContext' );
		expect( stageSupportDetail().texElementImage2DOn ).toBe(
			'WebGLRenderingContext',
		);
	} );

	test( 'prefers WebGL2 when both carry it', () => {
		stubRequired( 'WebGL2RenderingContext' );
		stub( ensureCtor( 'WebGLRenderingContext' ), 'texElementImage2D', () =>
			undefined,
		);
		expect( stageSupportDetail().texElementImage2DOn ).toBe(
			'WebGL2RenderingContext',
		);
	} );

	test( 'reports the optional capabilities independently', () => {
		stubRequired();
		stub( ensureCtor( 'CanvasRenderingContext2D' ), 'drawElementImage', () =>
			undefined,
		);
		stub( ensureCtor( 'HTMLCanvasElement' ), 'layoutSubtree', false );

		const detail = stageSupportDetail();
		expect( detail.drawElementImage ).toBe( true );
		expect( detail.layoutSubtree ).toBe( true );
		expect( detail.requestPaint ).toBe( true );
	} );
} );
