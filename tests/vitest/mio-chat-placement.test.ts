import { afterEach, expect, test, vi } from 'vitest';
import { followMioChat } from '../../src/mio/chat-placement';

afterEach( () => { vi.unstubAllGlobals(); document.body.innerHTML = ''; } );
test( 'uses a persistent spring home, follows resize, and restores relative to a moved window', () => {
	let resize!: () => void;
	const disconnect = vi.fn();
	vi.stubGlobal( 'ResizeObserver', class { constructor( cb: () => void ) { resize = cb; } observe() {} disconnect = disconnect; } );
	const frame = document.createElement( 'div' );
	const panel = document.createElement( 'div' );
	frame.append( panel ); document.body.append( frame );
	frame.getBoundingClientRect = () => ( { left: 100, top: 50, bottom: 750 } as DOMRect );
	panel.getBoundingClientRect = () => ( { left: 800, top: 200 } as DOMRect );
	const handle = { getPosition: () => ( { x: 950, y: 600 } ), setAnchor: vi.fn(), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
	const follow = followMioChat( frame, panel, () => handle );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( { x: 730, y: 270 }, true );
	expect( handle.setPosition ).not.toHaveBeenCalled();
	panel.getBoundingClientRect = () => ( { left: 700, top: 220 } as DOMRect );
	resize();
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( { x: 630, y: 290 }, true );
	frame.getBoundingClientRect = () => ( { left: 200, top: 100, bottom: 800 } as DOMRect );
	follow.close( true );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( { x: 1050, y: 650 }, false );
	expect( disconnect ).toHaveBeenCalled();
	follow.close( false );
	expect( handle.setAnchor ).toHaveBeenLastCalledWith( null, false );
} );
