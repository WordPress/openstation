/**
 * The App Framework's shared formatting primitives.
 *
 * `formatBytes` is the file-drop formatter re-exported — the pin
 * here is that `@openstation/app` serves it at all, plus the
 * distinctive decimal rule. `formatDate` is pinned on the shapes
 * that made five app-side copies subtly disagree: the empty guard,
 * the bare `YYYY-MM` month, and the unparseable-input fallback.
 */
import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate } from '@openstation/app';

describe( 'formatBytes', () => {
	it( 'is served by @openstation/app with the shared decimal rule', () => {
		expect( formatBytes( 0 ) ).toBe( '0 B' );
		expect( formatBytes( 844 ) ).toBe( '844 B' );
		expect( formatBytes( 1024 * 1024 * 1.25 ) ).toBe( '1.3 MB' );
		// ≥ 100 in the unit drops the decimal.
		expect( formatBytes( 563200 ) ).toBe( '550 KB' );
	} );
} );

describe( 'formatDate', () => {
	it( 'renders empty input as an empty string', () => {
		expect( formatDate( '' ) ).toBe( '' );
		expect( formatDate( '', 'month' ) ).toBe( '' );
	} );

	it( 'degrades unparseable input to the raw value, not "Invalid Date"', () => {
		expect( formatDate( 'not-a-date' ) ).toBe( 'not-a-date' );
		expect( formatDate( 'not-a-date', 'iso' ) ).toBe( 'not-a-date' );
	} );

	it( 'reads a bare YYYY-MM as that month, local time', () => {
		expect( formatDate( '2026-08', 'month' ) ).toContain( '2026' );
		// Local midnight, so the month never slides across a timezone.
		expect( formatDate( '2026-08', 'iso' ) ).toBe(
			new Date( '2026-08-01T00:00:00' ).toISOString(),
		);
	} );

	it( 'accepts epoch milliseconds and Date objects', () => {
		const ms = Date.UTC( 2026, 7, 31, 22, 15, 3 );
		expect( formatDate( ms, 'iso' ) ).toBe( '2026-08-31T22:15:03.000Z' );
		expect( formatDate( new Date( ms ), 'iso' ) ).toBe( '2026-08-31T22:15:03.000Z' );
	} );

	it( 'names every style', () => {
		const ms = Date.UTC( 2026, 7, 31, 12, 0, 0 );
		for ( const style of [ 'short', 'long', 'month', 'datetime' ] as const ) {
			expect( formatDate( ms, style ).length ).toBeGreaterThan( 0 );
		}
	} );
} );
