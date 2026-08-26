import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { computeAutoId, ensureAutoId } from './auto-id';

describe( 'auto-id — computeAutoId', () => {
	let root: HTMLElement;

	beforeEach( () => {
		root = document.createElement( 'div' );
		document.body.appendChild( root );
	} );
	afterEach( () => root.remove() );

	test( 'returns os-unnamed for an element with no ancestry + no label', () => {
		root.innerHTML = `<div class="probe"></div>`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe( 'os-unnamed' );
	} );

	test( 'slugifies the element own label', () => {
		root.innerHTML = `<div class="probe" label="From unit"></div>`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe( 'os-from-unit' );
	} );

	test( 'picks up the nearest wp-window-* ancestor', () => {
		root.innerHTML = `
			<div id="wp-window-calculator">
				<div class="probe" label="Amount"></div>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe( 'os-calculator-amount' );
	} );

	test( 'collects tabpanel for-values into tab-X tokens', () => {
		root.innerHTML = `
			<div id="wp-window-posts">
				<os-tabpanel for="convert">
					<div class="probe" label="Amount"></div>
				</os-tabpanel>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe(
			'os-posts-tab-convert-amount',
		);
	} );

	test( 'nested tabpanels contribute outer-first', () => {
		root.innerHTML = `
			<div id="wp-window-x">
				<os-tabpanel for="outer">
					<os-tabpanel for="inner">
						<div class="probe" label="Field"></div>
					</os-tabpanel>
				</os-tabpanel>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe(
			'os-x-tab-outer-tab-inner-field',
		);
	} );

	test( 'slugifies labels with punctuation + unicode-adjacent characters', () => {
		root.innerHTML = `<div class="probe" label="Email (required!)"></div>`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe( 'os-email-required' );
	} );

	test( 'same ancestry + same label produces the same id across calls', () => {
		root.innerHTML = `
			<div id="wp-window-calc">
				<os-tabpanel for="convert">
					<div class="probe" label="From unit"></div>
				</os-tabpanel>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		const first = computeAutoId( probe );
		const second = computeAutoId( probe );
		expect( first ).toBe( second );
		expect( first ).toBe( 'os-calc-tab-convert-from-unit' );
	} );

	test( 'walks past non-window ancestors until it finds the window', () => {
		root.innerHTML = `
			<div id="wp-window-posts">
				<div>
					<div>
						<div>
							<div class="probe" label="Deep"></div>
						</div>
					</div>
				</div>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( computeAutoId( probe ) ).toBe( 'os-posts-deep' );
	} );
} );

describe( 'auto-id — ensureAutoId', () => {
	let root: HTMLElement;

	beforeEach( () => {
		root = document.createElement( 'div' );
		document.body.appendChild( root );
	} );
	afterEach( () => root.remove() );

	test( 'sets the element id to the computed auto-id when none is present', () => {
		root.innerHTML = `
			<div id="wp-window-posts">
				<div class="probe" label="Title"></div>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		expect( probe.id ).toBe( '' );
		const id = ensureAutoId( probe );
		expect( id ).toBe( 'os-posts-title' );
		expect( probe.id ).toBe( 'os-posts-title' );
	} );

	test( 'preserves an explicit id the caller set', () => {
		root.innerHTML = `
			<div id="wp-window-posts">
				<div id="my-custom-id" class="probe" label="Title"></div>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		const id = ensureAutoId( probe );
		expect( id ).toBe( 'my-custom-id' );
		expect( probe.id ).toBe( 'my-custom-id' );
	} );

	test( 'is idempotent — calling twice yields the same id without changes', () => {
		root.innerHTML = `
			<div id="wp-window-posts">
				<div class="probe" label="Title"></div>
			</div>
		`;
		const probe = root.querySelector( '.probe' ) as HTMLElement;
		ensureAutoId( probe );
		const idAfterFirst = probe.id;
		ensureAutoId( probe );
		expect( probe.id ).toBe( idAfterFirst );
	} );
} );
