import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-swatch-grid';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-swatch-grid>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'applies radiogroup role + aria-label + custom column count', async () => {
		host.innerHTML = `
			<os-swatch-grid label="Accent" columns="6">
				<span class="tile">a</span>
			</os-swatch-grid>
		`;
		await tick();
		const grid = host.querySelector( 'os-swatch-grid' ) as HTMLElement;
		expect( grid.getAttribute( 'role' ) ).toBe( 'radiogroup' );
		expect( grid.getAttribute( 'aria-label' ) ).toBe( 'Accent' );
		expect(
			grid.style.getPropertyValue( '--os-ui-swatch-grid-cols' ),
		).toBe( '6' );
	} );
} );
