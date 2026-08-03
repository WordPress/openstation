/**
 * Every component's help example must actually show something.
 *
 * The Components tab in OS Settings is the kit's shop window, and a
 * whole class of its examples rendered blank without anyone noticing —
 * because a blank example is not an error, it is an empty `<div>`.
 * Three separate causes, all of them silent:
 *
 *   1. **`<script>` in the template.** `<os-crumb-chain>` set its
 *      `segments` from an inline script. `html``` compiles by
 *      assigning to a `<template>`'s `innerHTML`; the HTML
 *      fragment-parsing algorithm sets a parsed script's *already
 *      started* flag, and the cloning steps copy it. The script was
 *      inert in the template and inert in every clone — it could
 *      never have run.
 *   2. **Property-driven components with no data.** `segments`,
 *      `data`, `columns`, `entries`, `ratings` and `items` are JS
 *      properties, not attributes, so no markup can fill them.
 *      `<os-table>` and `<os-log>` rendered their empty states, and
 *      the two vestigial `id="sample-table"` / `id="sample-log"`
 *      attributes are the fossil of a script that was meant to
 *      populate them.
 *   3. **No example at all.** Twelve classes had `static help`
 *      without an `example` — including every overlay, which is
 *      `display: none` until opened and so needs a trigger to
 *      demonstrate at all, and every child component, which has no
 *      shape outside its parent.
 *
 * This pins all three. It is deliberately a source scan rather than a
 * render: jsdom has no layout, so "did this paint anything" is not a
 * question it can answer — but "did the author give it something to
 * paint" is, and that is the failure that actually shipped.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const COMPONENTS = resolve( ROOT, 'src/ui/components' );

/** Every component source file, paired with its text. */
const files = readdirSync( COMPONENTS, { withFileTypes: true } )
	.filter( ( e ) => e.isDirectory() )
	.map( ( dir ) => {
		const path = resolve( COMPONENTS, dir.name, `${ dir.name }.ts` );
		try {
			return [ dir.name, readFileSync( path, 'utf8' ) ] as const;
		} catch {
			return null;
		}
	} )
	.filter( ( e ): e is readonly [ string, string ] => e !== null );

/**
 * The `defineComponent( 'tag', Class )` calls in a file, so a file
 * defining three components is checked as three components.
 */
function tagsIn( src: string ): string[] {
	return Array.from( src.matchAll( /defineComponent\(\s*'([^']+)'/g ) ).map(
		( m ) => m[ 1 ],
	);
}

describe( 'help examples', () => {
	test( 'the component sweep found sources to check', () => {
		expect( files.length ).toBeGreaterThan( 40 );
	} );

	test.each( files )( '%s declares an example for every class', ( name, src ) => {
		const classes = ( src.match( /static help = \{/g ) ?? [] ).length;
		const examples = ( src.match( /\bexample: html`/g ) ?? [] ).length;

		expect(
			examples,
			`${ name } defines ${ classes } help descriptor(s) but ${ examples } example(s). ` +
				`Tags in this file: ${ tagsIn( src ).join( ', ' ) }. ` +
				'Every class with `static help` needs its own `example`, including ' +
				'child components — the Components tab lists them separately, and a ' +
				'child shown outside its parent has no shape. Use the parent in ' +
				'miniature.',
		).toBe( classes );
	} );

	test.each( files )( '%s puts no <script> in an example', ( name, src ) => {
		// Only inside the css/html template — a <script> in a JSDoc
		// fence is prose and is fine.
		const inExample = src
			.split( 'example: html`' )
			.slice( 1 )
			.some( ( chunk ) => chunk.slice( 0, chunk.indexOf( '`' ) ).includes( '<script' ) );

		expect(
			inExample,
			`${ name } has a <script> inside a help example. It can never run: the ` +
				'template is compiled through innerHTML, which flags parsed scripts as ' +
				'already-started, and cloning copies the flag. Use `exampleInit` instead.',
		).toBe( false );
	} );

	/**
	 * Components whose data arrives through a property. Each needs an
	 * `exampleInit` or its example is a documented empty state.
	 */
	const PROPERTY_DRIVEN = [
		[ 'os-crumb-chain', 'segments' ],
		[ 'os-table', 'columns' ],
		[ 'os-log', 'entries' ],
		[ 'os-category-picker', 'items' ],
		[ 'os-rating-summary', 'ratings' ],
	] as const;

	test.each( PROPERTY_DRIVEN )(
		'%s fills its example through exampleInit',
		( name, prop ) => {
			const src = files.find( ( [ n ] ) => n === name )?.[ 1 ] ?? '';
			expect( src, `${ name } source not found` ).not.toBe( '' );
			expect(
				src.includes( 'exampleInit:' ),
				`${ name } takes its data through the \`${ prop }\` property, which no ` +
					'markup can set — without exampleInit its example renders as an ' +
					'empty shell.',
			).toBe( true );
		},
	);

	/**
	 * Overlays are `display: none` until opened, so an example that
	 * only mounts one shows nothing at all. Each needs a trigger.
	 */
	test.each( [ 'os-modal', 'os-confirm-dialog' ] )(
		'%s ships a trigger, not just a mounted overlay',
		( name ) => {
			const src = files.find( ( [ n ] ) => n === name )?.[ 1 ] ?? '';
			expect( src ).toContain( 'data-demo' );
			expect( src ).toContain( 'exampleInit:' );
		},
	);

	test( 'exampleInit wires listeners by assignment, never by accumulation', () => {
		// The help panel repaints on every keystroke in its filter box
		// and re-runs exampleInit against the same nodes. addEventListener
		// would stack one listener per keystroke; `onclick =` replaces.
		for ( const [ name, src ] of files ) {
			if ( ! src.includes( 'exampleInit:' ) ) {
				continue;
			}
			// From the hook to the end of the help descriptor, with
			// comments stripped — every one of these files EXPLAINS in
			// prose why it does not use addEventListener, and a scan
			// that read the explanation as the offence would fail on
			// exactly the files that got it right.
			const init = src.slice( src.indexOf( 'exampleInit:' ) );
			const body = init
				.slice( 0, init.indexOf( '\n\t} as const;' ) )
				.replace( /\/\*[\s\S]*?\*\//g, '' )
				.replace( /\/\/[^\n]*/g, '' );
			expect(
				body.includes( 'addEventListener' ),
				`${ name }'s exampleInit calls addEventListener. The panel re-runs it ` +
					'on every repaint, so listeners accumulate — assign to `onclick` ' +
					'instead, which replaces.',
			).toBe( false );
		}
	} );
} );
