/**
 * Code Blue — pure model tests.
 *
 * Exercises the grouping, filtering, and time-bucketing that sit
 * between the REST payload and the window's chart + issue list.
 */
import { describe, expect, test } from 'vitest';
import {
	BUCKET_ORDER,
	bucketOf,
	bucketize,
	countBuckets,
	filterEntries,
	groupEntries,
	severityRank,
	sortGroups,
} from '../../src/code-blue/model';
import type { LogEntry, LogLevel } from '../../src/code-blue/types';

function entry( overrides: Partial< LogEntry > = {} ): LogEntry {
	return {
		timestamp: 1000,
		level: 'warning',
		label: 'PHP Warning',
		message: 'Undefined array key "foo"',
		file: '/srv/wp-content/plugins/x/x.php',
		line: 12,
		trace: '',
		signature: 'warning|Undefined array key "foo"|/srv/wp-content/plugins/x/x.php',
		...overrides,
	};
}

describe( 'bucketOf', () => {
	test( 'folds the six severities into the four display buckets', () => {
		expect( bucketOf( 'fatal' ) ).toBe( 'error' );
		expect( bucketOf( 'error' ) ).toBe( 'error' );
		expect( bucketOf( 'warning' ) ).toBe( 'warning' );
		expect( bucketOf( 'deprecated' ) ).toBe( 'deprecated' );
		expect( bucketOf( 'notice' ) ).toBe( 'info' );
		expect( bucketOf( 'info' ) ).toBe( 'info' );
	} );

	test( 'stack order keeps the two pale hues non-adjacent', () => {
		// warning (pale yellow) and info (pale cyan) must never sit
		// next to each other in the stack — deprecated (gray) sits
		// between them. See types.ts for the rationale.
		const warningIndex = BUCKET_ORDER.indexOf( 'warning' );
		const infoIndex = BUCKET_ORDER.indexOf( 'info' );
		expect( Math.abs( warningIndex - infoIndex ) ).toBeGreaterThan( 1 );
	} );
} );

describe( 'severityRank', () => {
	test( 'orders fatal before error before warning', () => {
		const order: LogLevel[] = [
			'fatal',
			'error',
			'warning',
			'deprecated',
			'notice',
			'info',
		];
		for ( let i = 1; i < order.length; i++ ) {
			expect( severityRank( order[ i - 1 ] ) ).toBeLessThan(
				severityRank( order[ i ] ),
			);
		}
	} );
} );

describe( 'groupEntries', () => {
	test( 'merges entries sharing a signature and counts them', () => {
		const groups = groupEntries( [
			entry( { timestamp: 100 } ),
			entry( { timestamp: 200 } ),
			entry( { timestamp: 300, signature: 'other', message: 'Different' } ),
		] );
		expect( groups ).toHaveLength( 2 );
		const first = groups.find( ( g ) => g.signature !== 'other' )!;
		expect( first.count ).toBe( 2 );
		expect( first.firstTs ).toBe( 100 );
		expect( first.lastTs ).toBe( 200 );
	} );

	test( 'takes the most severe level seen in the group', () => {
		const groups = groupEntries( [
			entry( { level: 'warning', label: 'PHP Warning' } ),
			entry( { level: 'fatal', label: 'PHP Fatal error' } ),
			entry( { level: 'notice', label: 'PHP Notice' } ),
		] );
		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].level ).toBe( 'fatal' );
		expect( groups[ 0 ].label ).toBe( 'PHP Fatal error' );
		expect( groups[ 0 ].bucket ).toBe( 'error' );
	} );

	test( 'keeps the longest trace as the detail sample', () => {
		const groups = groupEntries( [
			entry( { trace: 'short' } ),
			entry( { trace: '#0 much longer stack trace\n#1 {main}' } ),
			entry( { trace: '' } ),
		] );
		expect( groups[ 0 ].trace ).toContain( '{main}' );
	} );

	test( 'occurrences are newest-first and capped', () => {
		const many = Array.from( { length: 30 }, ( _, i ) =>
			entry( { timestamp: i + 1 } ),
		);
		const groups = groupEntries( many );
		expect( groups[ 0 ].count ).toBe( 30 );
		expect( groups[ 0 ].occurrences[ 0 ] ).toBe( 30 );
		expect( groups[ 0 ].occurrences.length ).toBeLessThanOrEqual( 20 );
	} );

	test( 'untimestamped entries group without breaking first/last', () => {
		const groups = groupEntries( [
			entry( { timestamp: null } ),
			entry( { timestamp: 500 } ),
		] );
		expect( groups[ 0 ].firstTs ).toBe( 500 );
		expect( groups[ 0 ].lastTs ).toBe( 500 );
	} );
} );

