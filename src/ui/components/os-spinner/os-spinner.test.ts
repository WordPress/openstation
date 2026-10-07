import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-spinner';

import { OS_SPINNER_PRESETS } from './os-spinner';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

describe( '<os-spinner>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders an SVG with role=img and the default aria-label', async () => {
		host.innerHTML = `<os-spinner></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' )!;
		const svg = spinner.shadowRoot!.querySelector( 'svg' );
		expect( svg ).not.toBeNull();
		expect( svg!.getAttribute( 'role' ) ).toBe( 'img' );
		expect( svg!.getAttribute( 'aria-label' ) ).toBe( 'Loading' );
	} );

	test( '`label` attribute customizes the SVG\'s aria-label', async () => {
		host.innerHTML = `<os-spinner label="Saving changes"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		expect( svg.getAttribute( 'aria-label' ) ).toBe( 'Saving changes' );
	} );

	test( 'classic preset renders without trailing dots; comet adds them', async () => {
		host.innerHTML = `<os-spinner preset="classic"></os-spinner>`;
		await tick();
		const classic = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( classic.querySelectorAll( 'circle' ).length ).toBe( 7 );

		host.innerHTML = `<os-spinner preset="comet"></os-spinner>`;
		await tick();
		const comet = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( comet.querySelectorAll( 'circle' ).length ).toBe(
			7 + OS_SPINNER_PRESETS.comet.dots,
		);
	} );

	test( 'individual attributes override the active preset', async () => {
		host.innerHTML = `<os-spinner preset="comet" dots="8"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 7 + 8 );
	} );

	test( 'unknown preset name falls back to classic', async () => {
		host.innerHTML = `<os-spinner preset="not-a-real-preset"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 7 );
	} );

	test( 'color/accent/size attributes write CSS variables on the host', async () => {
		host.innerHTML = `<os-spinner
			color="#1a5f85"
			accent="#fff8e7"
			size="80"
		></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--os-ui-spinner-color' ).trim() ).toBe(
			'#1a5f85',
		);
		expect(
			spinner.style.getPropertyValue( '--os-ui-spinner-accent' ).trim(),
		).toBe( '#fff8e7' );

		expect( spinner.style.getPropertyValue( '--os-ui-spinner-size' ).trim() ).toBe(
			'80px',
		);
	} );

	test( '`size` accepts CSS lengths verbatim', async () => {
		host.innerHTML = `<os-spinner size="2em"></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--os-ui-spinner-size' ).trim() ).toBe(
			'2em',
		);
	} );

	test( 'removing color/accent attributes clears the CSS variables', async () => {
		host.innerHTML = `<os-spinner color="red" accent="black"></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--os-ui-spinner-color' ) ).toBe(
			'red',
		);
		spinner.removeAttribute( 'color' );
		spinner.removeAttribute( 'accent' );
		await tick();
		expect( spinner.style.getPropertyValue( '--os-ui-spinner-color' ) ).toBe(
			'',
		);
		expect( spinner.style.getPropertyValue( '--os-ui-spinner-accent' ) ).toBe(
			'',
		);
	} );

	test( 'pulse="both" wires both scale + opacity animations onto the disc group', async () => {
		host.innerHTML = `<os-spinner pulse="both"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		const discGroup = svg.querySelector( 'g' ) as SVGGElement;
		const style = discGroup.getAttribute( 'style' ) || '';
		expect( style ).toContain( 'os-spinner-scale' );
		expect( style ).toContain( 'os-spinner-opacity' );
	} );

	test( 'dir2="-1" reverses ring 2 via animation-direction reverse', async () => {
		host.innerHTML = `<os-spinner dir2="-1"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		const activeRings = svg.querySelectorAll(
			'circle[stroke-dasharray]',
		);

		const ring2Style = ( activeRings[ 1 ] as SVGCircleElement ).getAttribute(
			'style',
		);
		expect( ring2Style ).toMatch( /reverse/ );
	} );

	test( 'inline preset drops the mark and the concentric rings', async () => {
		host.innerHTML = `<os-spinner preset="inline"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 2 );

		expect( svg.querySelector( '.mark' ) ).toBeNull();
		expect( svg.querySelectorAll( 'path' ).length ).toBe( 0 );

		expect( svg.getAttribute( 'viewBox' ) ).toBe( '0 0 24 24' );
	} );

	test( 'inline preset keeps the a11y surface and the tempo knobs', async () => {
		host.innerHTML = `<os-spinner preset="inline" label="Thinking" sp1="20"></os-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'os-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( svg.getAttribute( 'role' ) ).toBe( 'img' );
		expect( svg.getAttribute( 'aria-label' ) ).toBe( 'Thinking' );

		expect(
			svg.querySelectorAll( 'circle' )[ 1 ].getAttribute( 'style' ),
		).toMatch( /2\.00s/ );
	} );

	test( 'inline appears in the exported preset registry', () => {
		expect( Object.keys( OS_SPINNER_PRESETS ) ).toContain( 'inline' );
	} );

	test( 'switching to and from inline re-paints correctly', async () => {
		host.innerHTML = `<os-spinner preset="classic"></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' )!;
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 );

		spinner.setAttribute( 'preset', 'inline' );
		await tick();
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 2 );

		spinner.setAttribute( 'preset', 'classic' );
		await tick();
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 );
	} );

	test( 'live attribute change re-paints the SVG', async () => {
		host.innerHTML = `<os-spinner preset="classic"></os-spinner>`;
		await tick();
		const spinner = host.querySelector( 'os-spinner' )!;
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 );

		spinner.setAttribute( 'preset', 'pulse' );
		await tick();
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 + OS_SPINNER_PRESETS.pulse.dots );
	} );
} );
