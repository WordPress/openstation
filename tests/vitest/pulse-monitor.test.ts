/**
 * Pulse Monitor — settings sanitization, the health diagnosis, the
 * rhythm engine, the spike text, and the shared signal hub.
 *
 * The rhythm tests drive the engine's clock directly, so they pin the
 * contract the scene relies on: activity beats queue behind a
 * refractory gap, a quiet site keeps a resting rhythm, a site that is
 * down conducts nothing, and each condition draws its own morphology.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { activity } from '../../src/activity';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { acquirePulseHub } from '../../src/plugins/pulse-monitor/hub';
import { spikeText } from '../../src/plugins/pulse-monitor/monitor';
import {
	PULSE_DEFAULTS,
	parseMuted,
	sanitizePulseSettings,
	serializeMuted,
} from '../../src/plugins/pulse-monitor/settings';
import { HealthMonitor } from '../../src/plugins/pulse-monitor/health';
import { Rhythm, type BeatStarted } from '../../src/plugins/pulse-monitor/rhythm';
import { shapeFor, sourceCatalog, SOURCE_IDS } from '../../src/plugins/pulse-monitor/sources';

/** Deterministic PRNG (mulberry32). */
function seeded( seed: number ): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = ( a + 0x6d2b79f5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

/** Run the engine for `ms`, stepping every 5 ms; returns the samples. */
function run( rhythm: Rhythm, from: number, ms: number ): number[] {
	const samples: number[] = [];
	for ( let t = from; t <= from + ms; t += 5 ) {
		rhythm.step( t );
		samples.push( rhythm.sample( t ).value );
	}
	return samples;
}

describe( 'sanitizePulseSettings', () => {
	test( 'empty input falls back to defaults', () => {
		expect( sanitizePulseSettings( undefined ) ).toEqual( PULSE_DEFAULTS );
		expect( sanitizePulseSettings( {} ) ).toEqual( PULSE_DEFAULTS );
	} );

	test( 'the defaults are a black desk with a red line', () => {
		expect( PULSE_DEFAULTS.background ).toBe( '#000000' );
		expect( PULSE_DEFAULTS.lineColor ).toBe( '#ff2a2a' );
	} );

	test( 'clamps numbers and rejects malformed values', () => {
		const s = sanitizePulseSettings( {
			speed: 99999,
			intensity: -4,
			echoes: 7.6,
			lineColor: 'red',
			background: '#ABCDEF',
			style: 'spiral',
			grid: 'yes',
		} );
		expect( s.speed ).toBe( 600 );
		expect( s.intensity ).toBe( 0.3 );
		expect( s.echoes ).toBe( 8 );
		expect( s.lineColor ).toBe( PULSE_DEFAULTS.lineColor );
		expect( s.background ).toBe( '#abcdef' );
		expect( s.style ).toBe( 'sweep' );
		expect( s.grid ).toBe( false );
	} );

	test( 'muted sources round-trip through one comma string', () => {
		expect( parseMuted( 'assets, input,bogus,assets' ) ).toEqual( [ 'assets', 'input' ] );
		expect( serializeMuted( [ 'assets', 'input' ] ) ).toBe( 'assets,input' );
		expect( sanitizePulseSettings( { muted: 'cron' } ).muted ).toEqual( [ 'cron' ] );
	} );

	test( 'settings stay under the shell’s 32-key-per-wallpaper cap', () => {
		expect( Object.keys( PULSE_DEFAULTS ).length ).toBeLessThanOrEqual( 32 );
	} );
} );

describe( 'sources', () => {
	test( 'catalog covers every id, split client / server', () => {
		const catalog = sourceCatalog();
		expect( catalog.map( ( s ) => s.id ) ).toEqual( [ ...SOURCE_IDS ] );
		expect( catalog.find( ( s ) => s.id === 'visitors' )?.group ).toBe( 'server' );
		expect( catalog.find( ( s ) => s.id === 'requests' )?.group ).toBe( 'client' );
	} );

	test( 'unknown sources (plugin kinds) get a standard beat', () => {
		expect( shapeFor( 'my-plugin-kind' ).shape ).toBe( 'qrs' );
		expect( shapeFor( 'heartbeat' ).shape ).toBe( 'double' );
	} );
} );

describe( 'HealthMonitor', () => {
	test( 'a quiet or clean site is healthy', () => {
		const h = new HealthMonitor();
		expect( h.read( 0 ).state ).toBe( 'healthy' );
		for ( let i = 0; i < 20; i++ ) {
			h.recordRequest( i * 100, 200 );
			h.recordLatency( i * 100, 120 );
		}
		const r = h.read( 2000 );
		expect( r.state ).toBe( 'healthy' );
		expect( r.successRate ).toBe( 1 );
		expect( r.latencyP50 ).toBe( 120 );
	} );

	test( 'failing requests degrade the rhythm, worst first in the reasons', () => {
		const h = new HealthMonitor();
		for ( let i = 0; i < 20; i++ ) {
			h.recordRequest( i * 100, i % 2 ? 503 : 200 );
		}
		// Smoothing settles after a few time constants.
		let r = h.read( 2000 );
		for ( let t = 2500; t <= 40000; t += 500 ) {
			r = h.read( t > 59000 ? 59000 : t );
		}
		expect( [ 'sick', 'critical' ] ).toContain( r.state );
		expect( r.reasons[ 0 ] ).toMatch( /^50%{1,2} of requests failing$/ );
	} );

	test( 'server snapshot feeds the score', () => {
		const h = new HealthMonitor();
		h.setServer( 0, { siteHealth: { good: 10, recommended: 0, critical: 3 }, requests: 10, failures: 0, cronLate: 0, load: null } );
		let r = h.read( 0 );
		for ( let t = 0; t <= 60000; t += 1000 ) {
			r = h.read( t );
		}
		expect( r.score ).toBe( 70 );
		expect( r.state ).toBe( 'strained' );
	} );

	test( 'a slow, misconfigured site is never critical — only failing requests are', () => {
		const settle = ( h: HealthMonitor ): ReturnType< HealthMonitor[ 'read' ] > => {
			let r = h.read( 0 );
			for ( let t = 0; t <= 50000; t += 1000 ) {
				r = h.read( t );
			}
			return r;
		};
		const slow = new HealthMonitor();
		slow.setServer( 0, { siteHealth: { good: 1, recommended: 9, critical: 3 }, requests: 0, failures: 0, cronLate: 999999, load: null } );
		for ( let i = 0; i < 20; i++ ) {
			slow.recordRequest( i * 100, 200 );
			slow.recordLatency( i * 100, 4000 );
			slow.recordJsError( i * 100 );
		}
		const r = settle( slow );
		expect( r.score ).toBeLessThan( 30 );
		expect( r.state ).toBe( 'sick' );

		const config = new HealthMonitor();
		config.setServer( 0, { siteHealth: { good: 1, recommended: 9, critical: 9 }, requests: 0, failures: 0, cronLate: 999999, load: null } );
		expect( settle( config ).state ).toBe( 'strained' );

		const failing = new HealthMonitor();
		for ( let i = 0; i < 20; i++ ) {
			failing.recordRequest( i * 100, 503 );
		}
		expect( settle( failing ).state ).toBe( 'critical' );
	} );

	test( 'offline, a lost Heartbeat connection or a run of network failures is down', () => {
		const offline = new HealthMonitor();
		offline.setOffline( true );
		expect( offline.read( 0 ).state ).toBe( 'down' );

		const lost = new HealthMonitor();
		lost.setHeartbeatLost( true );
		expect( lost.read( 0 ).state ).toBe( 'down' );

		const failing = new HealthMonitor();
		for ( let i = 0; i < 5; i++ ) {
			failing.recordRequest( i, 0 );
		}
		expect( failing.read( 10 ).state ).toBe( 'down' );
		failing.recordRequest( 20, 200 );
		expect( failing.read( 30 ).state ).not.toBe( 'down' );
	} );

	test( 'observations age out of the window', () => {
		const h = new HealthMonitor( 1000 );
		for ( let i = 0; i < 10; i++ ) {
			h.recordRequest( i, 500 );
		}
		h.read( 10 );
		expect( h.read( 5000 ).successRate ).toBeNull();
	} );
} );

describe( 'Rhythm', () => {
	test( 'a quiet site keeps its resting rate', () => {
		const rhythm = new Rhythm( { restingBpm: 60, random: seeded( 1 ) } );
		run( rhythm, 0, 15000 );
		expect( rhythm.heartRate() ).toBeGreaterThanOrEqual( 56 );
		expect( rhythm.heartRate() ).toBeLessThanOrEqual( 64 );
	} );

	test( 'resting 0 flatlines when quiet', () => {
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 2 ) } );
		const samples = run( rhythm, 0, 5000 );
		expect( Math.max( ...samples.map( Math.abs ) ) ).toBeLessThan( 0.1 );
	} );

	test( 'a burst queues behind the refractory gap instead of merging', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 3 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.step( 0 );
		for ( let i = 0; i < 5; i++ ) {
			rhythm.push( { source: 'requests' } );
		}
		run( rhythm, 0, 1000 );
		// 300 ms gap → beats at 0, 300, 600, 900.
		expect( started.filter( ( b ) => b.major ) ).toHaveLength( 4 );
		run( rhythm, 1005, 500 );
		expect( started.filter( ( b ) => b.major ) ).toHaveLength( 5 );
	} );

	test( 'delayed pushes start at their time (server replay)', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 4 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.step( 0 );
		rhythm.push( { source: 'visitors' }, 2000 );
		run( rhythm, 0, 1900 );
		expect( started ).toHaveLength( 0 );
		run( rhythm, 1905, 200 );
		expect( started.map( ( b ) => b.source ) ).toEqual( [ 'visitors' ] );
	} );

	test( 'failed requests draw as ectopic beats', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 5 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.step( 0 );
		rhythm.push( { source: 'requests', error: true } );
		run( rhythm, 0, 400 );
		expect( started[ 0 ] ).toMatchObject( { shape: 'pvc', error: true } );
	} );

	test( 'each condition has its own morphology', () => {
		const shapesIn = ( state: 'healthy' | 'strained' | 'sick' | 'critical' ): Set< string > => {
			const started: BeatStarted[] = [];
			const rhythm = new Rhythm( { restingBpm: 70, random: seeded( 6 ), onBeat: ( b ) => started.push( b ) } );
			rhythm.setState( state );
			run( rhythm, 0, 30000 );
			return new Set( started.map( ( b ) => `${ b.shape }:${ b.error }` ) );
		};
		expect( shapesIn( 'healthy' ) ).toEqual( new Set( [ 'qrs:false' ] ) );
		expect( shapesIn( 'strained' ) ).toEqual( new Set( [ 'qrs:false', 'pvc:true' ] ) );
		expect( shapesIn( 'critical' ) ).toEqual( new Set( [ 'vt:true' ] ) );
		expect( shapesIn( 'sick' ) ).toEqual( new Set( [ 'qrs:false' ] ) );
	} );

	test( 'atrial fibrillation is irregular; sinus is regular', () => {
		const intervals = ( state: 'healthy' | 'sick' ): number => {
			const times: number[] = [];
			let t = 0;
			const rhythm = new Rhythm( { restingBpm: 70, random: seeded( 7 ), onBeat: () => times.push( t ) } );
			rhythm.setState( state );
			for ( t = 0; t <= 30000; t += 5 ) {
				rhythm.step( t );
			}
			const gaps = times.slice( 1 ).map( ( v, i ) => v - times[ i ] );
			const mean = gaps.reduce( ( a, b ) => a + b, 0 ) / gaps.length;
			const sd = Math.sqrt( gaps.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / gaps.length );
			return sd / mean;
		};
		expect( intervals( 'healthy' ) ).toBeLessThan( 0.05 );
		expect( intervals( 'sick' ) ).toBeGreaterThan( 0.15 );
	} );

	test( 'a site that is down conducts nothing but still counts signals', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 70, random: seeded( 8 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.setState( 'down' );
		rhythm.step( 0 );
		rhythm.push( { source: 'requests' } );
		const samples = run( rhythm, 0, 5000 );
		expect( started ).toHaveLength( 0 );
		expect( Math.max( ...samples.map( Math.abs ) ) ).toBeLessThan( 0.05 );
		expect( rhythm.eventsPerMinute() ).toBe( 2 );
	} );
} );

