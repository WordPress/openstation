/**
 * The phone layer's fit inside a phone — the stylesheet contract.
 *
 * Pins what an installed app on a phone depends on and a refactor
 * would not notice breaking:
 *
 * - the tab bar is anchored to the viewport's bottom edge, not laid
 *   out as the shell's last child, and the shell's body keeps its
 *   footprint clear;
 * - the document does not zoom: `touch-action: pan-x pan-y` on the
 *   root, and every kit field at 16px (the size under which iOS
 *   zooms the page into a focused control);
 * - the admin-bar height token is 0 on a phone;
 * - every `--_m-*` colour alias reads a palette token, and every
 *   `--os-mobile-*` token it reads is declared in `variables.css`;
 * - the kit fields read the sizing tokens the phone layer sets;
 * - Trash and WP Explorer fold under a narrow container.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join( __dirname, '../..' );
const read = ( rel: string ): string => readFileSync( join( ROOT, rel ), 'utf8' );

const mobile = read( 'assets/css/mobile.css' );
const variables = read( 'assets/css/variables.css' );

/** The declarations of one rule, by a unique selector fragment. */
function block( css: string, selector: string ): string {
	const at = css.indexOf( selector );
	expect( at, `rule for ${ selector }` ).toBeGreaterThan( -1 );
	const open = css.indexOf( '{', at );
	const close = css.indexOf( '}', open );
	return css.slice( open + 1, close );
}

/** The declarations of the rule a unique declaration fragment sits in. */
function blockAround( css: string, declaration: string ): string {
	const at = css.indexOf( declaration );
	expect( at, `declaration ${ declaration }` ).toBeGreaterThan( -1 );
	const open = css.lastIndexOf( '{', at );
	const close = css.indexOf( '}', at );
	return css.slice( open + 1, close );
}

describe( 'the tab bar hugs the bottom edge', () => {
	const tabs = block( mobile, 'html[data-os-mode="mobile"] .os-mobile-tabs {' );

	test( 'is fixed to the viewport, under the home indicator', () => {
		expect( tabs ).toMatch( /position:\s*fixed/ );
		expect( tabs ).toMatch( /inset-block-end:\s*0/ );
		expect( tabs ).toMatch( /inset-inline:\s*0/ );
		expect( tabs ).toMatch( /padding-block-end:\s*var\(\s*--_m-safe-bottom\s*\)/ );
	} );

	test( "the shell's body keeps the bar's footprint clear", () => {
		const body = block( mobile, 'html[data-os-mode="mobile"] .os-shell__body {' );
		expect( body ).toMatch( /padding-block-end:\s*var\(\s*--_m-tabs-total\s*\)/ );
		expect( mobile ).toMatch(
			/--_m-tabs-total:\s*calc\(\s*var\(\s*--_m-tabs-h\s*\)\s*\+\s*8px\s*\+\s*var\(\s*--_m-safe-bottom\s*\)\s*\)/,
		);
	} );
} );

describe( 'the phone does not zoom', () => {
	test( 'the root hands the browser nothing but scroll', () => {
		const root = block( mobile, 'html[data-os-mode="mobile"],\nhtml[data-os-mode="mobile"] body {' );
		expect( root ).toMatch( /touch-action:\s*pan-x pan-y/ );
		expect( root ).toMatch( /overscroll-behavior:\s*none/ );
	} );

	test( 'every kit field is 16px on the phone', () => {
		expect( mobile ).toMatch( /--os-ui-field-font-size:\s*16px/ );
		expect( mobile ).toMatch( /--os-ui-field-font-size-compact:\s*16px/ );
	} );

	test( 'the kit fields read the sizing tokens', () => {
		for ( const [ file, token ] of [
			[ 'src/ui/components/os-text-field/os-text-field.styles.ts', '--os-ui-field-font-size' ],
			[ 'src/ui/components/os-textarea/os-textarea.styles.ts', '--os-ui-field-font-size' ],
			[ 'src/ui/components/os-tag-input/os-tag-input.styles.ts', '--os-ui-field-font-size-compact' ],
			[
				'src/ui/components/os-category-picker/os-category-picker.styles.ts',
				'--os-ui-field-font-size-compact',
			],
		] ) {
			expect( read( file ), file ).toContain( `var( ${ token }` );
		}
		expect( read( 'src/ui/components/os-text-field/os-text-field.styles.ts' ) ).toContain(
			'var( --os-ui-field-radius',
		);
	} );

	test( 'the palette owns the sizing defaults', () => {
		expect( variables ).toMatch( /--os-ui-field-font-size:\s*13px/ );
		expect( variables ).toMatch( /--os-ui-field-font-size-compact:\s*12px/ );
		expect( variables ).toMatch( /--os-ui-field-radius:\s*6px/ );
	} );

	test( 'the viewport meta and the guard say the same', () => {
		expect( read( 'includes/mobile.php' ) ).toContain( 'maximum-scale=1' );
		expect( read( 'includes/mobile.php' ) ).toContain( 'user-scalable=no' );
		expect( read( 'src/desktop.ts' ) ).toContain( 'installZoomGuard()' );
	} );
} );

