/**
 * Plugins Discover card compatibility + maintenance signals.
 */

import { describe, expect, test } from 'vitest';
import {
	compareReleaseVersions,
	evaluatePluginCompatibility,
	formatPluginFreshness,
} from '../../src/plugins-window/card';

describe( 'plugin card signals', () => {
	test( 'compares dotted WordPress/PHP releases numerically', () => {
		expect( compareReleaseVersions( '6.10', '6.9' ) ).toBe( 1 );
		expect( compareReleaseVersions( '8.3.0', '8.3' ) ).toBe( 0 );
		expect( compareReleaseVersions( '7.4', '8.0' ) ).toBe( -1 );
	} );

	test( 'flags unmet WordPress requirements before tested-version claims', () => {
		const signal = evaluatePluginCompatibility(
			{ requires: '6.9', tested: '6.9', requires_php: '7.4' },
			'6.8',
			'8.3',
		);
		expect( signal.tone ).toBe( 'danger' );
		expect( signal.label ).toContain( '6.9' );
	} );

	test( 'warns when the directory tested version trails the site', () => {
		const signal = evaluatePluginCompatibility(
			{ requires: '6.0', tested: '6.7', requires_php: '7.4' },
			'6.8',
			'8.3',
		);
		expect( signal.tone ).toBe( 'warning' );
		expect( signal.label ).toContain( '6.7' );
	} );

	test( 'treats two-year-old updates as a maintenance warning', () => {
		const now = Date.parse( '2026-08-18T00:00:00Z' );
		const signal = formatPluginFreshness( '2024-06-01T00:00:00Z', now );
		expect( signal.tone ).toBe( 'warning' );
		expect( signal.label ).toContain( '2 years' );
	} );

	test( 'parses the compact am/pm timestamps returned by WordPress.org', () => {
		const now = Date.parse( '2026-08-18T00:00:00Z' );
		const signal = formatPluginFreshness( '2026-08-17 10:12pm GMT', now );
		expect( signal ).toEqual( {
			label: 'Updated recently',
			tone: 'positive',
		} );
	} );
} );
