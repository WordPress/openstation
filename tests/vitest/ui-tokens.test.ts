import { describe, expect, it } from 'vitest';
import {
	WPD_FOUNDATION_TOKENS,
	isWpdToken,
	readToken,
	setToken,
} from '../../src/ui/core/tokens';

describe( 'isWpdToken', () => {
	it( 'recognises wpd-* names', () => {
		expect( isWpdToken( '--wpd-button-bg' ) ).toBe( true );
		expect( isWpdToken( '--wpd-border' ) ).toBe( true );
		expect( isWpdToken( '--wpd-badge-info-bg' ) ).toBe( true );
	} );

	it( 'rejects names outside the wpd-* namespace', () => {
		expect( isWpdToken( '--wp-admin-theme-color' ) ).toBe( false );
		expect( isWpdToken( '--my-plugin-color' ) ).toBe( false );
		expect( isWpdToken( '--wpdbutton' ) ).toBe( false );
		expect( isWpdToken( 'wpd-button-bg' ) ).toBe( false );
	} );
} );

describe( 'readToken / setToken', () => {
	it( 'roundtrips an inline value through the helpers', () => {
		const el = document.createElement( 'div' );
		document.body.appendChild( el );
		setToken( el, '--wpd-test-value', '42px' );
		expect( readToken( '--wpd-test-value', el ) ).toBe( '42px' );
		document.body.removeChild( el );
	} );

	it( 'reads from documentElement by default', () => {
		document.documentElement.style.setProperty(
			'--wpd-test-default',
			'999px',
		);
		expect( readToken( '--wpd-test-default' ) ).toBe( '999px' );
		document.documentElement.style.removeProperty( '--wpd-test-default' );
	} );

	it( 'returns empty string for an unset token', () => {
		expect( readToken( '--wpd-missing-token' ) ).toBe( '' );
	} );
} );

describe( 'WPD_FOUNDATION_TOKENS', () => {
	it( 'lists the kit-wide foundation tokens', () => {
		expect( WPD_FOUNDATION_TOKENS.border ).toBe( '--wpd-border' );
		expect( WPD_FOUNDATION_TOKENS.borderStrong ).toBe( '--wpd-border-strong' );
	} );
} );
