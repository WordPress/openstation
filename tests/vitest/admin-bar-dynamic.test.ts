import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve( __dirname, '../..' );
const CSS = readFileSync( resolve( ROOT, 'assets/css/desktop.css' ), 'utf8' );

interface Rule {
	selector: string;
	body: string;
}

function rules( css: string ): Rule[] {
	const stripped = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	const out: Rule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	while ( ( m = re.exec( stripped ) ) ) {
		out.push( {
			selector: m[ 1 ].replace( /\s+/g, ' ' ).trim(),
			body: m[ 2 ].replace( /\s+/g, ' ' ).trim(),
		} );
	}
	return out;
}

const BAR_RULES = rules( CSS ).filter(
	( r ) =>
		r.selector.includes( 'os-admin-bar-dynamic' ) &&
		/#wpadminbar(?![\w-])/.test( r.selector ) &&
		! r.selector.includes( '::' ) &&
		! r.selector.includes( '.os-shell' ),
);

const CONTAINING_BLOCK_MAKERS = [
	'transform',
	'translate',
	'rotate',
	'scale',
	'filter',
	'backdrop-filter',
	'perspective',
	'contain',
	'will-change',
];

describe( 'dynamic admin bar — never a containing block', () => {
	test( 'the dynamic-mode bar rules exist', () => {
		expect( BAR_RULES.length ).toBeGreaterThanOrEqual( 2 );
	} );

	test.each( CONTAINING_BLOCK_MAKERS )(
		'no dynamic-mode bar rule declares `%s`',
		( prop ) => {
			const re = new RegExp( `(^|[;\\s])${ prop }\\s*:`, 'i' );
			for ( const r of BAR_RULES ) {
				expect(
					re.test( r.body ),
					`\`${ r.selector }\` declares \`${ prop }\` — a transformed bar is the containing block for the fixed-positioned panels inside it (the wpcom notifications panel collapses to 0px). Park the bar with inset-block-start instead.`,
				).toBe( false );
			}
		},
	);

	test( 'the parked bar moves by inset-block-start, and outranks the visibility pin', () => {
		const parked = BAR_RULES.find(
			( r ) => r.selector === 'body.os-active.os-admin-bar-dynamic #wpadminbar',
		);
		expect( parked ).toBeDefined();

		expect( parked!.body ).toMatch( /inset-block-start\s*:[^;]*!important/ );
		expect( parked!.body ).toMatch( /--os-admin-bar-peek/ );
		expect( parked!.body ).toMatch( /--wp-admin--admin-bar--height/ );
		expect( parked!.body ).toMatch( /transition\s*:\s*inset-block-start/ );
	} );

	test( 'the reveal zone waits for the slide before it changes size', () => {

		const all = rules( CSS );
		const parked = all.find(
			( r ) => r.selector === 'body.os-active.os-admin-bar-dynamic #wpadminbar',
		);
		expect( parked!.body ).toMatch( /--os-admin-bar-slide\s*:\s*\d+ms/ );
		expect( parked!.body ).toMatch(
			/transition\s*:\s*inset-block-start\s+var\(\s*--os-admin-bar-slide/,
		);
		const zone = all.find(
			( r ) =>
				r.selector === 'body.os-active.os-admin-bar-dynamic #wpadminbar::after',
		);
		expect( zone ).toBeDefined();
		expect( zone!.body ).toMatch(
			/transition\s*:\s*height\s+0s\s+linear\s+var\(\s*--os-admin-bar-slide/,
		);

		const collapse = all.find(
			( r ) =>
				r.selector.includes( '#wpadminbar:hover::after' ) &&
				r.selector.includes( '#wpadminbar:focus-within::after' ),
		);
		expect( collapse ).toBeDefined();
		expect( collapse!.body ).toMatch( /height\s*:\s*0/ );
		expect( collapse!.body ).not.toMatch( /transition/ );
	} );

	test( 'the revealed bar returns to the top edge, also with !important', () => {
		const revealed = BAR_RULES.find(
			( r ) =>
				r.selector.includes( '#wpadminbar:hover' ) &&
				r.selector.includes( '#wpadminbar:focus-within' ),
		);
		expect( revealed ).toBeDefined();
		expect( revealed!.body ).toMatch( /inset-block-start\s*:\s*0\s*!important/ );
	} );
} );
