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

	/*
	 * A source assertion rather than a layout one, for the reason the
	 * file header gives: jsdom has no style engine. It is worth having
	 * anyway because the failure it guards is invisible in code review.
	 *
	 * `--os-ui-step-chip-border` is the hook a trail uses to draw its
	 * unreached steps as outlines. Under `content-box` that border
	 * lands OUTSIDE the declared chip size, so an outlined chip comes
	 * out 2px wider and taller than the filled one next to it and its
	 * whole row grows with it — a trail where the step you are on is
	 * smaller than the ones you have not reached.
	 */
	test( 'the chip sizes border-box, so an outlined chip matches a filled one', () => {
		// Whitespace-tolerant: the source is spaced, a minified build is not.
		expect( stepStyles.cssText ).toMatch( /box-sizing:\s*border-box/ );
	} );
} );
