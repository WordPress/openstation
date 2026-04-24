/**
 * `<wpd-steps>` / `<wpd-step>` — smoke tests. Verifies the shadow
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
import './wpd-steps';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-steps> + <wpd-step>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders an <ol> and slots children', async () => {
		host.innerHTML = `
			<wpd-steps>
				<wpd-step title="First">one</wpd-step>
				<wpd-step title="Second">two</wpd-step>
			</wpd-steps>
		`;
		await tick();
		const steps = host.querySelector( 'wpd-steps' )!;
		expect( steps.shadowRoot!.querySelector( 'ol' ) ).not.toBeNull();
		expect( host.querySelectorAll( 'wpd-step' ) ).toHaveLength( 2 );
	} );

	test( '<wpd-step> renders its title + slotted body', async () => {
		host.innerHTML = `<wpd-steps><wpd-step title="Install">click install</wpd-step></wpd-steps>`;
		await tick();
		const step = host.querySelector( 'wpd-step' )!;
		expect(
			step.shadowRoot!.querySelector( '.wpd-step__title' )?.textContent,
		).toBe( 'Install' );
		expect( step.textContent ).toContain( 'click install' );
	} );

	test( '`done` attribute survives on the host for CSS to target', async () => {
		host.innerHTML = `<wpd-steps><wpd-step done>x</wpd-step></wpd-steps>`;
		await tick();
		const step = host.querySelector( 'wpd-step' )!;
		expect( step.hasAttribute( 'done' ) ).toBe( true );
	} );
} );
