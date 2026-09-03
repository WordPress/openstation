/**
 * The native list windows on a phone — the stylesheet contract.
 *
 * Pins what the phone layouts of Trash, Posts / Pages / Users,
 * Plugins and WP Explorer depend on and a refactor would not notice
 * breaking:
 *
 * - the card layout the lists wear (`<os-table stacked>`) is a block
 *   layout with no header and nothing pinned;
 * - Trash's table can scroll sideways in a narrow desk window (the
 *   flex minimum that clipped it is 0);
 * - each list's selection actions become a bar along the bottom on a
 *   phone, clearing the home indicator, with its buttons sharing the
 *   width;
 * - WP Explorer's item page fills the body and stacks its actions.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { styles } from '../../src/ui/components/os-table/os-table.styles';

const ROOT = join( __dirname, '../..' );
const read = ( rel: string ): string => readFileSync( join( ROOT, rel ), 'utf8' );

const table = String( ( styles as unknown as { cssText?: string } ).cssText ?? styles );
const bin = read( 'assets/css/recycle-bin.css' );
const posts = read( 'assets/css/posts-window.css' );
const plugins = read( 'assets/css/plugins-window.css' );
const explorer = read( 'apps/my-wordpress/my-wordpress.css' );

/** The declarations of one rule, by a unique selector fragment. */
function block( css: string, selector: string ): string {
	const at = css.indexOf( selector );
	expect( at, `rule for ${ selector }` ).toBeGreaterThan( -1 );
	const open = css.indexOf( '{', at );
	const close = css.indexOf( '}', open );
	return css.slice( open + 1, close );
}