describe( 'sortGroups', () => {
	const groups = groupEntries( [
		entry( { signature: 'a', timestamp: 100 } ),
		entry( { signature: 'a', timestamp: 150 } ),
		entry( { signature: 'a', timestamp: 900 } ),
		entry( { signature: 'b', timestamp: 999 } ),
	] );

	test( 'recent puts the latest occurrence first', () => {
		const sorted = sortGroups( groups, 'recent' );
		expect( sorted[ 0 ].signature ).toBe( 'b' );
	} );

	test( 'frequent puts the highest count first', () => {
		const sorted = sortGroups( groups, 'frequent' );
		expect( sorted[ 0 ].signature ).toBe( 'a' );
	} );
} );

describe( 'filterEntries', () => {
	const entries = [
		entry( { level: 'fatal', timestamp: 100, message: 'Uncaught Error' } ),
		entry( { level: 'warning', timestamp: 200 } ),
		entry( { level: 'deprecated', timestamp: null, message: 'Old API' } ),
	];

	test( 'empty bucket set keeps everything', () => {
		expect(
			filterEntries( entries, {
				buckets: new Set(),
				query: '',
				sinceTs: null,
			} ),
		).toHaveLength( 3 );
	} );

	test( 'bucket filter matches via the display bucket', () => {
		const kept = filterEntries( entries, {
			buckets: new Set( [ 'error' ] ),
			query: '',
			sinceTs: null,
		} );
		expect( kept ).toHaveLength( 1 );
		expect( kept[ 0 ].level ).toBe( 'fatal' );
	} );

	test( 'a time floor drops untimestamped entries', () => {
		const kept = filterEntries( entries, {
			buckets: new Set(),
			query: '',
			sinceTs: 150,
		} );
		expect( kept ).toHaveLength( 1 );
		expect( kept[ 0 ].timestamp ).toBe( 200 );
	} );

	test( 'query is case-insensitive over message, label, and file', () => {
		const byMessage = filterEntries( entries, {
			buckets: new Set(),
			query: 'uncaught',
			sinceTs: null,
		} );
		expect( byMessage ).toHaveLength( 1 );
		const byFile = filterEntries( entries, {
			buckets: new Set(),
			query: 'plugins/x',
			sinceTs: null,
		} );
		expect( byFile ).toHaveLength( 3 );
	} );
} );

describe( 'countBuckets', () => {
	test( 'totals per display bucket', () => {
		const totals = countBuckets( [
			entry( { level: 'fatal' } ),
			entry( { level: 'error' } ),
			entry( { level: 'notice' } ),
		] );
		expect( totals.error ).toBe( 2 );
		expect( totals.info ).toBe( 1 );
		expect( totals.warning ).toBe( 0 );
	} );
} );

describe( 'bucketize', () => {
	test( 'returns null when nothing carries a timestamp', () => {
		expect(
			bucketize( [ entry( { timestamp: null } ) ], null, 1000, 24 ),
		).toBeNull();
	} );

	test( 'spreads entries across buckets within the window', () => {
		const data = bucketize(
			[
				entry( { timestamp: 0, level: 'fatal' } ),
				entry( { timestamp: 1199, level: 'warning' } ),
			],
			0,
			1200,
			24,
		)!;
		expect( data.buckets ).toHaveLength( 24 );
		expect( data.bucketSec ).toBe( 50 );
		expect( data.buckets[ 0 ].error ).toBe( 1 );
		expect( data.buckets[ 23 ].warning ).toBe( 1 );
	} );

	test( 'entries before the floor are excluded', () => {
		const data = bucketize(
			[
				entry( { timestamp: 10 } ),
				entry( { timestamp: 500 } ),
			],
			400,
			1000,
			10,
		)!;
		const total = data.buckets.reduce(
			( sum, column ) => sum + column.warning,
			0,
		);
		expect( total ).toBe( 1 );
	} );

	test( 'a null floor starts at the oldest timestamp', () => {
		const data = bucketize(
			[ entry( { timestamp: 300 } ), entry( { timestamp: 600 } ) ],
			null,
			900,
			10,
		)!;
		expect( data.start ).toBe( 300 );
		expect( data.buckets[ 0 ].warning ).toBe( 1 );
	} );
} );
