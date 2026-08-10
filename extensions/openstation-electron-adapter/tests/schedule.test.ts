/**
 * Heartbeat pacing.
 *
 * Every beat is a PHP request on someone's shared hosting. These are
 * the rules that decide how many of them get sent, so they are worth
 * pinning precisely rather than approximately.
 */

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
		// A server asking for a faster pulse is misconfigured or
		// hostile, and either way this app pays the request.
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
		// A freed window is a live surface the user can see. A server
		// that thinks the desktop went away while one sits on screen is
		// telling other plugins something false.
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
		// The idle app still checks in — it just does so a quarter as
		// often. Never beating at all would look like a crash.
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
		// A site that went down should not be hammered — nor should a
		// desktop wait a day to notice it came back.
		expect( nextDelay( 120000, 999 ) ).toBe( 120000 * MAX_BACKOFF );
	} );
} );
