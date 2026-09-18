import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-grid';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-grid>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'columns + rows resolve to grid-template track lists', async () => {
		host.innerHTML = `<os-grid columns="4" rows="5"></os-grid>`;
		await tick();
		const grid = host.querySelector< HTMLElement >( 'os-grid' )!;
		expect( grid.style.getPropertyValue( '--os-ui-grid-columns' ) ).toBe(
			'repeat(4, minmax(0, 1fr))',
		);
		expect( grid.style.getPropertyValue( '--os-ui-grid-rows' ) ).toBe(
			'repeat(5, minmax(0, 1fr))',
		);
	} );

	test( 'gap + per-axis gaps both flow through', async () => {
		host.innerHTML = `<os-grid gap="12" column-gap="6" row-gap="18"></os-grid>`;
		await tick();
		const grid = host.querySelector< HTMLElement >( 'os-grid' )!;
		expect( grid.style.getPropertyValue( '--os-ui-grid-gap' ) ).toBe( '12px' );
		expect( grid.style.getPropertyValue( '--os-ui-grid-column-gap' ) ).toBe( '6px' );
		expect( grid.style.getPropertyValue( '--os-ui-grid-row-gap' ) ).toBe( '18px' );
	} );
} );

test( 'removing or invalidating attributes restores defaults', async () => {
	const grid = document.createElement( 'os-grid' );
	grid.setAttribute( 'columns', '4' );
	grid.setAttribute( 'rows', '3' );
	grid.setAttribute( 'gap', '24' );
	document.body.appendChild( grid );
	await tick();
	grid.removeAttribute( 'columns' );
	grid.setAttribute( 'rows', '0' );
	grid.setAttribute( 'gap', 'invalid' );
	await tick();
	expect( grid.style.getPropertyValue( '--os-ui-grid-columns' ) ).toBe( '' );
	expect( grid.style.getPropertyValue( '--os-ui-grid-rows' ) ).toBe( '' );
	expect( grid.style.getPropertyValue( '--os-ui-grid-gap' ) ).toBe( '' );
	grid.remove();
} );

test( 'automatic fitting reacts to width and attributes, then disconnects cleanly', async () => {
	let callback: ResizeObserverCallback;
	const disconnect = vi.fn();
	vi.stubGlobal( 'ResizeObserver', class {
		constructor( cb: ResizeObserverCallback ) {
			callback = cb;
		}
		observe() {}
		disconnect = disconnect;
	} );
	const grid = document.createElement( 'os-grid' );
	try {
		grid.setAttribute( 'columns', '4' );
		grid.setAttribute( 'min-item-width', '200' );
		document.body.appendChild( grid );
		await tick();
		callback!( [ { contentRect: { width: 620 } } ] as ResizeObserverEntry[], {} as ResizeObserver );
		expect( grid.style.getPropertyValue( '--_os-grid-tracks' ) ).toBe( '3' );
		callback!( [ { contentRect: { width: 180 } } ] as ResizeObserverEntry[], {} as ResizeObserver );
		expect( grid.hasAttribute( 'data-single-column' ) ).toBe( true );
		grid.removeAttribute( 'min-item-width' );
		await tick();
		expect( grid.hasAttribute( 'data-single-column' ) ).toBe( false );
		expect( grid.style.getPropertyValue( '--_os-grid-tracks' ) ).toBe( '4' );
		grid.remove();
		expect( disconnect ).toHaveBeenCalledOnce();
	} finally {
		grid.remove();
		vi.unstubAllGlobals();
	}
} );

test( 'preserves caller-owned inline tokens and restores them after an attribute override', async () => {
	const grid = document.createElement( 'os-grid' );
	grid.style.setProperty( '--os-ui-grid-gap', '2rem' );
	grid.style.setProperty( '--os-ui-grid-columns', '1fr 2fr' );
	document.body.appendChild( grid );
	await tick();
	expect( grid.style.getPropertyValue( '--os-ui-grid-gap' ) ).toBe( '2rem' );
	expect( grid.style.getPropertyValue( '--os-ui-grid-columns' ) ).toBe( '1fr 2fr' );
	grid.setAttribute( 'gap', '8' );
	await tick();
	expect( grid.style.getPropertyValue( '--os-ui-grid-gap' ) ).toBe( '8px' );
	grid.removeAttribute( 'gap' );
	await tick();
	expect( grid.style.getPropertyValue( '--os-ui-grid-gap' ) ).toBe( '2rem' );
	grid.remove();
} );
