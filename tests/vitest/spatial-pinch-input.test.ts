import { afterEach, describe, expect, it, vi } from 'vitest';
import { wirePinchInput } from '../../src/content-graph/pinch-input';
import { wireAtlasCamera } from '../../apps/pages/parts/atlas-camera';
import { createCamera } from '../../apps/posts/parts/canvas/camera';
import type { PixiContainer } from '../../apps/posts/parts/canvas/pixi';

const cleanups: Array< () => void > = [];
afterEach( () => {
	cleanups.splice( 0 ).forEach( ( fn ) => fn() );
	document.body.replaceChildren();
	vi.restoreAllMocks();
} );

function surface() {
	const stage = document.createElement( 'div' );
	stage.innerHTML = '<os-button>Open page</os-button><canvas></canvas>';
	stage.setPointerCapture = vi.fn();
	document.body.append( stage );
	vi.spyOn( stage, 'getBoundingClientRect' ).mockReturnValue( { left: 10, top: 20, width: 400, height: 600 } as DOMRect );
	return stage;
}

function pointer( target: EventTarget, type: string, id: number, x: number, y = 100, pointerType = 'touch' ) {
	const event = new MouseEvent( type, { bubbles: true, composed: true, cancelable: true, clientX: x + 10, clientY: y + 20, button: 0 } );
	Object.defineProperties( event, { pointerId: { value: id }, pointerType: { value: pointerType } } );
	target.dispatchEvent( event );
	return event;
}

function setup() {
	const stage = surface();
	let camera = { x: 0, y: 0, scale: 1 };
	const start = vi.fn();
	const end = vi.fn();
	const input = wirePinchInput( stage, {
		read: () => camera, write: ( next ) => { camera = next; }, bounds: { min: .2, max: 2.5 }, start, end,
	} );
	cleanups.push( input.dispose );
	return { stage, input, start, end, camera: () => camera };
}

describe( 'touch input shared by spatial views', () => {
	it( 'zooms from the first move, anchored to a midpoint that can also move', () => {
		const { stage, camera, start } = setup();
		pointer( stage, 'pointerdown', 1, 100 );
		pointer( stage.firstElementChild!, 'pointerdown', 2, 200 );
		pointer( window, 'pointermove', 2, 300 );
		expect( camera() ).toEqual( { scale: 2, x: -100, y: -100 } );

		expect( 150 * camera().scale + camera().x ).toBe( 200 );
		pointer( window, 'pointermove', 2, 150 );
		expect( camera() ).toEqual( { scale: .5, x: 50, y: 50 } );
		expect( start ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'clamps zoom, tolerates a third finger, and uses the remaining pair without a jump', () => {
		const { stage, camera, start } = setup();
		pointer( stage, 'pointerdown', 1, 100 );
		pointer( stage, 'pointerdown', 2, 200 );
		pointer( stage, 'pointerdown', 3, 400 );
		pointer( stage, 'pointermove', 3, 500 );
		expect( camera().scale ).toBe( 1 );
		pointer( stage, 'pointermove', 2, 1000 );
		expect( camera().scale ).toBe( 2.5 );
		pointer( stage, 'pointerup', 2, 1000 );
		pointer( stage, 'pointermove', 3, 300 );
		expect( camera().scale ).toBe( 1.25 );
		pointer( stage, 'pointermove', 3, 101 );
		expect( camera().scale ).toBe( .2 );
		expect( start ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'owns the whole gesture through cancellation and suppresses a trailing click, not keyboard activation', () => {
		const { stage, input, end } = setup();
		const click = vi.fn();
		stage.addEventListener( 'click', click );
		pointer( stage, 'pointerdown', 1, 100 );
		pointer( stage, 'pointerdown', 2, 200 );
		pointer( stage, 'pointercancel', 2, 200 );
		expect( input.active() ).toBe( true );
		pointer( stage, 'lostpointercapture', 1, 100 );
		expect( input.active() ).toBe( false );
		expect( end ).toHaveBeenCalledTimes( 1 );
		stage.dispatchEvent( new MouseEvent( 'click', { bubbles: true, detail: 1 } ) );
		expect( click ).not.toHaveBeenCalled();
		stage.dispatchEvent( new MouseEvent( 'click', { bubbles: true, detail: 0 } ) );
		expect( click ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores mouse and outside touches, restores styles and removes all listeners on disposal', () => {
		const { stage, input, start, end, camera } = setup();
		pointer( stage, 'pointerdown', 4, 100, 100, 'mouse' );
		pointer( document.body, 'pointerdown', 3, 200 );
		pointer( stage, 'pointerdown', 1, 100 );
		expect( start ).not.toHaveBeenCalled();
		pointer( stage, 'pointerdown', 2, 200 );
		input.dispose();
		expect( end ).toHaveBeenCalledTimes( 1 );
		expect( stage.style.touchAction ).not.toBe( 'none' );
		pointer( stage, 'pointermove', 2, 300 );
		expect( camera().scale ).toBe( 1 );
		pointer( stage, 'pointerdown', 5, 200 );
		expect( start ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'spatial camera integration', () => {
	it( 'Atlas switches from pan to pinch on a card action and cannot resume pan on a remaining finger', () => {
		const stage = surface();
		const camera = { x: 0, y: 0, zoom: 1 };
		cleanups.push( wireAtlasCamera( stage, camera, vi.fn() ) );
		pointer( stage, 'pointerdown', 1, 100 );
		pointer( stage, 'pointermove', 1, 110 );
		expect( camera.x ).toBe( 10 );
		pointer( stage.firstElementChild!, 'pointerdown', 2, 210 );
		pointer( stage, 'pointermove', 2, 260 );
		expect( camera ).toEqual( { x: -40, y: -50, zoom: 1.5 } );
		pointer( stage, 'pointerup', 2, 260 );
		pointer( stage, 'pointermove', 1, 150 );
		expect( camera.x ).toBe( -40 );
		pointer( stage, 'pointerup', 1, 150 );
		pointer( stage, 'pointerdown', 3, 100, 100, 'mouse' );
		pointer( stage, 'pointermove', 3, 130, 100, 'mouse' );
		expect( camera.x ).toBe( -10 );
	} );

	it( 'term cameras replace pending animation with the live pinch transform, so easing cannot snap back', () => {
		const stage = surface();
		const scale = { x: 1, y: 1, set( value: number ) { this.x = value; this.y = value; } };
		const world = { x: 0, y: 0, scale } as PixiContainer;
		const start = vi.fn();
		const camera = createCamera( world, stage, { start, end: vi.fn() } );
		cleanups.push( camera.dispose );
		camera.targetScale = 1.5; camera.targetWorldX = 400;
		pointer( stage, 'pointerdown', 1, 100 );
		pointer( stage, 'pointerdown', 2, 200 );
		pointer( stage, 'pointermove', 2, 300 );
		expect( start ).toHaveBeenCalledTimes( 1 );
		expect( [ world.x, world.y, scale.x ] ).toEqual( [ -100, -100, 2 ] );
		camera.ease();
		expect( [ world.x, world.y, scale.x ] ).toEqual( [ -100, -100, 2 ] );
		expect( camera.stageToWorld( { x: 200, y: 100 } ) ).toEqual( { x: 150, y: 100 } );
	} );
} );
