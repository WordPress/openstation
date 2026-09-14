import { afterEach, expect, test, vi } from 'vitest';
import { MioCalloutController } from '../../src/mio/callout';
import { resizeMioCanvas } from '../../src/mio/canvas-resize';

afterEach( () => { vi.unstubAllGlobals(); document.body.replaceChildren(); } );

function setup() {
	vi.stubGlobal( 'requestAnimationFrame', vi.fn( () => 1 ) );
	vi.stubGlobal( 'cancelAnimationFrame', vi.fn() );
	const host = document.createElement( 'div' );
	const target = document.createElement( 'h2' ); host.append( target );
	const frame = document.createElement( 'div' ); document.body.append( host, frame );
	frame.getBoundingClientRect = () => ( { left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 } as DOMRect );
	target.getBoundingClientRect = () => ( { left: 100, top: 100, right: 400, bottom: 140, width: 300, height: 40 } as DOMRect );
	const handle = { getPosition: () => ( { x: 160, y: 205 } ), setAnchor: vi.fn(), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
	const visibility = vi.fn();
	const create = () => new MioCalloutController( host, frame, () => handle, visibility );
	return { host, target, frame, handle, visibility, create };
}

test( 'requires an active window and a live owned target, follows geometry and releases its anchor', () => {
	const { target, frame, handle, visibility, create } = setup();
	const callout = create();
	callout.show( { id: 'tip', target: () => target, message: 'Visit our blog!' } );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( true );
	callout.setActive( true );
	expect( visibility ).toHaveBeenLastCalledWith( true );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( { x: 340, y: 205 }, true );
	expect( handle.setPosition ).not.toHaveBeenCalled();
	target.getBoundingClientRect = () => ( { left: 200, top: 150, right: 500, bottom: 190, width: 300, height: 40 } as DOMRect );
	callout.setActive( true );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( { x: 440, y: 255 }, true );
	callout.setActive( false );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( null );
	expect( visibility ).toHaveBeenLastCalledWith( false );
	callout.show( { id: 'outside', target: () => document.body, message: 'Wrong window' } );
	callout.setActive( true );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( true );
	callout.dispose();
	expect( frame.children ).toHaveLength( 0 );
} );

test( 'dismissal survives tab changes and master switches until a new window lease', () => {
	const { target, frame, create } = setup();
	let about = true;
	const request = { id: 'blog', target: () => about ? target : null, message: '<b>Visit our blog!</b>', onDismiss: vi.fn() };
	const callout = create(); callout.show( request ); callout.setActive( true );
	expect( frame.querySelector( 'b' ) ).toBeNull();
	about = false; callout.setActive( true );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( true );
	about = true; callout.setActive( true );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( false );
	frame.querySelector<HTMLElement>( 'os-button' )!.click();
	expect( request.onDismiss ).toHaveBeenCalledOnce();
	callout.clear(); callout.show( request ); callout.setActive( false ); callout.setActive( true );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( true );
	callout.dispose();
	const reopened = create(); reopened.show( request ); reopened.setActive( true );
	expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( false );
	reopened.dispose();
} );

test( 'canvas resize repaints before returning and does not clear unchanged dimensions', () => {
	let painted = true;
	const screen = { width: 600, height: 500 };
	const operations: string[] = [];
	const app = { screen, renderer: { resize: vi.fn( ( width: number, height: number ) => {
		painted = false; Object.assign( screen, { width, height } ); operations.push( 'resize' );
	} ) }, render: () => { painted = true; operations.push( 'render' ); } };
	for ( const width of [ 580, 570, 570, 540 ] ) {
		resizeMioCanvas( app, { width, height: 500 }, () => operations.push( 'reflow' ) );
		expect( painted ).toBe( true );
	}
	expect( app.renderer.resize ).toHaveBeenCalledTimes( 3 );
	expect( operations.slice( 0, 3 ) ).toEqual( [ 'resize', 'reflow', 'render' ] );
} );