describe( 'failed beats explain themselves', () => {
	test( 'a failed request carries its status into the beat', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 9 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.step( 0 );
		rhythm.push( { source: 'requests', error: true, detail: '404' } );
		run( rhythm, 0, 400 );
		expect( started[ 0 ] ).toMatchObject( { error: true, detail: '404', ectopic: false } );
		expect( spikeText( started[ 0 ] ) ).toBe( 'request · 404' );
	} );

	test( 'a normal beat has no detail', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 0, random: seeded( 10 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.step( 0 );
		rhythm.push( { source: 'visitors', detail: 'ignored' } );
		run( rhythm, 0, 400 );
		expect( spikeText( started[ 0 ] ) ).toBe( 'visit' );
	} );

	test( 'beats the diagnosis turns abnormal name the rhythm and its cause', () => {
		const started: BeatStarted[] = [];
		const rhythm = new Rhythm( { restingBpm: 70, random: seeded( 11 ), onBeat: ( b ) => started.push( b ) } );
		rhythm.setState( 'strained', 'slow responses (p95 3.1 s)' );
		run( rhythm, 0, 30000 );
		const pvc = started.find( ( b ) => b.ectopic );
		expect( pvc ).toBeDefined();
		expect( spikeText( pvc as BeatStarted ) ).toBe( 'PVC: slow responses (p95 3.1 s)' );

		const vt: BeatStarted[] = [];
		const critical = new Rhythm( { restingBpm: 70, random: seeded( 12 ), onBeat: ( b ) => vt.push( b ) } );
		critical.setState( 'critical', '42% of requests failing' );
		critical.step( 0 );
		critical.push( { source: 'requests' } );
		run( critical, 0, 400 );
		expect( spikeText( vt[ 0 ] ) ).toBe( 'request · VT: 42% of requests failing' );
	} );
} );

