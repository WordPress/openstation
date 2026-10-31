/**
 * The chromeless offset neutralizer, run against a real DOM.
 *
 * It lives in an inline script built from `$js .=` strings in
 * `chromeless-bridge.php`, in a document PHPUnit never loads, so the
 * suite can only check that it is wired. This reads those strings back
 * out of the PHP function, so the script under test is the one the
 * page gets, and asserts the one thing that matters: an admin-bar
 * `top` is zeroed everywhere except inside Core's modal overlay, where
 * a `top` of 32px is the modal's own layout.
 */
import { describe, expect, test, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The script `openstation_chromeless_offset_neutralizer_script()` prints. */
function emittedNeutralizerScript(): string {
	const php = readFileSync(
		resolve( __dirname, '../../includes/render/chromeless-bridge.php' ),
		'utf8'
	);
	const start = php.indexOf(
		'function openstation_chromeless_offset_neutralizer_script()'
	);
	const end = php.indexOf( 'wp_print_inline_script_tag( $js )', start );
	const body = php.slice( start, end );
	const literal = "('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\")";
	const pieces = [
		...body.matchAll( new RegExp( `^\\t\\$js\\s*\\.?=\\s*${ literal };`, 'gm' ) ),
	].map( ( m ) => ( 0, eval )( m[ 1 ] ) as string );
	// The last piece is `'})(' . $config . ');'`, which the pattern
	// above does not match: add its two literals around the config.
	return (
		pieces.join( '' ) +
		'})(' +
		JSON.stringify( { tops: [ '32px', '46px' ] } ) +
		');'
	);
}

beforeAll( () => {
	document.body.className = 'os-chromeless';
	document.body.innerHTML = `
		<div id="outside" style="position:absolute;top:32px"></div>
		<div class="components-modal__screen-overlay" style="position:fixed;top:0">
			<div id="inside" style="position:absolute;top:32px"></div>
		</div>`;
	// eslint-disable-next-line no-eval -- the point is to exercise the
	// emitted source rather than a re-implementation of it.
	( 0, eval )( emittedNeutralizerScript() );
} );

describe( 'chromeless offset neutralizer', () => {
	test( 'zeroes an admin-bar top outside the modal overlay', () => {
		const el = document.getElementById( 'outside' ) as HTMLElement;
		expect( el.style.getPropertyValue( 'top' ) ).toBe( '0px' );
		expect( el.style.getPropertyPriority( 'top' ) ).toBe( 'important' );
	} );

	test( 'leaves an element inside the modal overlay alone', () => {
		const el = document.getElementById( 'inside' ) as HTMLElement;
		expect( el.style.getPropertyValue( 'top' ) ).toBe( '32px' );
	} );
} );
