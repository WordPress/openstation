/**
 * `<os-steps>` / `<os-step>` — smoke tests. Verifies the shadow
 * tree renders, the `title` prop plumbs through, and light-DOM slot
 * content reaches the body.
 *
 * The actual CSS-counter numbering is a visual property — we don't
 * assert the rendered number since jsdom doesn't run the style
 * engine. The counter logic is declared in `.styles.ts`; deleting
 * it would make the visual test fail in a real browser, but there's
 * no meaningful way to unit-test it here.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-steps';

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
} );
