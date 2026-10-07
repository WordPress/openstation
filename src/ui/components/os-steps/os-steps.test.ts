import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-steps';
import { stepStyles } from './os-steps.styles';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-steps> + <os-step>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders an <ol> and slots children', async () => {
		host.innerHTML = `
			<os-steps>
				<os-step title="First">one</os-step>
				<os-step title="Second">two</os-step>
			</os-steps>
		`;
		await tick();
		const steps = host.querySelector( 'os-steps' )!;
		expect( steps.shadowRoot!.querySelector( 'ol' ) ).not.toBeNull();
		expect( host.querySelectorAll( 'os-step' ) ).toHaveLength( 2 );
	} );

	test( '<os-step> renders its title + slotted body', async () => {
		host.innerHTML = `<os-steps><os-step title="Install">click install</os-step></os-steps>`;
		await tick();
		const step = host.querySelector( 'os-step' )!;
		expect(
			step.shadowRoot!.querySelector( '.os-step__title' )?.textContent,
		).toBe( 'Install' );
		expect( step.textContent ).toContain( 'click install' );
	} );

	test( '`done` attribute survives on the host for CSS to target', async () => {
		host.innerHTML = `<os-steps><os-step done>x</os-step></os-steps>`;
		await tick();
		const step = host.querySelector( 'os-step' )!;
		expect( step.hasAttribute( 'done' ) ).toBe( true );
	} );

	test( 'the chip sizes border-box, so an outlined chip matches a filled one', () => {
		expect( stepStyles.cssText ).toMatch( /box-sizing:\s*border-box/ );
	} );

	test( 'a horizontal container stamps `trail` on its steps', async () => {
		host.innerHTML = `
			<os-steps horizontal>
				<os-step title="Start"></os-step>
				<os-step title="Name"></os-step>
			</os-steps>
		`;
		await tick();
		for ( const step of host.querySelectorAll( 'os-step' ) ) {
			expect( step.hasAttribute( 'trail' ) ).toBe( true );
		}
	} );

	test( 'steps swapped in after the container rendered are stamped too', async () => {
		host.innerHTML = `<os-steps horizontal><os-step title="Start"></os-step></os-steps>`;
		await tick();
		const steps = host.querySelector( 'os-steps' )!;

		const fresh = [ 'Start', 'Name', 'Apps' ].map( ( title ) => {
			const step = document.createElement( 'os-step' );
			step.setAttribute( 'title', title );
			return step;
		} );
		steps.replaceChildren( ...fresh );
		await tick();
		await tick();

		for ( const step of fresh ) {
			expect( step.hasAttribute( 'trail' ) ).toBe( true );
		}
	} );

	test( 'a vertical container leaves `trail` off its steps', async () => {
		host.innerHTML = `<os-steps><os-step title="Start"></os-step></os-steps>`;
		await tick();
		expect( host.querySelector( 'os-step' )!.hasAttribute( 'trail' ) ).toBe( false );
	} );
} );
