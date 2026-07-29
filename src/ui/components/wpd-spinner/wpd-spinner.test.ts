/**
 * `<wpd-spinner>` — smoke tests covering preset selection, attribute
 * overrides, the CSS-variable color/accent/size sync, and the
 * accessibility surface (role + aria-label).
 *
 * Pixel-level animation timing is a runtime concern (jsdom doesn't
 * lay out CSS animations); these tests assert the shape of the
 * rendered SVG and that knobs reach the right places.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-spinner';
// eslint-disable-next-line no-duplicate-imports
import { WPD_SPINNER_PRESETS } from './wpd-spinner';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

describe( '<wpd-spinner>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders an SVG with role=img and the default aria-label', async () => {
		host.innerHTML = `<wpd-spinner></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' )!;
		const svg = spinner.shadowRoot!.querySelector( 'svg' );
		expect( svg ).not.toBeNull();
		expect( svg!.getAttribute( 'role' ) ).toBe( 'img' );
		expect( svg!.getAttribute( 'aria-label' ) ).toBe( 'Loading' );
	} );

	test( '`label` attribute customizes the SVG\'s aria-label', async () => {
		host.innerHTML = `<wpd-spinner label="Saving changes"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		expect( svg.getAttribute( 'aria-label' ) ).toBe( 'Saving changes' );
	} );

	test( 'classic preset renders without trailing dots; comet adds them', async () => {
		host.innerHTML = `<wpd-spinner preset="classic"></wpd-spinner>`;
		await tick();
		const classic = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		// Classic has zero dots — six base circles (3 tracks + 3 active arcs)
		// plus the disc, totalling 7 circles inside the SVG.
		expect( classic.querySelectorAll( 'circle' ).length ).toBe( 7 );

		host.innerHTML = `<wpd-spinner preset="comet"></wpd-spinner>`;
		await tick();
		const comet = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		// Comet adds 5 dots → 7 + 5 = 12.
		expect( comet.querySelectorAll( 'circle' ).length ).toBe(
			7 + WPD_SPINNER_PRESETS.comet.dots,
		);
	} );

	test( 'individual attributes override the active preset', async () => {
		// Comet defaults to 5 dots; override to 8.
		host.innerHTML = `<wpd-spinner preset="comet" dots="8"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 7 + 8 );
	} );

	test( 'unknown preset name falls back to classic', async () => {
		host.innerHTML = `<wpd-spinner preset="not-a-real-preset"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		// Classic = 0 dots = 7 circles.
		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 7 );
	} );

	test( 'color/accent/size attributes write CSS variables on the host', async () => {
		host.innerHTML = `<wpd-spinner
			color="#1a5f85"
			accent="#fff8e7"
			size="80"
		></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--wpd-spinner-color' ).trim() ).toBe(
			'#1a5f85',
		);
		expect(
			spinner.style.getPropertyValue( '--wpd-spinner-accent' ).trim(),
		).toBe( '#fff8e7' );
		// Bare integer → px.
		expect( spinner.style.getPropertyValue( '--wpd-spinner-size' ).trim() ).toBe(
			'80px',
		);
	} );

	test( '`size` accepts CSS lengths verbatim', async () => {
		host.innerHTML = `<wpd-spinner size="2em"></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--wpd-spinner-size' ).trim() ).toBe(
			'2em',
		);
	} );

	test( 'removing color/accent attributes clears the CSS variables', async () => {
		host.innerHTML = `<wpd-spinner color="red" accent="black"></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' ) as HTMLElement;
		expect( spinner.style.getPropertyValue( '--wpd-spinner-color' ) ).toBe(
			'red',
		);
		spinner.removeAttribute( 'color' );
		spinner.removeAttribute( 'accent' );
		await tick();
		expect( spinner.style.getPropertyValue( '--wpd-spinner-color' ) ).toBe(
			'',
		);
		expect( spinner.style.getPropertyValue( '--wpd-spinner-accent' ) ).toBe(
			'',
		);
	} );

	test( 'pulse="both" wires both scale + opacity animations onto the disc group', async () => {
		host.innerHTML = `<wpd-spinner pulse="both"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		const discGroup = svg.querySelector( 'g' ) as SVGGElement;
		const style = discGroup.getAttribute( 'style' ) || '';
		expect( style ).toContain( 'wpd-spinner-scale' );
		expect( style ).toContain( 'wpd-spinner-opacity' );
	} );

	test( 'dir2="-1" reverses ring 2 via animation-direction reverse', async () => {
		host.innerHTML = `<wpd-spinner dir2="-1"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;
		// Active ring circles are the ones with stroke-dasharray.
		const activeRings = svg.querySelectorAll(
			'circle[stroke-dasharray]',
		);
		// Ring 2 is the second active ring (index 1).
		const ring2Style = ( activeRings[ 1 ] as SVGCircleElement ).getAttribute(
			'style',
		);
		expect( ring2Style ).toMatch( /reverse/ );
	} );

	test( 'inline preset drops the mark and the concentric rings', async () => {
		host.innerHTML = `<wpd-spinner preset="inline"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		// Track + arc, and nothing else. No disc, no rings 2/3, no dots.
		expect( svg.querySelectorAll( 'circle' ).length ).toBe( 2 );
		// The WordPress mark is what makes the other presets illegible
		// at text size — it must not be in the tree at all.
		expect( svg.querySelector( '.mark' ) ).toBeNull();
		expect( svg.querySelectorAll( 'path' ).length ).toBe( 0 );
		// Square 24-unit viewBox, so a bare `size` maps 1:1 to px.
		expect( svg.getAttribute( 'viewBox' ) ).toBe( '0 0 24 24' );
	} );

	test( 'inline preset keeps the a11y surface and the tempo knobs', async () => {
		host.innerHTML = `<wpd-spinner preset="inline" label="Thinking" sp1="20"></wpd-spinner>`;
		await tick();
		const svg = host
			.querySelector( 'wpd-spinner' )!
			.shadowRoot!.querySelector( 'svg' )!;

		expect( svg.getAttribute( 'role' ) ).toBe( 'img' );
		expect( svg.getAttribute( 'aria-label' ) ).toBe( 'Thinking' );
		// sp1 is deciseconds: 20 → 2.00s. Overridable like every preset.
		expect(
			svg.querySelectorAll( 'circle' )[ 1 ].getAttribute( 'style' ),
		).toMatch( /2\.00s/ );
	} );

	test( 'inline appears in the exported preset registry', () => {
		// Preset-picker UIs iterate the record; a preset that renders
		// through a separate path still has to be listed.
		expect( Object.keys( WPD_SPINNER_PRESETS ) ).toContain( 'inline' );
	} );

	test( 'switching to and from inline re-paints correctly', async () => {
		host.innerHTML = `<wpd-spinner preset="classic"></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' )!;
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
		// Regression: the architectural fix in component.ts means
		// attribute changes route through requestUpdate, which we
		// override to schedule a paint. Toggle preset and verify the
		// dot count changes accordingly.
		host.innerHTML = `<wpd-spinner preset="classic"></wpd-spinner>`;
		await tick();
		const spinner = host.querySelector( 'wpd-spinner' )!;
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 );

		spinner.setAttribute( 'preset', 'pulse' );
		await tick();
		expect(
			spinner.shadowRoot!.querySelectorAll( 'svg circle' ).length,
		).toBe( 7 + WPD_SPINNER_PRESETS.pulse.dots );
	} );
} );
