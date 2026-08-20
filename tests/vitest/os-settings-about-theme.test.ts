/**
 * The About journal is normal shell UI, not fixed-colour artwork.
 *
 * A previous version layered hardcoded dark RGBA values over a mesh and then
 * forced white text on top. That happened to suit the default palette, but it
 * stayed dark when a desktop theme changed every surrounding surface. Keep
 * the featured dispatch on the public theme-token path so it changes with the
 * rest of OpenStation Preferences.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join( __dirname, '../..' );
const css = readFileSync( join( root, 'assets/css/os-settings.css' ), 'utf8' );
const aboutStart = css.indexOf( '/*\n * About tab' );
const aboutEnd = css.indexOf( '/* Apps & Icons section', aboutStart );
const aboutCss = css.slice( aboutStart, aboutEnd );

describe( 'OS Settings — About theme contract', () => {
	test( 'keeps the featured dispatch on theme-owned surfaces and text', () => {
		expect( aboutStart ).toBeGreaterThanOrEqual( 0 );
		expect( aboutEnd ).toBeGreaterThan( aboutStart );
		expect( aboutCss ).toContain( 'var(\n\t\t\t--os-ui-hero-mesh' );
		expect( aboutCss ).toContain(
			'var( --os-ui-surface-sunken, #f0f0f1 )',
		);
		expect( aboutCss ).toContain( 'color: var( --os-ui-fg, #1d2327 )' );
		expect( aboutCss ).toContain(
			'color: var( --os-ui-fg-muted, #50575e )',
		);
	} );

	test( 'does not bypass theme substitutions with a raw brand mesh or ink', () => {
		expect( aboutCss ).not.toContain( '--os-mesh-' );
		expect( aboutCss ).not.toMatch( /color:\s*#[0-9a-f]{3,8}\b/i );
		expect( aboutCss ).not.toMatch(
			/color:\s*rgba?\(\s*255\s*,\s*255\s*,\s*255/i,
		);
	} );
} );