describe( 'the shell starts at the top edge', () => {
	test( 'the admin-bar height token is 0 on a phone', () => {
		const shell = block( mobile, 'html[data-os-mode="mobile"] .os-shell {\n\tinset-block-start: 0;' );
		expect( shell ).toMatch( /--wp-admin--admin-bar--height:\s*0px/ );
	} );

	test( 'the head stamp writes the display too', () => {
		expect( read( 'includes/mobile.php' ) ).toContain( 'setAttribute("data-os-display",d)' );
	} );
} );

describe( 'the phone wears the palette', () => {
	const tokens = blockAround( mobile, '--_m-surface: var( --os-backstop' );

	test( 'every colour alias reads a palette token', () => {
		const lines = tokens
			.split( '\n' )
			.map( ( l ) => l.trim() )
			.filter( ( l ) => l.startsWith( '--_m-' ) && /rgba?\(|#[0-9a-f]{3,8}\b/i.test( l ) );
		expect( lines.length ).toBeGreaterThan( 8 );
		for ( const line of lines ) {
			expect( line, line ).toMatch( /var\(\s*--os-/ );
		}
	} );

	test( 'every --os-mobile-* token it reads is declared in variables.css', () => {
		// The alias block alone: `--os-mobile-back-progress` and
		// `--os-mobile-card-dir` elsewhere in the sheet are gesture
		// state the layer writes, not palette tokens.
		const wanted = new Set( tokens.match( /--os-mobile-[a-z-]+/g ) ?? [] );
		expect( wanted.size ).toBeGreaterThan( 5 );
		for ( const name of wanted ) {
			expect( variables, name ).toMatch( new RegExp( `${ name }:` ) );
		}
	} );

	test( 'no shadow or scrim is a bare literal outside the alias block', () => {
		const rest = mobile.replace( tokens, '' );
		const literalShadows = rest.match( /box-shadow:[^;]*rgba\(/g ) ?? [];
		expect( literalShadows ).toEqual( [] );
		const literalTextShadows = rest.match( /text-shadow:[^;]*rgba\(/g ) ?? [];
		expect( literalTextShadows ).toEqual( [] );
	} );
} );

describe( 'the apps fold under a narrow container', () => {
	test( "Trash's toolbar takes three rows", () => {
		const css = read( 'assets/css/recycle-bin.css' );
		expect( css ).toMatch( /@container\s*\(\s*max-width:\s*560px\s*\)/ );
		const narrow = css.slice( css.indexOf( '@container' ) );
		expect( narrow ).toMatch( /\.os-recycle-bin__toolbar-left os-segmented \{[^}]*overflow-x:\s*auto/ );
		expect( narrow ).toMatch( /\.os-recycle-bin__toolbar-trailing \{[^}]*margin-inline-start:\s*0/ );
	} );

	test( "WP Explorer's preview becomes a sheet at the bottom, only while something is selected", () => {
		const css = read( 'apps/my-wordpress/my-wordpress.css' );
		expect( css ).toMatch( /@container\s*\(\s*max-width:\s*640px\s*\)/ );
		const narrow = css.slice( css.indexOf( '@container ( max-width: 640px )' ) );
		expect( narrow ).toMatch( /\.os-mywp__split \{[^}]*grid-template-rows:\s*minmax\(\s*0,\s*1fr\s*\)\s*auto/ );
		expect( narrow ).toMatch( /\.os-mywp__detail-pane \{[^}]*max-block-size:\s*45%/ );
		expect( narrow ).toMatch( /\.os-mywp__detail-pane:has\(\s*>\s*\.os-mywp__pane-empty\s*\)\s*\{[^}]*display:\s*none/ );
	} );
} );

describe( 'drag and drop is off on a phone', () => {
	test( 'the DragManager, the dock reorder and the file drop refuse the phone', () => {
		expect( read( 'src/drag/manager.ts' ) ).toMatch( /if \( isMobileStamped\(\) \) \{\s*return null;/ );
		expect( read( 'src/dock.ts' ) ).toMatch( /ev\.button !== 0 \|\| isMobileStamped\(\)/ );
		expect( read( 'src/os-file-drop/sentinel.ts' ) ).toMatch( /! args\.bundleUrl \|\| isMobileStamped\(\)/ );
		expect( read( 'src/os-file-drop/manager.ts' ) ).toMatch( /! opts\.config\.enabled \|\| isMobileStamped\(\)/ );
		const wire = read( 'apps/my-wordpress/parts/wire.ts' );
		expect( wire ).toMatch( /if \( ! isMobileStamped\(\) \) \{\s*teardowns\.push\(\s*createMarquee/ );
		expect( ( wire.match( /\|\| isMobileStamped\(\)/g ) ?? [] ).length ).toBe( 2 );
	} );
} );
