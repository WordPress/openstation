/**
 * `<os-facts>` + `<os-fact>` — the label/value list.
 *
 * The load-bearing assertion here is the structural one: the list is
 * a real `<dl>` and the rows are `display: contents`, so the
 * `<dt>`/`<dd>` pairs reattach to it rather than sitting inside a
 * box between the list and its own pairs.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-facts';
import { factStyles } from './os-facts.styles';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-facts>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'the list is a dl and each row paints a dt/dd pair', async () => {
		host.innerHTML = `
			<os-facts>
				<os-fact label="File">class-foo.php</os-fact>
				<os-fact label="Occurrences">1,204</os-fact>
			</os-facts>
		`;
		await tick();
		await tick();
		const list = host.querySelector( 'os-facts' )!;
		expect( list.shadowRoot!.querySelector( 'dl' ) ).not.toBeNull();
		const rows = Array.from( host.querySelectorAll( 'os-fact' ) );
		expect( rows ).toHaveLength( 2 );
		expect(
			rows[ 0 ].shadowRoot!.querySelector( 'dt' )!.textContent,
		).toContain( 'File' );
		expect(
			rows[ 0 ].shadowRoot!.querySelector( 'dd' )!.textContent,
		).toBe( '' );
		// The value is a slot, not an attribute, so it stays in the
		// light DOM where an <os-code> or <os-relative-time> can live.
		expect( rows[ 0 ].textContent ).toContain( 'class-foo.php' );
	} );

	test( 'a row is display:contents, so the dt/dd pairs belong to the dl', async () => {
		// Asserted on the stylesheet source rather than on
		// getComputedStyle: jsdom does not apply a shadow root's
		// adopted stylesheets, so a computed read here returns '' for
		// every component in the kit and would pass against any rule
		// at all. The live check is in the PR's screenshots.
		//
		// Without this rule the row is a box between the <dl> and its
		// own pairs: the grid columns collapse into one cell per row,
		// and the description-list relationship is broken in the
		// accessibility tree.
		const flat = factStyles.cssText
			.replace( /\/\*[\s\S]*?\*\//g, '' )
			.replace( /\s+/g, ' ' );
		expect( flat ).toContain( ':host { display: contents; }' );
	} );

	test( 'the label slot wins over the label attribute', async () => {
		host.innerHTML = `
			<os-facts>
				<os-fact label="Ignored"><span slot="label">Marked up</span>v</os-fact>
			</os-facts>
		`;
		await tick();
		await tick();
		const row = host.querySelector( 'os-fact' )!;
		const slot = row.shadowRoot!.querySelector(
			'slot[name="label"]',
		) as HTMLSlotElement;
		expect( slot.assignedNodes() ).toHaveLength( 1 );
		expect( ( slot.assignedNodes()[ 0 ] as HTMLElement ).textContent ).toBe(
			'Marked up',
		);
	} );

	test( 'layout and stacked are plain attributes the stylesheet reads', async () => {
		host.innerHTML = `
			<os-facts layout="between" stacked>
				<os-fact label="Date">today</os-fact>
			</os-facts>
		`;
		await tick();
		await tick();
		const list = host.querySelector( 'os-facts' )!;
		expect( list.getAttribute( 'layout' ) ).toBe( 'between' );
		expect( list.hasAttribute( 'stacked' ) ).toBe( true );
		// Both are styling switches, so the markup must not change:
		// the list is still one <dl> holding the same rows.
		expect( list.shadowRoot!.querySelectorAll( 'dl' ) ).toHaveLength( 1 );
	} );

	test( 'a row added after the first paint is rendered too', async () => {
		host.innerHTML = `<os-facts></os-facts>`;
		await tick();
		await tick();
		const list = host.querySelector( 'os-facts' )!;
		const row = document.createElement( 'os-fact' );
		row.setAttribute( 'label', 'Late' );
		row.textContent = 'value';
		list.appendChild( row );
		await tick();
		await tick();
		// Rows are slotted light children, so a late one needs no
		// re-render of the list to appear.
		expect( row.shadowRoot!.querySelector( 'dt' )!.textContent ).toContain(
			'Late',
		);
	} );
} );
