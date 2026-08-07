import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-row';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-row>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a <slot> inside a shadow root so light children project', async () => {
		host.innerHTML = `
			<os-row>
				<div col="6">A</div>
				<div col="6">B</div>
			</os-row>
		`;
		await tick();

		const row = host.querySelector( 'os-row' )!;
		expect( row.shadowRoot ).not.toBeNull();
		expect( row.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		// Light children are still in the light DOM — the shadow slot
		// just projects them visually.
		expect( row.querySelectorAll( 'div' ).length ).toBe( 2 );
	} );

	test( 'gap attribute sets the --os-ui-row-gap custom property', async () => {
		host.innerHTML = `<os-row gap="24"></os-row>`;
		await tick();

		const row = host.querySelector( 'os-row' ) as HTMLElement;
		expect( row.style.getPropertyValue( '--os-ui-row-gap' ) ).toBe( '24px' );
	} );

	test( 'non-numeric gap is ignored (defensive)', async () => {
		host.innerHTML = `<os-row gap="garbage"></os-row>`;
		await tick();

		const row = host.querySelector( 'os-row' ) as HTMLElement;
		// Non-matching /^\d+$/ → no custom property written → empty string.
		expect( row.style.getPropertyValue( '--os-ui-row-gap' ) ).toBe( '' );
	} );

	test( 'axis-specific gaps override the shared gap', async () => {
		host.innerHTML = `<os-row gap="8" column-gap="20" row-gap="4"></os-row>`;
		await tick();

		const row = host.querySelector( 'os-row' ) as HTMLElement;
		expect( row.style.getPropertyValue( '--os-ui-row-gap' ) ).toBe( '8px' );
		expect( row.style.getPropertyValue( '--os-ui-row-column-gap' ) ).toBe( '20px' );
		expect( row.style.getPropertyValue( '--os-ui-row-row-gap' ) ).toBe( '4px' );
	} );

	test( 'children without col attribute still appear inside the row', async () => {
		// The grid layout is CSS-only; we verify the structural
		// contract (slotting works, light children stay queryable)
		// rather than the computed layout (jsdom has no real grid).
		host.innerHTML = `
			<os-row>
				<os-panel>one</os-panel>
				<os-panel col="6">two</os-panel>
			</os-row>
		`;
		await tick();

		const row = host.querySelector( 'os-row' )!;
		const panels = row.querySelectorAll( 'os-panel' );
		expect( panels.length ).toBe( 2 );
		// Any element type participates — the col attribute lives on
		// the child, so os-panel and a bare <div> both work.
		expect( panels[ 1 ].getAttribute( 'col' ) ).toBe( '6' );
	} );
} );
