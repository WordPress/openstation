import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-relative-time';

const tick = (): Promise< void > => Promise.resolve();

function mysqlMinutesAgo( minutes: number ): string {
	const d = new Date( Date.now() - minutes * 60_000 );
	return d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
}

describe( '<os-relative-time>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a semantic <time> carrying the absolute value in title', async () => {
		const iso = new Date( Date.now() - 5 * 60_000 ).toISOString();
		host.innerHTML = `<os-relative-time datetime="${ iso }"></os-relative-time>`;
		await tick();
		const time = host
			.querySelector( 'os-relative-time' )!
			.shadowRoot!.querySelector( 'time' )!;
		expect( time ).not.toBeNull();
		expect( time.getAttribute( 'datetime' ) ).toBe( iso );
		expect( time.getAttribute( 'title' ) ).toBeTruthy();
	} );

	test( 'treats a MySQL-style datetime as UTC', async () => {
		host.innerHTML = `<os-relative-time datetime="${ mysqlMinutesAgo(
			5,
		) }"></os-relative-time>`;
		await tick();
		const text = host.querySelector( 'os-relative-time' )!.shadowRoot!
			.textContent!;
		expect( text ).toMatch( /5/ );
	} );

	test( 'treats a bare ISO datetime (wp/v2 date_gmt) as UTC', async () => {
		const gmt = new Date( Date.now() - 60 * 60_000 )
			.toISOString()
			.slice( 0, 19 );
		host.innerHTML = `<os-relative-time datetime="${ gmt }"></os-relative-time>`;
		await tick();
		const time = host
			.querySelector( 'os-relative-time' )!
			.shadowRoot!.querySelector( 'time' )!;

		expect( time.getAttribute( 'datetime' ) ).toBe( gmt + '.000Z' );
	} );

	test( 'honours an explicit numeric offset', async () => {
		host.innerHTML =
			'<os-relative-time datetime="2026-04-28T15:00:00+02:00"></os-relative-time>';
		await tick();
		const time = host
			.querySelector( 'os-relative-time' )!
			.shadowRoot!.querySelector( 'time' )!;
		expect( time.getAttribute( 'datetime' ) ).toBe(
			'2026-04-28T13:00:00.000Z',
		);
	} );

	test( 'a date-only value is not mistaken for an offset', async () => {
		host.innerHTML =
			'<os-relative-time datetime="2026-04-28"></os-relative-time>';
		await tick();
		const time = host
			.querySelector( 'os-relative-time' )!
			.shadowRoot!.querySelector( 'time' )!;
		expect( time.getAttribute( 'datetime' ) ).toBe(
			'2026-04-28T00:00:00.000Z',
		);
	} );

	test( 'compact renders a shorter string than the long form', async () => {
		const stamp = mysqlMinutesAgo( 5 );
		host.innerHTML =
			`<os-relative-time datetime="${ stamp }"></os-relative-time>` +
			`<os-relative-time datetime="${ stamp }" compact></os-relative-time>`;
		await tick();
		const [ long, short ] = Array.from(
			host.querySelectorAll( 'os-relative-time' ),
		).map( ( el ) => el.shadowRoot!.textContent!.trim() );
		expect( short.length ).toBeLessThan( long.length );

		expect( short ).toMatch( /5/ );
	} );

	test( 'compact falls back to a short date past a week', async () => {
		const stamp = mysqlMinutesAgo( 30 * 24 * 60 );
		host.innerHTML = `<os-relative-time datetime="${ stamp }" compact></os-relative-time>`;
		await tick();
		const text = host.querySelector( 'os-relative-time' )!.shadowRoot!
			.textContent!;

		expect( text ).not.toMatch( /ago/i );
		expect( text.trim().length ).toBeGreaterThan( 0 );
	} );

	test( 'shows an unparseable value verbatim rather than blank', async () => {
		host.innerHTML = `<os-relative-time datetime="not-a-date"></os-relative-time>`;
		await tick();
		const text = host.querySelector( 'os-relative-time' )!.shadowRoot!
			.textContent!;
		expect( text ).toContain( 'not-a-date' );
	} );
} );
