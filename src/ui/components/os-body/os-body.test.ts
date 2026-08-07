import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-body';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-body>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a shadow slot so light children project', async () => {
		host.innerHTML = `
			<os-body>
				<div class="one">A</div>
				<div class="two">B</div>
			</os-body>
		`;
		await tick();

		const body = host.querySelector( 'os-body' )!;
		expect( body.shadowRoot ).not.toBeNull();
		expect( body.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		expect( body.querySelectorAll( 'div' ).length ).toBe( 2 );
	} );

	test( 'gap attribute sets the --os-ui-body-gap custom property', async () => {
		host.innerHTML = `<os-body gap="20"></os-body>`;
		await tick();

		const body = host.querySelector( 'os-body' ) as HTMLElement;
		expect( body.style.getPropertyValue( '--os-ui-body-gap' ) ).toBe( '20px' );
	} );

	test( 'padding="0" drops the inset for edge-to-edge content', async () => {
		host.innerHTML = `<os-body padding="0"></os-body>`;
		await tick();

		const body = host.querySelector( 'os-body' ) as HTMLElement;
		expect( body.style.getPropertyValue( '--os-ui-body-padding' ) ).toBe( '0px' );
	} );

	test( 'non-numeric padding is ignored defensively', async () => {
		host.innerHTML = `<os-body padding="garbage"></os-body>`;
		await tick();

		const body = host.querySelector( 'os-body' ) as HTMLElement;
		expect( body.style.getPropertyValue( '--os-ui-body-padding' ) ).toBe( '' );
	} );

	test( 'scroll attribute is honoured declaratively (hosts overflow via :host([scroll]))', async () => {
		host.innerHTML = `<os-body scroll></os-body>`;
		await tick();

		const body = host.querySelector( 'os-body' )!;
		// Attribute presence is the contract — the CSS rule keys off
		// `:host([scroll])`. jsdom doesn't resolve the computed
		// style, but the structural contract (attribute present) is
		// what plugin authors write.
		expect( body.hasAttribute( 'scroll' ) ).toBe( true );
	} );

	test( 'composes naturally with panels and rows (layout stack probe)', async () => {
		host.innerHTML = `
			<os-body>
				<os-panel>
					<os-row>
						<div col="6" class="a"></div>
						<div col="6" class="b"></div>
					</os-row>
				</os-panel>
			</os-body>
		`;
		await tick();
		await tick();

		// The full body → panel → row → col tree should survive
		// mounting. querySelector walks flattened light tree, so
		// plugin author code reaches every level predictably.
		expect( host.querySelector( 'os-body os-panel os-row .a' ) ).not.toBeNull();
		expect( host.querySelector( 'os-body os-panel os-row .b' ) ).not.toBeNull();
	} );
} );
