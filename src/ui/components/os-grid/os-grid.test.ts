import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
