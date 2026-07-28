/**
 * `<wpd-relative-time>` — smoke tests. Covers the two input formats,
 * the semantic `<time>` output with its absolute-time tooltip, and the
 * `compact` form used by dense lists.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-relative-time';

const tick = (): Promise< void > => Promise.resolve();

/** Minutes ago, as a MySQL-style UTC string (what `*_gmt` returns). */
function mysqlMinutesAgo( minutes: number ): string {
	const d = new Date( Date.now() - minutes * 60_000 );
	return d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
}

describe( '<wpd-relative-time>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a semantic <time> carrying the absolute value in title', async () => {
		const iso = new Date( Date.now() - 5 * 60_000 ).toISOString();
		host.innerHTML = `<wpd-relative-time datetime="${ iso }"></wpd-relative-time>`;
		await tick();
		const time = host
			.querySelector( 'wpd-relative-time' )!
			.shadowRoot!.querySelector( 'time' )!;
		expect( time ).not.toBeNull();
		expect( time.getAttribute( 'datetime' ) ).toBe( iso );
		expect( time.getAttribute( 'title' ) ).toBeTruthy();
	} );

	test( 'treats a MySQL-style datetime as UTC', async () => {
		// A bare "Y-m-d H:i:s" would otherwise be parsed as local time,
		// putting the reading hours off for anyone outside UTC.
		host.innerHTML = `<wpd-relative-time datetime="${ mysqlMinutesAgo(
			5,
		) }"></wpd-relative-time>`;
		await tick();
		const text = host.querySelector( 'wpd-relative-time' )!.shadowRoot!
			.textContent!;
		expect( text ).toMatch( /5/ );
	} );

	test( 'compact renders a shorter string than the long form', async () => {
		const stamp = mysqlMinutesAgo( 5 );
		host.innerHTML =
			`<wpd-relative-time datetime="${ stamp }"></wpd-relative-time>` +
			`<wpd-relative-time datetime="${ stamp }" compact></wpd-relative-time>`;
		await tick();
		const [ long, short ] = Array.from(
			host.querySelectorAll( 'wpd-relative-time' ),
		).map( ( el ) => el.shadowRoot!.textContent!.trim() );
		expect( short.length ).toBeLessThan( long.length );
		// Still anchored to the same moment.
		expect( short ).toMatch( /5/ );
	} );

	test( 'compact falls back to a short date past a week', async () => {
		const stamp = mysqlMinutesAgo( 30 * 24 * 60 );
		host.innerHTML = `<wpd-relative-time datetime="${ stamp }" compact></wpd-relative-time>`;
		await tick();
		const text = host.querySelector( 'wpd-relative-time' )!.shadowRoot!
			.textContent!;
		// A date, not a relative reading — no "ago"/"month" wording.
		expect( text ).not.toMatch( /ago/i );
		expect( text.trim().length ).toBeGreaterThan( 0 );
	} );

	test( 'shows an unparseable value verbatim rather than blank', async () => {
		host.innerHTML = `<wpd-relative-time datetime="not-a-date"></wpd-relative-time>`;
		await tick();
		const text = host.querySelector( 'wpd-relative-time' )!.shadowRoot!
			.textContent!;
		expect( text ).toContain( 'not-a-date' );
	} );
} );
