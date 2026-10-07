import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createClickCounter,
	createTrunkClickGesture,
	isDeveloperModeEnabled,
	isTrunkHit,
	openDebugPanel,
	SLIDER_DEFS,
	TUNER_CLICK_THRESHOLD,
} from '../../src/plugins/living-tree-wallpaper/debug-panel';
import type {
	Envelope,
	TreeSnapshot,
} from '../../src/plugins/living-tree-wallpaper/types';

function snapshot(): TreeSnapshot {
	return {
		siteUrl: 'https://example.com',
		siteName: 'Example Blog',
		installEpoch: 1_700_000_000,
		siteAgeDays: 365,
		totalPosts: 100,
		totalPages: 10,
		totalCategories: 5,
		totalTags: 20,
		totalComments: 50,
		activeUsers: 2,
		traffic: 500,
		seoHealth: 0.7,
		performance: 0.8,
		branches: [],
	};
}

const ENVELOPE: Envelope = {
	heightMax: 600,
	crownRadius: 250,
	trunkBaseGirth: 12,
	maxDepth: 8,
	attractorBudget: 300,
};

describe( 'living-tree click counter', () => {
	test( 'fires exactly on the threshold-th unbroken click', () => {
		const counter = createClickCounter( 20, 2500 );
		for ( let i = 1; i <= 19; i++ ) {
			expect( counter.hit( i * 100 ) ).toBe( false );
		}
		expect( counter.hit( 2000 ) ).toBe( true );

		expect( counter.hit( 2100 ) ).toBe( false );
	} );

	test( 'a gap longer than the window resets the run', () => {
		const counter = createClickCounter( 3, 1000 );
		expect( counter.hit( 0 ) ).toBe( false );
		expect( counter.hit( 100 ) ).toBe( false );

		expect( counter.hit( 2200 ) ).toBe( false );
		expect( counter.hit( 2300 ) ).toBe( false );
		expect( counter.hit( 2400 ) ).toBe( true );
	} );

	test( 'reset() clears the run', () => {
		const counter = createClickCounter( 2, 1000 );
		expect( counter.hit( 0 ) ).toBe( false );
		counter.reset();
		expect( counter.hit( 100 ) ).toBe( false );
		expect( counter.hit( 200 ) ).toBe( true );
	} );
} );

describe( 'living-tree trunk hit-test', () => {
	test( 'hits the trunk column, misses the crown and the ground', () => {

		expect( isTrunkHit( 0, -150, ENVELOPE ) ).toBe( true );
		expect( isTrunkHit( 20, -50, ENVELOPE ) ).toBe( true );

		expect( isTrunkHit( 200, -150, ENVELOPE ) ).toBe( false );

		expect( isTrunkHit( 0, -500, ENVELOPE ) ).toBe( false );

		expect( isTrunkHit( 0, 40, ENVELOPE ) ).toBe( false );
	} );

	test( 'a sprout still has a clickable floor width', () => {
		const sprout: Envelope = { ...ENVELOPE, heightMax: 70, trunkBaseGirth: 2.5 };
		expect( isTrunkHit( 10, -20, sprout ) ).toBe( true );
	} );
} );

describe( 'living-tree developer-mode gate', () => {
	afterEach( () => {
		delete ( window as { wp?: unknown } ).wp;
	} );

	test( 'off when wp.os is absent', () => {
		expect( isDeveloperModeEnabled() ).toBe( false );
	} );

	test( 'mirrors the OS Settings snapshot flag', () => {
		( window as { wp?: unknown } ).wp = {
			os: { getOsSettings: () => ( { developerModeEnabled: true } ) },
		};
		expect( isDeveloperModeEnabled() ).toBe( true );
		( window as { wp?: unknown } ).wp = {
			os: { getOsSettings: () => ( { developerModeEnabled: false } ) },
		};
		expect( isDeveloperModeEnabled() ).toBe( false );
	} );
} );

