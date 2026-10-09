/**
 * `stackOnPhone()` — the one decision every list window makes about
 * its `<os-table>` on a phone: cards on, sticky columns off, and the
 * grid back (sticky columns included) once the stamp is gone.
 */
import { describe, expect, test } from 'vitest';
import '../../src/ui/components/os-table/os-table';
import { stackOnPhone } from '../../src/ui/components/os-table/stack-on-phone';

function root( mode: string | null ): HTMLElement {
	const el = document.createElement( 'div' );
	if ( mode ) {
		el.setAttribute( 'data-os-mode', mode );
	}
	return el;
}

describe( 'stackOnPhone', () => {
	test( 'on a phone the table is stacked and its sticky columns are lifted', () => {
		const table = document.createElement( 'os-table' );
		table.setAttribute( 'sticky-columns', '1' );
		expect( stackOnPhone( table, root( 'mobile' ) ) ).toBe( true );
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		expect( table.hasAttribute( 'sticky-columns' ) ).toBe( false );
	} );

	test( 'on a desk nothing changes', () => {
		const table = document.createElement( 'os-table' );
		table.setAttribute( 'sticky-columns', '1' );
		expect( stackOnPhone( table, root( 'desktop' ) ) ).toBe( false );
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '1' );
	} );

	test( 'a crossing back out of the phone band restores the grid and its pinned columns', () => {
		const table = document.createElement( 'os-table' );
		table.setAttribute( 'sticky-columns', '2' );
		stackOnPhone( table, root( 'mobile' ) );
		expect( stackOnPhone( table, root( 'desktop' ) ) ).toBe( false );
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '2' );
	} );

	test( 'is idempotent on either side', () => {
		const table = document.createElement( 'os-table' );
		stackOnPhone( table, root( 'mobile' ) );
		stackOnPhone( table, root( 'mobile' ) );
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		stackOnPhone( table, root( null ) );
		stackOnPhone( table, root( null ) );
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.hasAttribute( 'sticky-columns' ) ).toBe( false );
	} );
} );

describe( '<os-table stack-on-phone>', () => {
	const tick = (): Promise< void > =>
		new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

	test( 'mount under a root stamped data-os-mode="mobile" stacks and lifts sticky columns', async () => {
		const container = document.createElement( 'div' );
		container.setAttribute( 'data-os-mode', 'mobile' );
		container.innerHTML = '<os-table stack-on-phone sticky-columns="1"></os-table>';
		document.body.appendChild( container );
		await tick();

		const table = container.querySelector( 'os-table' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		expect( table.hasAttribute( 'sticky-columns' ) ).toBe( false );
		expect( table.getAttribute( 'data-os-sticky-columns' ) ).toBe( '1' );

		container.remove();
	} );

	test( 'a mode flip from mobile to desktop restores the grid and pinned columns', async () => {
		const container = document.createElement( 'div' );
		container.setAttribute( 'data-os-mode', 'mobile' );
		container.innerHTML = '<os-table stack-on-phone sticky-columns="2"></os-table>';
		document.body.appendChild( container );
		await tick();

		const table = container.querySelector( 'os-table' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );

		container.setAttribute( 'data-os-mode', 'desktop' );
		await tick();

		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '2' );
		expect( table.hasAttribute( 'data-os-sticky-columns' ) ).toBe( false );

		container.remove();
	} );

	test( 'a table without stack-on-phone is untouched on mobile', async () => {
		const container = document.createElement( 'div' );
		container.setAttribute( 'data-os-mode', 'mobile' );
		container.innerHTML = '<os-table sticky-columns="1"></os-table>';
		document.body.appendChild( container );
		await tick();

		const table = container.querySelector( 'os-table' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '1' );

		container.remove();
	} );

	test( 'dynamically toggling stack-on-phone responds to mode', async () => {
		const container = document.createElement( 'div' );
		container.setAttribute( 'data-os-mode', 'mobile' );
		container.innerHTML = '<os-table sticky-columns="3"></os-table>';
		document.body.appendChild( container );
		await tick();

		const table = container.querySelector( 'os-table' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );

		table.setAttribute( 'stack-on-phone', '' );
		await tick();
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		expect( table.hasAttribute( 'sticky-columns' ) ).toBe( false );

		table.removeAttribute( 'stack-on-phone' );
		await tick();
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '3' );

		container.remove();
	} );
} );
