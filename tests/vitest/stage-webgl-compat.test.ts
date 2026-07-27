/**
 * Unit tests for `src/stage/webgl-compat.ts`.
 *
 * The bug this shim exists for: Chromium 150+ finalised
 * `texElementImage2D` to `( target, internalformat, source )`, while
 * PixiJS 8.19 still calls the legacy
 * `( target, level, internalformat, format, type, source )`. The new
 * entry point then WebIDL-converts argument 3 — `gl.RGBA`, a number —
 * against `(Element or ElementImage)` and throws on every uploaded
 * frame, from inside the browser's paint event where it cannot be
 * caught.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Bag = Record< string, unknown >;

const RGBA = 0x1908;
const RGBA8 = 0x8058;
const TEXTURE_2D = 0x0de1;

let originalCtor: unknown;
let calls: unknown[][];

/**
 * Stand in for a WebGL context prototype whose `texElementImage2D` has
 * the given arity. Arity is the signal the shim keys off, so it has to
 * be real — hence the distinct declarations rather than a rest param.
 */
function installFakeContext( arity: 3 | 6 ): void {
	calls = [];
	const record = function ( this: unknown, ...args: unknown[] ): string {
		calls.push( args );
		return 'called';
	};

	const fn =
		arity === 3
			? function ( a: unknown, b: unknown, c: unknown ) {
				return record.call( this, a, b, c );
			  }
			: function (
				a: unknown,
				b: unknown,
				c: unknown,
				d: unknown,
				e: unknown,
				f: unknown,
			  ) {
				return record.call( this, a, b, c, d, e, f );
			  };

	( window as unknown as Bag ).WebGL2RenderingContext = function Ctx() {};
	(
		( window as unknown as Bag ).WebGL2RenderingContext as {
			prototype: Bag;
		}
	 ).prototype = {
		texElementImage2D: fn,
		RGBA,
		RGBA8,
	};
}

async function freshModule() {
	vi.resetModules();
	return import( '../../src/stage/webgl-compat' );
}

beforeEach( () => {
	originalCtor = ( window as unknown as Bag ).WebGL2RenderingContext;
} );

afterEach( () => {
	( window as unknown as Bag ).WebGL2RenderingContext = originalCtor;
} );

describe( 'installTexElementImage2DShim', () => {
	test( 'does nothing when the browser has no texElementImage2D', async () => {
		delete ( window as unknown as Bag ).WebGL2RenderingContext;
		delete ( window as unknown as Bag ).WebGLRenderingContext;
		const { installTexElementImage2DShim } = await freshModule();
		expect( installTexElementImage2DShim() ).toBe( false );
	} );

	test( 'does NOT patch a browser that still wants the 6-arg signature', async () => {
		installFakeContext( 6 );
		const { installTexElementImage2DShim } = await freshModule();
		expect( installTexElementImage2DShim() ).toBe( false );

		const proto = (
			( window as unknown as Bag ).WebGL2RenderingContext as {
				prototype: Bag;
			}
		 ).prototype;
		( proto.texElementImage2D as ( ...a: unknown[] ) => unknown ).call(
			proto,
			TEXTURE_2D,
			0,
			RGBA,
			RGBA,
			0x1401,
			'ELEMENT',
		);
		// Untouched: all six arguments reach the native call.
		expect( calls[ 0 ] ).toHaveLength( 6 );
	} );

	test( 'translates a legacy 6-arg call into the finalised 3-arg one', async () => {
		installFakeContext( 3 );
		const { installTexElementImage2DShim } = await freshModule();
		expect( installTexElementImage2DShim() ).toBe( true );

		const proto = (
			( window as unknown as Bag ).WebGL2RenderingContext as {
				prototype: Bag;
			}
		 ).prototype;
		( proto.texElementImage2D as ( ...a: unknown[] ) => unknown ).call(
			proto,
			TEXTURE_2D,
			0,
			RGBA,
			RGBA,
			0x1401,
			'ELEMENT',
		);

		// ( target, sizedInternalFormat, source ) — and crucially the
		// ELEMENT lands in the slot the browser reads as the element,
		// which is the whole bug.
		expect( calls[ 0 ] ).toEqual( [ TEXTURE_2D, RGBA8, 'ELEMENT' ] );
	} );

	test( 'maps unsized RGBA to sized RGBA8', async () => {
		installFakeContext( 3 );
		const { installTexElementImage2DShim } = await freshModule();
		installTexElementImage2DShim();

		const proto = (
			( window as unknown as Bag ).WebGL2RenderingContext as {
				prototype: Bag;
			}
		 ).prototype;
		( proto.texElementImage2D as ( ...a: unknown[] ) => unknown ).call(
			proto,
			TEXTURE_2D,
			0,
			RGBA,
			RGBA,
			0x1401,
			'ELEMENT',
		);
		expect( calls[ 0 ][ 1 ] ).toBe( RGBA8 );
	} );

	test( 'passes an already-finalised 3-arg call straight through', async () => {
		installFakeContext( 3 );
		const { installTexElementImage2DShim } = await freshModule();
		installTexElementImage2DShim();

		const proto = (
			( window as unknown as Bag ).WebGL2RenderingContext as {
				prototype: Bag;
			}
		 ).prototype;
		( proto.texElementImage2D as ( ...a: unknown[] ) => unknown ).call(
			proto,
			TEXTURE_2D,
			RGBA8,
			'ELEMENT',
		);
		// Untranslated — a fixed PixiJS, or any other page code, is
		// unaffected by our patch.
		expect( calls[ 0 ] ).toEqual( [ TEXTURE_2D, RGBA8, 'ELEMENT' ] );
	} );

	test( 'is idempotent — a second install does not double-wrap', async () => {
		installFakeContext( 3 );
		const { installTexElementImage2DShim } = await freshModule();
		installTexElementImage2DShim();
		const proto = (
			( window as unknown as Bag ).WebGL2RenderingContext as {
				prototype: Bag;
			}
		 ).prototype;
		const afterFirst = proto.texElementImage2D;

		expect( installTexElementImage2DShim() ).toBe( true );
		expect( proto.texElementImage2D ).toBe( afterFirst );
	} );

	test( 'needsTexElementImage2DShim reports the finalised signature', async () => {
		installFakeContext( 3 );
		const { needsTexElementImage2DShim } = await freshModule();
		expect( needsTexElementImage2DShim() ).toBe( true );

		installFakeContext( 6 );
		const fresh = await freshModule();
		expect( fresh.needsTexElementImage2DShim() ).toBe( false );
	} );
} );