describe( 'living-tree trunk-click gesture (the 20-click easter egg, end to end)', () => {

	function gesture( overrides: {
		enabled?: boolean;
		onTrigger: () => void;
	} ) {
		let clock = 0;
		const handler = createTrunkClickGesture( {
			isEnabled: () => overrides.enabled ?? true,

			toLocal: ( clientX, clientY ) => ( { lx: clientX, ly: clientY } ),
			isHit: ( lx, ly ) => isTrunkHit( lx, ly, ENVELOPE ),
			onTrigger: overrides.onTrigger,
			now: () => clock,
		} );
		return {
			click( clientX: number, clientY: number, advanceMs = 100 ): void {
				clock += advanceMs;
				handler( { clientX, clientY } );
			},
		};
	}

	test( 'clicking the trunk 20 times opens the tuner exactly once', () => {
		let opened = 0;
		const g = gesture( { onTrigger: () => opened++ } );
		for ( let i = 0; i < TUNER_CLICK_THRESHOLD; i++ ) {
			g.click( 0, -150 );
		}
		expect( opened ).toBe( 1 );

		g.click( 0, -150 );
		expect( opened ).toBe( 1 );
	} );

	test( 'a click off the trunk resets the run', () => {
		let opened = 0;
		const g = gesture( { onTrigger: () => opened++ } );
		for ( let i = 0; i < TUNER_CLICK_THRESHOLD - 1; i++ ) {
			g.click( 0, -150 );
		}
		g.click( 400, -150 );
		g.click( 0, -150 );
		expect( opened ).toBe( 0 );
	} );

	test( 'slow clicking never triggers (gaps beyond the window reset)', () => {
		let opened = 0;
		const g = gesture( { onTrigger: () => opened++ } );
		for ( let i = 0; i < TUNER_CLICK_THRESHOLD * 2; i++ ) {
			g.click( 0, -150, 3000 );
		}
		expect( opened ).toBe( 0 );
	} );

	test( 'with developer mode off the gesture is inert', () => {
		let opened = 0;
		const g = gesture( { enabled: false, onTrigger: () => opened++ } );
		for ( let i = 0; i < TUNER_CLICK_THRESHOLD * 2; i++ ) {
			g.click( 0, -150 );
		}
		expect( opened ).toBe( 0 );
	} );
} );

describe( 'living-tree tuner panel', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	test( 'threshold constant matches the requested easter egg', () => {
		expect( TUNER_CLICK_THRESHOLD ).toBe( 20 );
	} );

	test( 'mounts on document.body (above the shell), seeded from the snapshot', () => {
		const dispose = openDebugPanel( {
			snapshot: snapshot(),
			onChange: () => {},
			onClose: () => {},
		} );

		const panel = document.querySelector( '[data-living-tree-tuner]' );
		expect( panel?.parentElement ).toBe( document.body );
		const sliders = document.querySelectorAll( 'input[type="range"]' );
		expect( sliders.length ).toBe( SLIDER_DEFS.length );
		const posts = SLIDER_DEFS.findIndex( ( d ) => d.key === 'totalPosts' );
		expect( ( sliders[ posts ] as HTMLInputElement ).value ).toBe( '100' );
		dispose();
		expect( document.querySelector( '[data-living-tree-tuner]' ) ).toBeNull();
	} );

	test( 'dragging a slider emits a debounced edited snapshot', () => {
		const changes: TreeSnapshot[] = [];
		openDebugPanel( {
			snapshot: snapshot(),
			onChange: ( next ) => changes.push( next ),
			onClose: () => {},
		} );
		const posts = SLIDER_DEFS.findIndex( ( d ) => d.key === 'totalPosts' );
		const input = document.querySelectorAll( 'input[type="range"]' )[
			posts
		] as HTMLInputElement;

		input.value = '1500';
		input.dispatchEvent( new Event( 'input' ) );
		input.value = '2000';
		input.dispatchEvent( new Event( 'input' ) );
		expect( changes.length ).toBe( 0 );
		vi.advanceTimersByTime( 120 );
		expect( changes.length ).toBe( 1 );
		expect( changes[ 0 ].totalPosts ).toBe( 2000 );

		expect( changes[ 0 ].siteAgeDays ).toBe( 365 );
	} );

	test( 'the time-of-day slider fires immediately and "live" resets to the clock', () => {
		const hours: Array< number | null > = [];
		openDebugPanel( {
			snapshot: snapshot(),
			hour: 13.5,
			onChange: () => {},
			onHourChange: ( h ) => hours.push( h ),
			onClose: () => {},
		} );
		const input = document.querySelector(
			'input[data-living-tree-hour]',
		) as HTMLInputElement;
		expect( input ).not.toBeNull();
		expect( input.value ).toBe( '13.5' );

		expect( document.querySelectorAll( 'input[type="range"]' ).length ).toBe(
			SLIDER_DEFS.length + 1,
		);

		input.value = '22';
		input.dispatchEvent( new Event( 'input' ) );

		expect( hours ).toEqual( [ 22 ] );

		const live = Array.from( document.querySelectorAll( 'button' ) ).find(
			( b ) => b.textContent === 'live',
		) as HTMLButtonElement;
		live.click();
		expect( hours[ hours.length - 1 ] ).toBeNull();
	} );

	test( 'without onHourChange the panel has no time slider', () => {
		openDebugPanel( {
			snapshot: snapshot(),
			onChange: () => {},
			onClose: () => {},
		} );
		expect( document.querySelector( 'input[data-living-tree-hour]' ) ).toBeNull();
		expect( document.querySelectorAll( 'input[type="range"]' ).length ).toBe(
			SLIDER_DEFS.length,
		);
	} );

	test( 'the close button disposes and reports onClose', () => {
		let closed = false;
		openDebugPanel( {
			snapshot: snapshot(),
			onChange: () => {},
			onClose: () => {
				closed = true;
			},
		} );
		(
			document.querySelector( '[data-living-tree-tuner] button' ) as HTMLButtonElement
		 ).click();
		expect( closed ).toBe( true );
		expect( document.querySelector( '[data-living-tree-tuner]' ) ).toBeNull();
	} );
} );
