/**
 * `stackOnPhone()` — the one decision every list window makes about
 * its `<os-table>` on a phone: cards on, sticky columns off, and the
 * grid back (sticky columns included) once the stamp is gone.
 */
import { describe, expect, test } from 'vitest';
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
