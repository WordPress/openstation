/**
 * Unit tests for the pure encoding helpers behind the Galaxy view.
 * The scene-level Pixi rendering is left to manual verification, but
 * the brightness curve and the tab filter predicate are pure and
 * stable enough to lock in here.
 */
import { describe, expect, test } from 'vitest';
import {
	dotBrightness,
	galaxyTabFilter,
} from '../../src/content-graph/galaxy-encodings';

describe( 'dotBrightness', () => {
	test( 'returns 0 for a silent zero-length post', () => {
		expect( dotBrightness( 0, 0 ) ).toBe( 0 );
	} );

	test( 'is clamped at 1 even for outliers', () => {
		expect( dotBrightness( 100_000, 100_000_000 ) ).toBe( 1 );
	} );

	test( 'is monotonic in comment count when words held fixed', () => {
		const a = dotBrightness( 0, 1000 );
		const b = dotBrightness( 5, 1000 );
		const c = dotBrightness( 50, 1000 );
		expect( b ).toBeGreaterThan( a );
		expect( c ).toBeGreaterThan( b );
	} );

	test( 'is monotonic in word count when comments held fixed', () => {
		const a = dotBrightness( 5, 0 );
		const b = dotBrightness( 5, 500 );
		const c = dotBrightness( 5, 5000 );
		expect( b ).toBeGreaterThan( a );
		expect( c ).toBeGreaterThan( b );
	} );

	test( 'is log-scaled so an outlier word count does not pin to 1', () => {
		// A 1000-word post with 0 comments should land well under
		// the brightness of a 2000-word post with 50 comments.
		const lone = dotBrightness( 0, 1000 );
		const balanced = dotBrightness( 50, 2000 );
		expect( balanced ).toBeGreaterThan( lone );
		expect( lone ).toBeLessThan( 0.6 );
	} );
} );

describe( 'galaxyTabFilter', () => {
	const now = 1_700_000_000; // arbitrary fixed clock
	const window = 30 * 24 * 3600;

	function node( opts: {
		status?: string;
		modified?: number;
		comments?: number;
	} = {} ) {
		return {
			status: opts.status ?? 'publish',
			modified_ts: opts.modified ?? now - window * 5, // very old
			comment_count: opts.comments ?? 0,
		};
	}

	test( 'all tab passes any node above min comments', () => {
		expect(
			galaxyTabFilter( node(), 'all', 0, now, window ),
		).toBe( true );
		expect(
			galaxyTabFilter( node( { comments: 3 } ), 'all', 5, now, window ),
		).toBe( false );
		expect(
			galaxyTabFilter( node( { comments: 5 } ), 'all', 5, now, window ),
		).toBe( true );
	} );

	test( 'drafts tab restricts to status="draft"', () => {
		expect(
			galaxyTabFilter(
				node( { status: 'publish' } ),
				'drafts',
				0,
				now,
				window,
			),
		).toBe( false );
		expect(
			galaxyTabFilter(
				node( { status: 'draft' } ),
				'drafts',
				0,
				now,
				window,
			),
		).toBe( true );
	} );

	test( 'recent tab includes posts modified within the window', () => {
		expect(
			galaxyTabFilter(
				node( { modified: now - window / 2 } ),
				'recent',
				0,
				now,
				window,
			),
		).toBe( true );
		expect(
			galaxyTabFilter(
				node( { modified: now - window - 1 } ),
				'recent',
				0,
				now,
				window,
			),
		).toBe( false );
	} );

	test( 'min comments gate is applied across all tabs', () => {
		expect(
			galaxyTabFilter(
				node( { status: 'draft', comments: 2 } ),
				'drafts',
				5,
				now,
				window,
			),
		).toBe( false );
		expect(
			galaxyTabFilter(
				node( { modified: now, comments: 0 } ),
				'recent',
				1,
				now,
				window,
			),
		).toBe( false );
	} );
} );
