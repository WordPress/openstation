/**
 * `<os-facts>` + `<os-fact>` — the label/value list.
 *
 * The load-bearing assertion here is the structural one: the list is
 * a real `<dl>` and each row paints its own `<dt>`/`<dd>` pair, with
 * the value left in the light DOM.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-facts';

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
} );
