/**
 * `<wpd-progress-bar>` — smoke tests covering determinate value
 * rendering, max-clamping, indeterminate mode, the label + percent
 * header, ARIA wiring, and live attribute updates.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-progress-bar';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

describe( '<wpd-progress-bar>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a progressbar track with default ARIA values', async () => {
		host.innerHTML = `<wpd-progress-bar value="0"></wpd-progress-bar>`;
		await tick();
		const track = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.track' )!;
		expect( track.getAttribute( 'role' ) ).toBe( 'progressbar' );
		expect( track.getAttribute( 'aria-valuemin' ) ).toBe( '0' );
		expect( track.getAttribute( 'aria-valuemax' ) ).toBe( '100' );
		expect( track.getAttribute( 'aria-valuenow' ) ).toBe( '0' );
	} );

	test( 'fill width matches value/max in determinate mode', async () => {
		host.innerHTML = `<wpd-progress-bar value="42"></wpd-progress-bar>`;
		await tick();
		const fill = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.fill' ) as HTMLElement;
		expect( parseFloat( fill.style.width ) ).toBeCloseTo( 42, 5 );
	} );

	test( 'value over max is clamped', async () => {
		host.innerHTML = `<wpd-progress-bar value="999" max="200"></wpd-progress-bar>`;
		await tick();
		const fill = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.fill' ) as HTMLElement;
		// 200 / 200 → 100%
		// jsdom normalizes `100.00%` → `100%`; assert numerically.
		expect( parseFloat( fill.style.width ) ).toBeCloseTo( 100, 5 );
		const track = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.track' )!;
		expect( track.getAttribute( 'aria-valuenow' ) ).toBe( '200' );
	} );

	test( 'indeterminate drops aria-valuenow/max and clears inline width', async () => {
		host.innerHTML = `<wpd-progress-bar value="50" indeterminate></wpd-progress-bar>`;
		await tick();
		const bar = host.querySelector( 'wpd-progress-bar' )!;
		const track = bar.shadowRoot!.querySelector( '.track' )!;
		const fill = bar.shadowRoot!.querySelector( '.fill' ) as HTMLElement;
		expect( track.hasAttribute( 'aria-valuenow' ) ).toBe( false );
		expect( track.hasAttribute( 'aria-valuemax' ) ).toBe( false );
		// The CSS animation keeps the bar sweeping; we clear the
		// inline width so the stylesheet's 33% rule wins.
		expect( fill.style.width ).toBe( '' );
	} );

	test( 'label populates the header text and aria-label on the track', async () => {
		host.innerHTML = `<wpd-progress-bar value="10" label="hero.jpg"></wpd-progress-bar>`;
		await tick();
		const bar = host.querySelector( 'wpd-progress-bar' )!;
		const header = bar.shadowRoot!.querySelector( '.header' ) as HTMLElement;
		const labelEl = bar.shadowRoot!.querySelector( '.label' ) as HTMLElement;
		const track = bar.shadowRoot!.querySelector( '.track' )!;
		expect( header.hidden ).toBe( false );
		expect( labelEl.textContent ).toBe( 'hero.jpg' );
		expect( track.getAttribute( 'aria-label' ) ).toBe( 'hero.jpg' );
	} );

	test( 'show-percent renders the integer percent next to the label', async () => {
		host.innerHTML = `<wpd-progress-bar value="33" label="x" show-percent></wpd-progress-bar>`;
		await tick();
		const percent = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.percent' ) as HTMLElement;
		expect( percent.hidden ).toBe( false );
		expect( percent.textContent ).toBe( '33%' );
	} );

	test( 'changing value live re-paints the fill width', async () => {
		host.innerHTML = `<wpd-progress-bar value="10"></wpd-progress-bar>`;
		await tick();
		const bar = host.querySelector( 'wpd-progress-bar' )!;
		const fill = bar.shadowRoot!.querySelector( '.fill' ) as HTMLElement;
		expect( parseFloat( fill.style.width ) ).toBeCloseTo( 10, 5 );
		bar.setAttribute( 'value', '75' );
		await tick();
		expect( parseFloat( fill.style.width ) ).toBeCloseTo( 75, 5 );
	} );

	test( 'max <= 0 falls back to indeterminate behavior', async () => {
		host.innerHTML = `<wpd-progress-bar value="5" max="0"></wpd-progress-bar>`;
		await tick();
		const track = host
			.querySelector( 'wpd-progress-bar' )!
			.shadowRoot!.querySelector( '.track' )!;
		expect( track.hasAttribute( 'aria-valuenow' ) ).toBe( false );
	} );
} );
