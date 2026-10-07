import { describe, expect, test } from 'vitest';

import {
	DEFAULT_INTERVAL,
	IDLE_MULTIPLIER,
	MAX_BACKOFF,
	MIN_INTERVAL,
	clampInterval,
	nextDelay,
	shouldSkipBeat,
} from '../app/src/lib/schedule';

describe( 'clampInterval', () => {
	test( 'takes the server’s value when it is sane', () => {
		expect( clampInterval( 300000 ) ).toBe( 300000 );
	} );

	test( 'floors a server asking for a faster pulse than we allow', () => {

		expect( clampInterval( 1000 ) ).toBe( MIN_INTERVAL );
		expect( clampInterval( 0 ) ).toBe( DEFAULT_INTERVAL );
		expect( clampInterval( -5 ) ).toBe( DEFAULT_INTERVAL );
	} );

	test( 'falls back when the value is missing or unparseable', () => {
		expect( clampInterval( undefined ) ).toBe( DEFAULT_INTERVAL );
		expect( clampInterval( 'soon' ) ).toBe( DEFAULT_INTERVAL );
		expect( clampInterval( null, 90000 ) ).toBe( 90000 );
	} );
} );

describe( 'shouldSkipBeat', () => {
	test( 'never skips when the app has been used since the last beat', () => {
		expect(
			shouldSkipBeat( {
				activeSinceLastBeat: true,
				hasFreedWindows: false,
				skips: 0,
			} ),
		).toBe( false );
	} );

	test( 'never skips while a window is out on the desktop', () => {

		expect(
			shouldSkipBeat( {
				activeSinceLastBeat: false,
				hasFreedWindows: true,
				skips: 0,
			} ),
		).toBe( false );
	} );

	test( 'skips while idle, then beats anyway after the multiplier', () => {
		const idle = ( skips: number ) =>
			shouldSkipBeat( {
				activeSinceLastBeat: false,
				hasFreedWindows: false,
				skips,
			} );

		for ( let i = 0; i < IDLE_MULTIPLIER - 1; i++ ) {
			expect( idle( i ) ).toBe( true );
		}

		expect( idle( IDLE_MULTIPLIER - 1 ) ).toBe( false );
	} );
} );

describe( 'nextDelay', () => {
	test( 'is the plain interval when nothing has failed', () => {
		expect( nextDelay( 120000, 0 ) ).toBe( 120000 );
	} );

	test( 'widens geometrically while failures persist', () => {
		expect( nextDelay( 120000, 1 ) ).toBe( 120000 );
		expect( nextDelay( 120000, 3 ) ).toBe( 360000 );
	} );

	test( 'stops widening at the ceiling', () => {

		expect( nextDelay( 120000, 999 ) ).toBe( 120000 * MAX_BACKOFF );
	} );
} );