describe( '<os-table stacked> is a card list', () => {
	test( 'every :host() argument is one compound selector', () => {
		// A space between two attribute selectors inside :host() makes
		// a descendant selector, which :host() rejects — and a rule
		// list with one invalid selector is dropped whole, silently.
		// That is how every card kept the grid's borders and stripes
		// on the first pass.
		expect( table ).not.toMatch( /:host\(\s*\[[^\]]*\]\s+\[/ );
	} );

	test( 'the cell chrome of the grid — border, stripe, hover, selection, column border — is undone for cards', () => {
		const list = table.slice(
			table.indexOf( ':host( [ stacked ] ) tbody td,' ),
			table.indexOf( '{', table.indexOf( ':host( [ stacked ] ) tbody td,' ) ),
		);
		expect( list ).toContain( ':host( [ stacked ][ striped ] ) tbody tr:nth-child( odd ) td' );
		expect( list ).toContain( ':host( [ stacked ][ hover ] ) tbody tr:hover td' );
		expect( list ).toContain( ':host( [ stacked ][ bordered ] ) tbody td' );
		expect( list ).toContain( ':host( [ stacked ] ) tbody tr.is-selected td' );
	} );

	test( 'the loading skeleton is a card too', () => {
		expect( block( table, ':host( [ stacked ] ) tr.skeleton {' ) ).toMatch( /padding:\s*14px/ );
	} );

	test( 'the header and the column widths are gone, the table is a block', () => {
		expect( block( table, ':host( [ stacked ] ) colgroup,' ) ).toMatch( /display:\s*none/ );
		expect( block( table, ':host( [ stacked ] ) table,' ) ).toMatch( /display:\s*block/ );
	} );

	test( 'a row is a flex line with the card inset, and its cells paint nothing of their own', () => {
		const row = block( table, ':host( [ stacked ] ) tbody tr {' );
		expect( row ).toMatch( /display:\s*flex/ );
		expect( row ).toMatch( /padding:\s*12px 14px/ );
		const cell = block( table, ':host( [ stacked ] ) tbody td,' );
		expect( cell ).toMatch( /display:\s*block/ );
		expect( cell ).toMatch( /background-color:\s*transparent/ );
	} );

	test( 'the checkbox cell is a 44px tap target', () => {
		const select = block( table, ':host( [ stacked ] ) tbody td.col-select {' );
		expect( select ).toMatch( /width:\s*44px/ );
		expect( select ).toMatch( /height:\s*44px/ );
	} );

	test( 'the title is the loudest line; a meta line carries its caption', () => {
		expect( block( table, '.stack-title {' ) ).toMatch( /font-weight:\s*600/ );
		expect( block( table, '.stack-label {' ) ).toMatch( /--os-ui-fg-muted/ );
	} );
} );

describe( 'Trash', () => {
	test( "the table's flex minimum is 0, so its own scroller is the one that scrolls sideways", () => {
		expect( block( bin, '.os-recycle-bin__body os-table {' ) ).toMatch( /min-inline-size:\s*0/ );
	} );

	test( 'the phone bar sits along the bottom, clears the home indicator, and shares the width between its buttons', () => {
		const bar = block( bin, '.os-recycle-bin__bulk {' );
		expect( bar ).toMatch( /display:\s*flex/ );
		expect( bar ).toMatch( /safe-area-inset-bottom/ );
		expect( bar ).toMatch( /border-block-start/ );
		expect( block( bin, '.os-recycle-bin__bulk os-button {' ) ).toMatch( /flex:\s*1 1 auto/ );
		expect( block( bin, '.os-recycle-bin__bulk[hidden] {' ) ).toMatch( /display:\s*none/ );
	} );

	test( 'on a phone the search leads the toolbar and the cards run edge to edge', () => {
		expect( block( bin, 'html[data-os-mode="mobile"] .os-recycle-bin__toolbar-left os-text-field {' ) ).toMatch( /order:\s*-1/ );
		expect( block( bin, 'html[data-os-mode="mobile"] .os-recycle-bin__body {' ) ).toMatch( /padding:\s*0/ );
	} );
} );

describe( 'Posts, Pages and Users', () => {
	test( 'the moved bulk strip is a bottom bar that clears the home indicator', () => {
		const bar = block( posts, '.os-posts__toolbar-right.os-posts__bulk--footer {' );
		expect( bar ).toMatch( /safe-area-inset-bottom/ );
		expect( bar ).toMatch( /border-block-start/ );
		expect( block( posts, '.os-posts__toolbar-right.os-posts__bulk--footer[hidden] {' ) ).toMatch( /display:\s*none/ );
		expect( block( posts, '.os-posts__toolbar-right.os-posts__bulk--footer .os-posts__bulk-actions > * {' ) ).toMatch( /flex:\s*1 1 auto/ );
	} );

	test( 'on a phone the cards run edge to edge', () => {
		expect( block( posts, 'html[data-os-mode="mobile"] .os-posts__body {' ) ).toMatch( /padding:\s*0/ );
	} );

	test( 'the Categories and Tags editors fold under the stage on a phone, and only while a term is focused', () => {
		expect( block( posts, 'html[data-os-mode="mobile"] .os-mindmap__layout,' ) ).toMatch( /flex-direction:\s*column/ );
		const sidebar = block( posts, 'html[data-os-mode="mobile"] .os-mindmap__sidebar,' );
		expect( sidebar ).toMatch( /max-block-size:\s*50%/ );
		expect( sidebar ).toMatch( /border-inline-start:\s*0/ );
		expect( sidebar ).toMatch( /safe-area-inset-bottom/ );
		expect(
			block( posts, 'html[data-os-mode="mobile"] .os-mindmap__sidebar:has( > .os-mindmap__sidebar-empty ),' ),
		).toMatch( /display:\s*none/ );
		expect( posts ).toContain( 'html[data-os-mode="mobile"] .os-tagcloud__sidebar:has( > .os-tagcloud__sidebar-empty )' );
	} );
} );

describe( 'Plugins', () => {
	test( 'the moved bulk strip is a bottom bar that clears the home indicator', () => {
		const bar = block( plugins, '.os-plugins__bulk.os-plugins__bulk--footer {' );
		expect( bar ).toMatch( /safe-area-inset-bottom/ );
		expect( bar ).toMatch( /border-block-start/ );
		expect( block( plugins, '.os-plugins__bulk.os-plugins__bulk--footer[hidden] {' ) ).toMatch( /display:\s*none/ );
		expect( block( plugins, '.os-plugins__bulk.os-plugins__bulk--footer os-button {' ) ).toMatch( /flex:\s*1 1 auto/ );
	} );

	test( 'on a phone the cards run edge to edge', () => {
		expect( block( plugins, 'html[data-os-mode="mobile"] .os-plugins__body {' ) ).toMatch( /padding:\s*0/ );
	} );
} );

describe( 'WP Explorer', () => {
	test( 'the item page fills the body and scrolls', () => {
		const page = block( explorer, '.os-mywp__detail-page {' );
		expect( page ).toMatch( /flex:\s*1 1 auto/ );
		expect( page ).toMatch( /overflow-y:\s*auto/ );
	} );

	test( 'its close control yields to Back, and its actions stack full width', () => {
		expect( block( explorer, '.os-mywp__detail-page .os-mywp__pane-close {' ) ).toMatch( /display:\s*none/ );
		expect( block( explorer, '.os-mywp__detail-page .os-mywp__actions {' ) ).toMatch( /flex-direction:\s*column/ );
		expect( block( explorer, '.os-mywp__detail-page .os-mywp__actions os-button {' ) ).toMatch( /inline-size:\s*100%/ );
	} );
} );
