/**
 * Regression tests for deferred capture-texture release.
 *
 * The bug these pin down: destroying a captured texture's source made
 * PixiJS's renderer-lifetime mesh shader destroy its own bind group,
 * after which every mesh draw threw
 *
 *     Cannot read properties of null (reading '0')
 *
 * for the rest of the page's life — so the cloth drag effect worked
 * exactly once. See `src/stage/window-fx/texture-retire.ts` for the full
 * mechanism.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetRetiringForTests,
	retireTexture,
	TEXTURE_RETIRE_MS,
} from '../../src/stage/window-fx/texture-retire';

/**
 * A stand-in for `Texture` whose source and style record the order of
 * everything done to them — which is what the contract is about.
 */
function fakeTexture() {
	const log: string[] = [];
	const style = {
		removeAllListeners: ( event?: string ) => {
			log.push( `style:off:${ event }` );
		},
	};
	const source = {
		style,
		removeAllListeners: ( event?: string ) => {
			log.push( `source:off:${ event }` );
		},
	};
	return {
		log,
		texture: {
			source,
			destroy: ( withSource?: boolean ) => {
				log.push( `destroy:${ withSource }` );
			},
		},
	};
}

describe( 'retireTexture', () => {
	beforeEach( () => {
		_resetRetiringForTests();
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
	} );

	test( 'does not destroy immediately', () => {
		const { log, texture } = fakeTexture();
		retireTexture( texture );
		// Draw instructions already built can outlive the display object
		// by more than a frame.
		expect( log ).toEqual( [] );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS - 1 );
		expect( log ).toEqual( [] );
	} );

	test( 'severs change listeners BEFORE destroying, source and style both', () => {
		const { log, texture } = fakeTexture();
		retireTexture( texture );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );

		expect( log ).toEqual( [
			'source:off:change',
			// The style has to be silenced before `destroy()` reaches it:
			// the source destroys its own style on the way down.
			'style:off:change',
			// `true` — the source is released with the texture, otherwise
			// every drag leaks a full window's worth of GPU memory.
			'destroy:true',
		] );
	} );

	test( 'severs only "change" — destroy and unload still fire', () => {
		const { log, texture } = fakeTexture();
		retireTexture( texture );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );

		// A bare `removeAllListeners()` would also unhook the GPU-memory
		// reclamation that listens for 'destroy'/'unload'.
		expect(
			log.filter( ( entry ) => entry.endsWith( ':undefined' ) ),
		).toEqual( [] );
	} );

	test( 'ignores a second retire of the same texture', () => {
		const { log, texture } = fakeTexture();
		retireTexture( texture );
		retireTexture( texture );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );
		expect( log.filter( ( e ) => e.startsWith( 'destroy' ) ) ).toHaveLength(
			1,
		);
	} );

	test( 'accepts the same texture again once it has been released', () => {
		const { log, texture } = fakeTexture();
		retireTexture( texture );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );
		retireTexture( texture );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );
		expect( log.filter( ( e ) => e.startsWith( 'destroy' ) ) ).toHaveLength(
			2,
		);
	} );

	test( 'survives a texture with no source, and a throwing destroy', () => {
		expect( () => {
			retireTexture( {
				destroy: () => {
					throw new Error( 'already gone' );
				},
			} );
			vi.advanceTimersByTime( TEXTURE_RETIRE_MS );
		} ).not.toThrow();
	} );

	test( 'survives resources that are not event emitters', () => {
		const destroy = vi.fn();
		retireTexture( {
			destroy,
			source: { style: null } as never,
		} );
		vi.advanceTimersByTime( TEXTURE_RETIRE_MS );
		expect( destroy ).toHaveBeenCalledWith( true );
	} );
} );
