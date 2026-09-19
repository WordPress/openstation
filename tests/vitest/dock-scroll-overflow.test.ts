/**
 * Tests for bottom dock scroll overflow styling.
 *
 * Pins down that `.os-dock[ data-os-dock-placement="bottom" ] .os-dock__scroll`
 * uses `justify-content: safe center` (with a `start` fallback) rather than
 * bare `justify-content: center`.
 *
 * Bare `justify-content: center` on an `overflow-x: auto` container pushes
 * overflowing items into negative coordinates (x < 0) before `scrollLeft = 0`,
 * making the first several icons permanently inaccessible and cut off (#839).
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe( 'bottom dock scroll overflow', () => {
	test( 'bottom dock scroll container uses safe center alignment', () => {
		const css = readFileSync( join( __dirname, '../../assets/css/dock.css' ), 'utf8' );

		// Extract the .os-dock[ data-os-dock-placement="bottom" ] .os-dock__scroll rule block
		const match = css.match(
			/\.os-dock\[\s*data-os-dock-placement="bottom"\s*\]\s+\.os-dock__scroll\s*\{([^}]+)\}/,
		);
		expect( match ).toBeTruthy();

		const block = match![ 1 ];

		// Must contain safe center and must NOT contain bare "justify-content: center;"
		expect( block ).toMatch( /justify-content:\s*safe center;/ );
		expect( block ).toMatch( /justify-content:\s*start;/ );
		expect( block ).not.toMatch( /justify-content:\s*center;/ );
	} );
} );
