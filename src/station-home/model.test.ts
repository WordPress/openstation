import { describe, expect, test } from 'vitest';
import {
	matchesStationHomeUrl,
	stationHomeGreeting,
} from './model';

describe( 'Station Home greeting', () => {
	test.each( [ 0, 8, 11 ] )( 'uses morning at %i:00', ( hour ) => {
		expect( stationHomeGreeting( hour, 'Nick' ) ).toBe( 'Good morning, Nick' );
	} );

	test.each( [ 12, 15, 17 ] )( 'uses afternoon at %i:00', ( hour ) => {
		expect( stationHomeGreeting( hour, 'Nick' ) ).toBe( 'Good afternoon, Nick' );
	} );

	test.each( [ 18, 21, 23 ] )( 'uses evening at %i:00', ( hour ) => {
		expect( stationHomeGreeting( hour, 'Nick' ) ).toBe( 'Good evening, Nick' );
	} );
} );

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

	test( 'does not claim another admin screen', () => {
		expect(
			matchesStationHomeUrl( new URL( 'https://example.test/wp-admin/edit.php' ) ),
		).toBe( false );
	} );
} );
