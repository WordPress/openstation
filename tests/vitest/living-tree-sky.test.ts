/**
 * The Living Tree — time-of-day sky.
 *
 * Covers the pure `skyForTime()` colour/light/luminary curve and the
 * `currentHour()` debug override. The `SkyLayer` render class needs PIXI,
 * so it's exercised visually, not here.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { currentHour, skyForTime } from '../../src/plugins/living-tree-wallpaper/sky';

describe( 'living-tree skyForTime', () => {
	test( 'midday is bright with no stars; deep night is dark and starry', () => {
		const noon = skyForTime( 13 );
		expect( noon.light01 ).toBeGreaterThan( 0.9 );
		expect( noon.starAlpha ).toBeLessThan( 0.05 );
		expect( noon.sunAlpha ).toBeGreaterThan( 0.9 );

		const night = skyForTime( 2 );
		expect( night.light01 ).toBeLessThan( 0.25 );
		expect( night.starAlpha ).toBeGreaterThan( 0.8 );
		expect( night.moonAlpha ).toBeGreaterThan( 0.8 );
		expect( night.sunAlpha ).toBeLessThan( 0.05 );
	} );

	test( 'light rises from dawn to noon and falls into dusk', () => {
		const dawn = skyForTime( 6 );
		const noon = skyForTime( 13 );
		const dusk = skyForTime( 19 );
		expect( dawn.light01 ).toBeLessThan( noon.light01 );
		expect( dusk.light01 ).toBeLessThan( noon.light01 );
	} );

	test( 'the sun climbs to its peak (smallest y) around noon', () => {
		const morning = skyForTime( 8 );
		const noon = skyForTime( 12 );
		// y01 is measured from the top, so a higher sun = smaller y01.
		expect( noon.sunY01 ).toBeLessThan( morning.sunY01 );
	} );

	test( 'is continuous across the 24→0 wrap', () => {
		const before = skyForTime( 23.99 );
		const after = skyForTime( 0.01 );
		expect( Math.abs( before.light01 - after.light01 ) ).toBeLessThan( 0.05 );
		expect( Math.abs( before.starAlpha - after.starAlpha ) ).toBeLessThan( 0.05 );
	} );

	test( 'clamps out-of-range hours into the cycle', () => {
		expect( skyForTime( 25 ) ).toEqual( skyForTime( 1 ) );
		expect( skyForTime( -1 ) ).toEqual( skyForTime( 23 ) );
	} );

	test( 'the star field wheels one full turn per day, like the sun', () => {
		expect( skyForTime( 0 ).starAngle ).toBe( 0 );
		expect( skyForTime( 12 ).starAngle ).toBeCloseTo( Math.PI, 10 );
		// Monotone across the night: the sky never spins backwards.
		expect( skyForTime( 23 ).starAngle ).toBeGreaterThan(
			skyForTime( 22 ).starAngle,
		);
	} );
} );

describe( 'living-tree currentHour', () => {
	afterEach( () => {
		delete ( window as { openStationLivingTreeHourOverride?: unknown } )
			.openStationLivingTreeHourOverride;
	} );

	test( 'honours a finite numeric override', () => {
		( window as { openStationLivingTreeHourOverride?: unknown } )
			.openStationLivingTreeHourOverride = 3.5;
		expect( currentHour() ).toBe( 3.5 );
	} );

	test( 'wraps an out-of-range override', () => {
		( window as { openStationLivingTreeHourOverride?: unknown } )
			.openStationLivingTreeHourOverride = 26;
		expect( currentHour() ).toBe( 2 );
	} );

	test( 'falls back to a real clock reading in [0, 24)', () => {
		const h = currentHour();
		expect( h ).toBeGreaterThanOrEqual( 0 );
		expect( h ).toBeLessThan( 24 );
	} );
} );
