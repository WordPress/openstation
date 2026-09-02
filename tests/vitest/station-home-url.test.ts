import { describe, expect, test } from 'vitest';
import { matchesStationHomeUrl } from '../../src/open-targets/station-home-url';

describe( 'Station Home URL remap', () => {
	test( 'claims the ordinary WordPress dashboard', () => {
		expect(
			matchesStationHomeUrl( new URL( 'https://example.test/wp-admin/index.php' ) ),
		).toBe( true );
	} );

	test( 'does not trap the deliberate classic dashboard escape', () => {
		expect(
			matchesStationHomeUrl(
				new URL(
					'https://example.test/wp-admin/index.php?desktop_mode_classic=1',
				),
			),
		).toBe( false );
	} );

	test( 'does not claim a Dashboard subpage', () => {
		expect(
			matchesStationHomeUrl(
				new URL( 'https://example.test/wp-admin/index.php?page=my-analytics' ),
			),
		).toBe( false );
	} );

	test( 'does not claim another admin screen', () => {
		expect(
			matchesStationHomeUrl( new URL( 'https://example.test/wp-admin/edit.php' ) ),
		).toBe( false );
	} );
} );
