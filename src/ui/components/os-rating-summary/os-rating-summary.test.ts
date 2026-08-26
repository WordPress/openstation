/**
 * `<os-rating-summary>` — smoke tests. Cover bucket-count rendering,
 * total auto-sum, rating → stars conversion, and the per-row ratio
 * variable wired up for the animated fill.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-rating-summary';
import type { OsRatingSummary } from './os-rating-summary';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-rating-summary>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders five histogram rows, one per star bucket', async () => {
		host.innerHTML = '<os-rating-summary rating="80"></os-rating-summary>';
		const el = host.querySelector( 'os-rating-summary' ) as OsRatingSummary;
		el.ratings = { 5: 4, 4: 1, 3: 0, 2: 0, 1: 0 };
		await tick();
		const rows = el.shadowRoot!.querySelectorAll( '.row' );
		expect( rows.length ).toBe( 5 );
	} );

	test( 'auto-sums total when the attribute is omitted', async () => {
		host.innerHTML = '<os-rating-summary rating="80"></os-rating-summary>';
		const el = host.querySelector( 'os-rating-summary' ) as OsRatingSummary;
		el.ratings = { 5: 4, 4: 1 };
		await tick();
		const total = el.shadowRoot!.querySelector( '.total' )!.textContent ?? '';
		expect( total ).toContain( '5' );
		expect( total ).toContain( 'rating' );
	} );

	test( 'big number reflects the 0–100 → 0–5 conversion', async () => {
		host.innerHTML = '<os-rating-summary rating="100"></os-rating-summary>';
		const el = host.querySelector( 'os-rating-summary' ) as OsRatingSummary;
		await tick();
		const big = el.shadowRoot!.querySelector( '.big' )!.textContent ?? '';
		expect( big.trim() ).toBe( '5.0' );
	} );

	test( 'top row gets a 1.0 ratio fill when all ratings are 5★', async () => {
		host.innerHTML = '<os-rating-summary rating="100"></os-rating-summary>';
		const el = host.querySelector( 'os-rating-summary' ) as OsRatingSummary;
		el.ratings = { 5: 10 };
		await tick();
		const firstFill = el.shadowRoot!.querySelector(
			'.row .row__fill',
		) as HTMLElement;
		expect( firstFill.style.getPropertyValue( '--ratio' ) ).toMatch(
			/^1(\.0+)?$/,
		);
	} );

	test( 'zero-rating state stays renderable', async () => {
		host.innerHTML = '<os-rating-summary></os-rating-summary>';
		const el = host.querySelector( 'os-rating-summary' ) as OsRatingSummary;
		await tick();
		const big = el.shadowRoot!.querySelector( '.big' )!.textContent ?? '';
		expect( big.trim() ).toBe( '—' );
		const total = el.shadowRoot!.querySelector( '.total' )!.textContent ?? '';
		expect( total ).toContain( '0' );
	} );
} );
