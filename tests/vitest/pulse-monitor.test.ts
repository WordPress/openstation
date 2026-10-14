/**
 * Pulse Monitor — settings sanitization, the health diagnosis, the
 * rhythm engine, the spike text, and the shared signal hub.
 *
 * The rhythm tests drive the engine's clock directly, so they pin the
 * contract the scene relies on: activity beats queue behind a
 * refractory gap, a quiet site keeps a resting rhythm, a site that is
 * down conducts nothing, and each condition draws its own morphology.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { activity } from '../../src/activity';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { doAction, HOOKS } from '../../src/hooks';
import { acquirePulseHub } from '../../src/plugins/pulse-monitor/hub';
import { spikeText } from '../../src/plugins/pulse-monitor/monitor';
import {
	PULSE_DEFAULTS,
	parseMuted,
	sanitizePulseSettings,
	serializeMuted,
} from '../../src/plugins/pulse-monitor/settings';
import { HealthMonitor } from '../../src/plugins/pulse-monitor/health';
import { Beeper, createReadout } from '../../src/plugins/pulse-monitor/readout';
import { IncidentLog, INCIDENT_MAX } from '../../src/plugins/pulse-monitor/incidents';
import { renderIssues } from '../../src/plugins/pulse-monitor/issues';
import { renderPulseConfig } from '../../src/plugins/pulse-monitor/config';
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
		h.setServer( 0, { siteHealth: { good: 10, recommended: 0, critical: 3 }, requests: 10, failures: 0, cronLate: 0 } );
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
		slow.setServer( 0, { siteHealth: { good: 1, recommended: 9, critical: 3 }, requests: 0, failures: 0, cronLate: 999999 } );
		for ( let i = 0; i < 20; i++ ) {
			slow.recordRequest( i * 100, 200 );
			slow.recordLatency( i * 100, 4000 );
			slow.recordJsError( i * 100 );
		}
		const r = settle( slow );
		expect( r.score ).toBeLessThan( 30 );
		expect( r.state ).toBe( 'sick' );

		const config = new HealthMonitor();
		config.setServer( 0, { siteHealth: { good: 1, recommended: 9, critical: 9 }, requests: 0, failures: 0, cronLate: 999999 } );
		expect( settle( config ).state ).toBe( 'strained' );

		const failing = new HealthMonitor();
		for ( let i = 0; i < 20; i++ ) {
			failing.recordRequest( i * 100, 503 );
		}
		const f = settle( failing );
		expect( f.state ).toBe( 'critical' );
		expect( f.cause ).toMatch( /of requests failing/ );
		// The live case: a slow, misconfigured site where a few requests
		// (5 %) also fail. Low score — but fibrillation, not VT, and its
		// beats blame the slowness, not the failures.
		const mixed = new HealthMonitor();
		mixed.setServer( 0, { siteHealth: { good: 1, recommended: 9, critical: 2 }, requests: 0, failures: 0, cronLate: 999999 } );
		for ( let i = 0; i < 40; i++ ) {
			mixed.recordRequest( i * 100, i % 20 === 0 ? 404 : 200 );
			mixed.recordLatency( i * 100, 3400 );
			mixed.recordJsError( i * 100 );
		}
		const m = settle( mixed );
		expect( m.state ).toBe( 'sick' );
		expect( m.cause ).toMatch( /slow responses|JavaScript errors/ );

	} );

	test( 'one long request cannot make the site look slow', () => {
		const h = new HealthMonitor();
		// A 20-second AI search among ordinary requests.
		h.recordLatency( 0, 20000 );
		for ( let i = 1; i < 20; i++ ) {
			h.recordLatency( i * 100, 150 );
		}
		const r = h.read( 2000 );
		expect( r.latencyP95 ).toBe( 150 );
		expect( r.reasons.join( ' ' ) ).not.toMatch( /slow responses/ );

		// Too few samples: no p95 at all, however slow they were.
		const few = new HealthMonitor();
		for ( let i = 0; i < 5; i++ ) {
			few.recordLatency( i * 100, 20000 );
		}
		expect( few.read( 1000 ).latencyP95 ).toBeNull();
		// And one request counts for at most 10 s.
		expect( few.read( 1000 ).latencyP50 ).toBe( 10000 );
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

	test( 'window network reports beat — the editor’s included — without a messages tick', () => {
		const { hub, release } = acquirePulseHub();
		const beats: Array< { source: string; error?: boolean; detail?: string } > = [];
		const off = hub.subscribe( ( beat ) => beats.push( beat ) );
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, { windowId: 'desktop-mode-posts', method: 'POST', url: '/wp-json/wp/v2/posts/1', status: 200, duration: 120, failed: false } );
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, { windowId: 'edit-php', method: 'GET', url: '/x', status: 500, duration: 80, failed: true } );
		// The bridge message the shell relays from is not a "messages" beat.
		window.dispatchEvent( new MessageEvent( 'message', { data: { type: 'os-iframe-network' }, origin: window.location.origin } ) );
		expect( beats ).toEqual( [
			expect.objectContaining( { source: 'requests', error: false } ),
			expect.objectContaining( { source: 'requests', error: true, detail: '500' } ),
		] );
		off();
		release();
	} );

	test( 'a request the page cancelled is neither a beat nor a failure', () => {
		const { hub, release } = acquirePulseHub();
		const beats: unknown[] = [];
		const off = hub.subscribe( ( beat ) => beats.push( beat ) );
		for ( let i = 0; i < 8; i++ ) {
			doAction( HOOKS.IFRAME_NETWORK_COMPLETED, { windowId: 'w', method: 'GET', url: `/search?q=${ i }`, status: 0, duration: 30, failed: true, aborted: true } );
		}
		expect( beats ).toEqual( [] );
		const reading = hub.health.read( performance.now() );
		expect( reading.state ).not.toBe( 'down' );
		expect( reading.successRate ).toBeNull();
		off();
		release();
	} );

	test( 'a window page’s taps are released when it unloads or its frame goes away', () => {
		vi.useFakeTimers();
		const frame = ( path: string ): { iframe: HTMLIFrameElement; doc: Document; removed: string[] } => {
			const iframe = document.createElement( 'iframe' );
			document.body.appendChild( iframe );
			const doc = iframe.contentDocument as Document;
			// jsdom frames are about:blank, which the scan skips.
			Object.defineProperty( doc, 'URL', { value: `${ window.location.origin }${ path }` } );
			const removed: string[] = [];
			const original = doc.removeEventListener.bind( doc );
			doc.removeEventListener = ( ( type: string, ...rest: [ EventListenerOrEventListenerObject, EventListenerOptions? ] ) => {
				removed.push( type );
				original( type, ...rest );
			} ) as typeof doc.removeEventListener;
			return { iframe, doc, removed };
		};
		const navigated = frame( '/wp-admin/edit.php' );
		const closed = frame( '/wp-admin/upload.php' );
		const { release } = acquirePulseHub();

		// A navigation inside the window: the old document unloads.
		navigated.iframe.contentWindow?.dispatchEvent( new Event( 'pagehide' ) );
		expect( navigated.removed.sort() ).toEqual( [ 'keydown', 'pointerdown', 'wheel' ] );

		// A closed window: the frame leaves the shell; the next scan lets go.
		expect( closed.removed ).toEqual( [] );
		closed.iframe.remove();
		vi.advanceTimersByTime( 1600 );
		expect( closed.removed.sort() ).toEqual( [ 'keydown', 'pointerdown', 'wheel' ] );

		release();
		navigated.iframe.remove();
		vi.useRealTimers();
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

describe( 'Beeper', () => {
	test( 'no audio context exists while sound is off', () => {
		const made: Array< { closed: boolean } > = [];
		class FakeContext {
			state = 'running';
			closed = false;
			constructor() {
				made.push( this );
			}
			resume(): Promise< void > {
				return Promise.resolve();
			}
			close(): Promise< void > {
				this.closed = true;
				return Promise.resolve();
			}
		}
		const previous = window.AudioContext;
		( window as unknown as { AudioContext: unknown } ).AudioContext = FakeContext;
		try {
			const beeper = new Beeper();
			document.dispatchEvent( new Event( 'pointerdown' ) );
			expect( made ).toHaveLength( 0 );

			beeper.setEnabled( true );
			document.dispatchEvent( new Event( 'pointerdown' ) );
			expect( made ).toHaveLength( 1 );

			beeper.setEnabled( false );
			expect( made[ 0 ].closed ).toBe( true );
			document.dispatchEvent( new Event( 'keydown' ) );
			expect( made ).toHaveLength( 1 );
			beeper.destroy();
		} finally {
			( window as unknown as { AudioContext: unknown } ).AudioContext = previous;
		}
	} );
} );

describe( 'layout settings', () => {
	test( 'the band layout and its height are sanitized', () => {
		expect( sanitizePulseSettings( {} ).layout ).toBe( 'full' );
		expect( sanitizePulseSettings( { layout: 'band', bandHeight: 999 } ) ).toMatchObject( { layout: 'band', bandHeight: 300 } );
		expect( sanitizePulseSettings( { layout: 'sideways', bandHeight: 'tall' } ) ).toMatchObject( { layout: 'full', bandHeight: 88 } );
	} );
} );

describe( 'diagnosis, itemised', () => {
	test( 'each penalty says what it is about and what it costs', () => {
		const h = new HealthMonitor();
		h.setServer( 0, { siteHealth: { good: 1, recommended: 2, critical: 1 }, requests: 0, failures: 0, cronLate: 4000 } );
		for ( let i = 0; i < 10; i++ ) {
			h.recordRequest( i * 100, i % 2 ? 404 : 200 );
		}
		const topics = h.read( 1500 ).penalties.map( ( p ) => p.topic );
		expect( topics ).toEqual( expect.arrayContaining( [ 'site-health-critical', 'site-health-recommended', 'cron', 'failures' ] ) );
		const points = h.read( 1500 ).penalties.map( ( p ) => p.points );
		expect( [ ...points ].sort( ( a, b ) => b - a ) ).toEqual( points );
	} );
} );

describe( 'incidents', () => {
	test( 'the log keeps the newest, newest first, and notifies', () => {
		const log = new IncidentLog();
		let changes = 0;
		const off = log.subscribe( () => changes++ );
		for ( let i = 0; i < INCIDENT_MAX + 5; i++ ) {
			log.add( { source: 'requests', detail: String( i ), at: i } );
		}
		const list = log.list();
		expect( list ).toHaveLength( INCIDENT_MAX );
		expect( list[ 0 ].detail ).toBe( String( INCIDENT_MAX + 4 ) );
		expect( changes ).toBe( INCIDENT_MAX + 5 );
		log.clear();
		expect( log.list() ).toEqual( [] );
		off();
	} );

	describe( 'filed by the taps', () => {
		beforeEach( () => installHooksStub() );
		afterEach( () => clearHooksStub() );

		test( 'a failed request inside a window keeps its URL, method and window', () => {
			const { hub, release } = acquirePulseHub();
			doAction( HOOKS.IFRAME_NETWORK_COMPLETED, { windowId: 'edit-php', method: 'POST', url: '/wp-admin/admin-ajax.php', status: 500, duration: 80, failed: true } );
			doAction( HOOKS.IFRAME_NETWORK_COMPLETED, { windowId: 'edit-php', method: 'GET', url: '/ok', status: 200, duration: 80, failed: false } );
			doAction( HOOKS.IFRAME_ERROR, { windowId: 'edit-php', message: 'TypeError: x is undefined', filename: 'https://x.test/a.js', lineno: 12 } );
			expect( hub.incidents.list() ).toEqual( [
				expect.objectContaining( { source: 'errors', detail: 'TypeError: x is undefined', where: 'https://x.test/a.js:12', windowId: 'edit-php' } ),
				expect.objectContaining( { source: 'requests', detail: '500', status: 500, method: 'POST', url: '/wp-admin/admin-ajax.php', windowId: 'edit-php' } ),
			] );
			release();
		} );
	} );
} );

describe( 'the readout as a button', () => {
	test( 'where it can be reached it opens the issues; on the wallpaper it is an image', () => {
		const host = document.createElement( 'div' );
		let opened = 0;
		const button = createReadout( host, 'band', () => opened++ );
		const root = host.querySelector( '.os-pulse-readout' ) as HTMLElement;
		expect( root.getAttribute( 'role' ) ).toBe( 'button' );
		root.click();
		root.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) );
		expect( opened ).toBe( 2 );
		// Each number explains itself on hover.
		expect( ( root.children[ 1 ] as HTMLElement ).title ).toMatch( /Median response time/ );
		button.destroy();

		const still = document.createElement( 'div' );
		createReadout( still, 'wallpaper' ).destroy();
		createReadout( still, 'wallpaper' );
		expect( still.querySelector( '.os-pulse-readout' )?.getAttribute( 'role' ) ).toBe( 'img' );
	} );
} );

describe( 'Issues view', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'lists what holds the score down and every failure, live', async () => {
		const { hub, release } = acquirePulseHub();
		hub.health.setServer( performance.now(), { siteHealth: { good: 1, recommended: 0, critical: 2 }, requests: 0, failures: 0, cronLate: 0 } );
		const body = document.createElement( 'div' );
		const teardown = renderIssues( body );
		expect( body.textContent ).toContain( '2 critical Site Health issues' );
		expect( body.textContent ).toContain( 'Open Site Health' );
		expect( body.textContent ).toContain( 'No problems since this page loaded.' );

		hub.incidents.add( { source: 'requests', detail: '404', status: 404, method: 'GET', url: '/wp-json/shop/v1/cart' } );
		await new Promise( ( r ) => requestAnimationFrame( () => r( null ) ) );
		expect( body.textContent ).toContain( 'GET /wp-json/shop/v1/cart' );
		expect( body.textContent ).toContain( 'Recent problems (1)' );

		teardown();
		expect( body.children ).toHaveLength( 0 );
		release();
	} );
} );

describe( 'settings form', () => {
	test( 'the widget’s form edits its own settings and has no wallpaper layout', () => {
		const writes: Array< Record< string, unknown > > = [];
		const wallpaper = document.createElement( 'div' );
		renderPulseConfig( wallpaper, { settings: {}, setSettings: ( p ) => writes.push( p ) } );
		expect( wallpaper.textContent ).toContain( 'Wallpaper layout' );

		const widget = document.createElement( 'div' );
		renderPulseConfig( widget, { settings: {}, setSettings: ( p ) => writes.push( p ), face: 'widget' } );
		expect( widget.textContent ).not.toContain( 'Wallpaper layout' );
		expect( widget.textContent ).toContain( 'Monitor' );
	} );
} );
