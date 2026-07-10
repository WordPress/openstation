/**
 * The Living Tree — hidden DNA tuner (developer mode).
 *
 * Covers the pieces with real logic: the consecutive-click counter, the
 * trunk hit-test, the slider catalogue, the developer-mode gate, and the
 * panel's DOM contract (sliders render, dragging one emits a debounced
 * snapshot, close disposes).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createClickCounter,
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
		tagCooccurrence: [],
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
		// The run resets after firing — the next click starts from 1.
		expect( counter.hit( 2100 ) ).toBe( false );
	} );

	test( 'a gap longer than the window resets the run', () => {
		const counter = createClickCounter( 3, 1000 );
		expect( counter.hit( 0 ) ).toBe( false );
		expect( counter.hit( 100 ) ).toBe( false );
		// 2s gap → this click is #1 of a new run, not #3.
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
		// On the trunk, halfway up its clickable span.
		expect( isTrunkHit( 0, -150, ENVELOPE ) ).toBe( true );
		expect( isTrunkHit( 20, -50, ENVELOPE ) ).toBe( true );
		// Far to the side.
		expect( isTrunkHit( 200, -150, ENVELOPE ) ).toBe( false );
		// In the crown, above the trunk span.
		expect( isTrunkHit( 0, -500, ENVELOPE ) ).toBe( false );
		// Below ground.
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

	test( 'off when wp.desktop is absent', () => {
		expect( isDeveloperModeEnabled() ).toBe( false );
	} );

	test( 'mirrors the OS Settings snapshot flag', () => {
		( window as { wp?: unknown } ).wp = {
			desktop: { getOsSettings: () => ( { developerModeEnabled: true } ) },
		};
		expect( isDeveloperModeEnabled() ).toBe( true );
		( window as { wp?: unknown } ).wp = {
			desktop: { getOsSettings: () => ( { developerModeEnabled: false } ) },
		};
		expect( isDeveloperModeEnabled() ).toBe( false );
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
		// On body, NOT nested in a wallpaper subtree — the wallpaper layer
		// is visible but never hit-testable under the shell's stack.
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
		// Two rapid moves — the debounce collapses them into one change.
		input.value = '1500';
		input.dispatchEvent( new Event( 'input' ) );
		input.value = '2000';
		input.dispatchEvent( new Event( 'input' ) );
		expect( changes.length ).toBe( 0 );
		vi.advanceTimersByTime( 120 );
		expect( changes.length ).toBe( 1 );
		expect( changes[ 0 ].totalPosts ).toBe( 2000 );
		// Untouched fields ride along unchanged.
		expect( changes[ 0 ].siteAgeDays ).toBe( 365 );
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