describe( 'shared hub', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'two monitors share one set of taps', () => {
		const a = acquirePulseHub();
		const b = acquirePulseHub();
		const seen: string[] = [];
		const off = a.hub.subscribe( ( beat ) => seen.push( beat.source ) );

		activity.publish( 'os/request-settled', { url: '/x', method: 'GET', status: 200, ok: true, windowId: null, silent: false } );
		expect( seen ).toEqual( [ 'requests' ] );
		expect( a.hub.health ).toBe( b.hub.health );

		b.release();
		activity.publish( 'os/request-settled', { url: '/y', method: 'GET', status: 500, ok: false, windowId: null, silent: false } );
		expect( seen ).toEqual( [ 'requests', 'requests' ] );

		a.release();
		activity.publish( 'os/request-settled', { url: '/z', method: 'GET', status: 200, ok: true, windowId: null, silent: false } );
		expect( seen ).toHaveLength( 2 );
		off();
	} );

	test( 'failed requests carry their status', () => {
		const { hub, release } = acquirePulseHub();
		const beats: Array< { error?: boolean; detail?: string } > = [];
		const off = hub.subscribe( ( beat ) => beats.push( beat ) );
		activity.publish( 'os/request-settled', { url: '/a', method: 'GET', status: 503, ok: false, windowId: null, silent: false } );
		activity.publish( 'os/request-settled', { url: '/b', method: 'GET', error: 'Failed to fetch', windowId: null, silent: false } );
		expect( beats ).toEqual( [
			expect.objectContaining( { error: true, detail: '503' } ),
			expect.objectContaining( { error: true, detail: 'Failed to fetch' } ),
		] );
		off();
		release();
	} );
} );
