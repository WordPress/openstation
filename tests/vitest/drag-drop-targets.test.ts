import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DropTargetRegistry } from '../../src/drag/drop-target-registry';

describe( 'DropTargetRegistry', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'deepest registered ancestor wins', () => {
		const reg = new DropTargetRegistry();
		const outer = document.createElement( 'div' );
		const middle = document.createElement( 'div' );
		const inner = document.createElement( 'div' );
		outer.appendChild( middle );
		middle.appendChild( inner );
		document.body.appendChild( outer );

		const outerTarget = {
			id: 'outer', element: outer, accept: () => true, onDrop: () => undefined,
		};
		const middleTarget = {
			id: 'middle', element: middle, accept: () => true, onDrop: () => undefined,
		};
		reg.register( outerTarget );
		reg.register( middleTarget );

		expect( reg.hitTest( inner ) ).toBe( middleTarget );
		expect( reg.hitTest( middle ) ).toBe( middleTarget );
		expect( reg.hitTest( outer ) ).toBe( outerTarget );
	} );

	test( 'hitTest returns null for an element outside any registered tree', () => {
		const reg = new DropTargetRegistry();
		const isolated = document.createElement( 'div' );
		document.body.appendChild( isolated );

		expect( reg.hitTest( isolated ) ).toBeNull();
	} );

	test( '.os-window stops the walk and returns null', () => {

		const reg = new DropTargetRegistry();
		const wallpaper = document.createElement( 'div' );
		wallpaper.id = 'wallpaper';
		const win = document.createElement( 'div' );
		win.classList.add( 'os-window' );
		const iframe = document.createElement( 'div' );
		win.appendChild( iframe );
		wallpaper.appendChild( win );
		document.body.appendChild( wallpaper );

		reg.register( {
			id: 'wallpaper', element: wallpaper, accept: () => true, onDrop: () => undefined,
		} );

		expect( reg.hitTest( iframe ) ).toBeNull();

		expect( reg.hitTest( wallpaper )?.id ).toBe( 'wallpaper' );
	} );

	test( 'a target registered INSIDE the window claims its own region', () => {

		const reg = new DropTargetRegistry();
		const wallpaper = document.createElement( 'div' );
		const win = document.createElement( 'div' );
		win.classList.add( 'os-window' );
		const binBody = document.createElement( 'div' );
		const innerChild = document.createElement( 'span' );
		binBody.appendChild( innerChild );
		win.appendChild( binBody );
		wallpaper.appendChild( win );
		document.body.appendChild( wallpaper );

		reg.register( {
			id: 'wallpaper', element: wallpaper, accept: () => true, onDrop: () => undefined,
		} );
		const binTarget = {
			id: 'bin', element: binBody, accept: () => true, onDrop: () => undefined,
		};
		reg.register( binTarget );

		expect( reg.hitTest( innerChild ) ).toBe( binTarget );
		expect( reg.hitTest( binBody ) ).toBe( binTarget );
	} );

	test( 'idempotent re-registration replaces the old entry under the same id', () => {
		const reg = new DropTargetRegistry();
		const a = document.createElement( 'div' );
		const b = document.createElement( 'div' );
		document.body.append( a, b );

		const t1 = { id: 'tgt', element: a, accept: () => true, onDrop: () => undefined };
		reg.register( t1 );
		expect( reg.hitTest( a )?.element ).toBe( a );

		const t2 = { id: 'tgt', element: b, accept: () => true, onDrop: () => undefined };
		reg.register( t2 );
		expect( reg.hitTest( a ) ).toBeNull();
		expect( reg.hitTest( b )?.element ).toBe( b );
	} );

	test( 'deregister returned by register removes the entry', () => {
		const reg = new DropTargetRegistry();
		const el = document.createElement( 'div' );
		document.body.appendChild( el );
		const deregister = reg.register( {
			id: 'tgt', element: el, accept: () => true, onDrop: () => undefined,
		} );
		expect( reg.list().length ).toBe( 1 );
		deregister();
		expect( reg.list().length ).toBe( 0 );

		expect( () => deregister() ).not.toThrow();
	} );

	test( 'list returns a snapshot — caller mutations do not affect the registry', () => {
		const reg = new DropTargetRegistry();
		const el = document.createElement( 'div' );
		reg.register( {
			id: 'x', element: el, accept: () => true, onDrop: () => undefined,
		} );
		const snapshot = reg.list() as Array< unknown >;

		expect( snapshot.length ).toBe( 1 );

		snapshot.push( 'extra' );
		expect( reg.list().length ).toBe( 1 );
	} );
} );
