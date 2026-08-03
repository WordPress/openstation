import { describe, expect, it } from 'vitest';
import {
	OS_FOUNDATION_TOKENS,
	isOsUiToken,
	readToken,
	setToken,
} from '../../src/ui/core/tokens';

describe( 'isOsUiToken', () => {
	it( 'recognises os-* names', () => {
		expect( isOsUiToken( '--os-ui-button-bg' ) ).toBe( true );
		expect( isOsUiToken( '--os-ui-border' ) ).toBe( true );
		expect( isOsUiToken( '--os-ui-badge-info-bg' ) ).toBe( true );
	} );

	it( 'rejects names outside the os-* namespace', () => {
		expect( isOsUiToken( '--wp-admin-theme-color' ) ).toBe( false );
		expect( isOsUiToken( '--my-plugin-color' ) ).toBe( false );
		expect( isOsUiToken( '--osuibutton' ) ).toBe( false );
		expect( isOsUiToken( 'os-button-bg' ) ).toBe( false );
	} );
} );

describe( 'readToken / setToken', () => {
	it( 'roundtrips an inline value through the helpers', () => {
		const el = document.createElement( 'div' );
		document.body.appendChild( el );
		setToken( el, '--os-ui-test-value', '42px' );
		expect( readToken( '--os-ui-test-value', el ) ).toBe( '42px' );
		document.body.removeChild( el );
	} );

	it( 'reads from documentElement by default', () => {
		document.documentElement.style.setProperty(
			'--os-ui-test-default',
			'999px',
		);
		expect( readToken( '--os-ui-test-default' ) ).toBe( '999px' );
		document.documentElement.style.removeProperty( '--os-ui-test-default' );
	} );

	it( 'returns empty string for an unset token', () => {
		expect( readToken( '--os-ui-missing-token' ) ).toBe( '' );
	} );
} );

describe( 'OS_FOUNDATION_TOKENS', () => {
	it( 'lists the kit-wide foundation tokens', () => {
		expect( OS_FOUNDATION_TOKENS.border ).toBe( '--os-ui-border' );
		expect( OS_FOUNDATION_TOKENS.borderStrong ).toBe( '--os-ui-border-strong' );
	} );
} );