/*
 * Probe error classification.
 *
 * The probe exists to answer one question: does this browser accept our
 * call shape? Two very different failures reach its catch block, and
 * conflating them disabled the feature on a browser where it worked:
 *
 *  - `TypeError` — WebIDL rejected the arguments. Every frame would
 *    throw. Genuinely unsupported.
 *  - anything else, notably "No cached paint record for element" — the
 *    arguments were ACCEPTED and the operation declined, because the
 *    probe's throwaway element has never been painted. The real stage
 *    never hits this: PixiJS allocates and requests a paint first.
 */
describe( 'probeElementUpload error classification', () => {
	let originalGetContext: unknown;

	beforeEach( () => {
		originalGetContext = (
			window.HTMLCanvasElement.prototype as unknown as Bag
		 ).getContext;
	} );

	afterEach( () => {
		( window.HTMLCanvasElement.prototype as unknown as Bag ).getContext =
			originalGetContext;
	} );

	/**
	 * jsdom has no WebGL, so the probe needs a context handed to it. Only
	 * the handful of members `runProbe()` touches are implemented.
	 */
	async function probeWith( thrown: unknown ) {
		vi.resetModules();
		installFakeContext( 3 );

		const fakeGl: Bag = {
			TEXTURE_2D,
			RGBA,
			RGBA8,
			UNSIGNED_BYTE: 0x1401,
			createTexture: () => ( {} ),
			bindTexture: () => undefined,
			deleteTexture: () => undefined,
			texElementImage2D: function ( _a: unknown, _b: unknown, _c: unknown ) {
				throw thrown;
			},
		};
		( window.HTMLCanvasElement.prototype as unknown as Bag ).getContext = (
			kind: string,
		) => ( kind === 'webgl2' ? fakeGl : null );

		const { probeElementUpload } = await import(
			'../../src/stage/feature-detect'
		);
		return probeElementUpload();
	}

	test( 'a TypeError about the element union means unsupported', async () => {
		const result = await probeWith(
			new TypeError(
				"Failed to execute 'texElementImage2D' on 'WebGL2RenderingContext': The provided value is not of type '(Element or ElementImage)'.",
			),
		);
		expect( result.ok ).toBe( false );
		expect( result.error ).toContain( 'not of type' );
	} );

	test( '"No cached paint record" is NOT a failure', async () => {
		// The exact error Chrome 152 raises for an element that has not
		// been painted yet. The probe calls synchronously, so it always
		// hits this on a browser where the feature genuinely works.
		const result = await probeWith(
			new DOMException( 'No cached paint record for element.' ),
		);
		expect( result.ok ).toBe( true );
		expect( result.note ).toContain( 'No cached paint record' );
	} );
} );
