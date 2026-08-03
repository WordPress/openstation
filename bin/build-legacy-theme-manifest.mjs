#!/usr/bin/env node
/**
 * The archaeology tool that produced the built-in "Legacy" desktop
 * theme's manifest. It is NOT part of any build.
 *
 *     node bin/build-legacy-theme-manifest.mjs                  # report drift
 *     node bin/build-legacy-theme-manifest.mjs --out <path>     # mint a new snapshot
 *
 * ## Legacy is frozen, and this script cannot unfreeze it
 *
 * `assets/desktop-themes/legacy/theme.json` is a **snapshot**, not a
 * generated artifact that tracks the code. Whoever picks Legacy is
 * asking for the look Desktop Mode had when the snapshot was taken,
 * and they keep it when the shell's own defaults move on — that is
 * the entire value of the theme, and it is why nothing regenerates
 * it: not the build, not CI, not a hook. Change a default tomorrow
 * and Legacy goes on saying what it says today.
 *
 * That is enforced here rather than merely asked for: there is no
 * flag that writes to the Legacy manifest, and pointing `--out` at it
 * is refused. A bare run reports how far today's defaults have drifted
 * from the snapshot and writes nothing.
 *
 * **A snapshot taken today captures the OpenStation palette**, not the
 * pre-brand one — `variables.css` declares the brand now, and this
 * script reads what is there. That is correct for minting a *new*
 * theme and catastrophic for Legacy, which is the other half of why
 * the path is refused.
 *
 * ## Where the numbers came from
 *
 * The defaults are not written down anywhere to be copied — they live
 * as `var( --token, <literal> )` fallbacks scattered across ~90
 * stylesheets and shadow-DOM style modules. This script reads them
 * out.
 *
 * ## How a default is decided
 *
 * For each `--desktop-mode-*` / `--wpd-*` name the tree mentions:
 *
 *   1. Declared in `:root` of `assets/css/variables.css` → that value.
 *   2. Declared in the base `:host` block of the component that OWNS
 *      the name (`--wpd-table-bg` in `wpd-table/`) → that value.
 *      A feature stylesheet re-binding a palette name inside its own
 *      scope (the sticky note sets `--wpd-fg` to its ink colour) is
 *      NOT evidence of a default and is ignored.
 *   3. Otherwise the fallback literal it is read with, when one
 *      spelling holds a clear majority of the read sites.
 *
 * Nested `var()` is then resolved the way the browser would with no
 * theme active: a name declared in `variables.css` resolves to its
 * declaration, every other one is unset and so resolves to the
 * WRITTEN fallback — never to whatever value this script picked for
 * it elsewhere. That distinction is what keeps, say,
 * `--wpd-context-menu-fg-muted` at the white it actually renders
 * instead of the dark `--wpd-fg-muted` the chain names first.
 *
 * ## Accent-derived tokens are captured, not dropped
 *
 * The focused title bar, the window-link splines, the selection ring
 * and a dozen component tokens all resolve through
 * `--wp-admin-theme-color`. The manifest grammar has no `var()`, so
 * they can only be captured as the literal behind that chain — WP
 * blue — which pins them for every admin colour scheme.
 *
 * That is the right trade for THIS theme and only this one: Legacy
 * exists to reproduce a look people remember, and what they remember
 * is a blue title bar. A theme that wanted to keep following the
 * user's scheme would simply omit these names.
 *
 * `--wp-admin-theme-color` itself stays out — it is the user's accent
 * setting, written as an inline style, and no theme should take it.
 *
 * ## What is deliberately excluded
 *
 * Texture-slot properties (written by the manifest's `textures`
 * block), derived badge sizes, and the hand-listed context-dependent
 * names in SKIP below. See
 * `docs/desktop-themes.md#the-legacy-theme--start-here`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
/** The frozen snapshot. Compared against, never written to. */
const LEGACY = path.join( ROOT, 'assets/desktop-themes/legacy/theme.json' );

/**
 * `--out <path>` mints a NEW snapshot there. A bare run reports drift
 * and writes nothing, and no invocation may target the Legacy
 * manifest — see the header.
 */
const OUT = ( () => {
	const at = process.argv.indexOf( '--out' );
	if ( at === -1 ) return null;
	const given = process.argv[ at + 1 ];
	if ( ! given ) {
		console.error( '--out needs a path to write the new snapshot to.' );
		process.exit( 1 );
	}
	const resolved = path.resolve( process.cwd(), given );
	if ( resolved === LEGACY ) {
		console.error(
			'Refusing to write the Legacy manifest: it is a frozen snapshot of the\n' +
			'pre-brand look, and a snapshot taken today would capture the OpenStation\n' +
			'palette instead. Mint a new theme under a new id.'
		);
		process.exit( 1 );
	}
	return resolved;
} )();

/** A fallback needs this share of a token's read sites to be "the" default. */
const MAJORITY = 0.55;

/**
 * Names left undeclared on purpose. Each would make the theme differ
 * from the unthemed shell rather than reproduce it.
 */
const SKIP = new Map( Object.entries( {
	'--wp-admin-theme-color': 'follows the admin colour scheme',
	// Read light on the desk and dark inside a window.
	'--desktop-mode-fg': 'context-dependent',
	'--desktop-mode-surface': 'context-dependent (opaque panel / glass)',
	'--desktop-mode-tooltip-bg': 'context-dependent (dark chip / light card)',
	'--desktop-mode-tooltip-fg': 'context-dependent (dark chip / light card)',
	'--wpd-color-text': 'the colour picker runs light and dark',
	'--wpd-color-text-subtle': 'the colour picker runs light and dark',
	'--wpd-color-border': 'the colour picker runs light and dark',
	'--wpd-info-bg': 'no dominant default',
	// Behaviour, layout, or runtime state — not paint.
	'--wpd-log-row-white-space': 'behavioural',
	'--wpd-cat-row-indent': 'layout, per depth',
	'--wpd-avatar-hover': 'runtime pointer state',
	'--wpd-avatar-tilt-x': 'runtime pointer state',
	'--wpd-avatar-tilt-y': 'runtime pointer state',
	'--wpd-avatar-glare-x': 'runtime pointer state',
	'--wpd-avatar-glare-y': 'runtime pointer state',
	'--desktop-mode-window-corner-inset': 'derived from the window radius',
} ) );

/**
 * Chosen by hand where the tree reads one name with several literals
 * and counting cannot pick between them. The answer is either the
 * WordPress admin palette value or the literal the shell uses when NO
 * theme is active — which is exactly what this theme is for.
 */
const HAND_PICK = new Map( Object.entries( {
	'--wpd-fg-muted': '#50575e',
	'--wpd-border': '#dcdcde',
	// The four unfocused title-bar control tokens switch to a
	// color-mix derivation the moment ANY theme is active. Naming the
	// unthemed literals is what keeps Legacy a no-op.
	'--desktop-mode-titlebar-btn-color': 'rgba( 0, 0, 0, 0.45 )',
	'--desktop-mode-titlebar-btn-color-hover': 'rgba( 0, 0, 0, 0.85 )',
	'--desktop-mode-titlebar-btn-bg-hover': 'rgba( 0, 0, 0, 0.08 )',
	'--desktop-mode-titlebar-btn-bg-active': 'rgba( 0, 0, 0, 0.12 )',
	// Focused half — the title bar's own literals.
	'--desktop-mode-titlebar-btn-focused-color': 'rgba( 255, 255, 255, 0.7 )',
	'--desktop-mode-titlebar-btn-focused-outline': 'rgba( 255, 255, 255, 0.65 )',
	// The dock glyph at rest. System tiles sit one notch brighter
	// unthemed and join this colour once a theme names it.
	'--desktop-mode-dock-icon-color': 'rgba( 255, 255, 255, 0.7 )',
	// The WordPress admin palette — the values the tree converges on.
	'--wpd-surface-elevated': '#f6f7f7',
	'--wpd-surface-sunken': '#eef0f1',
	'--wpd-surface-raised': 'rgba( 255, 255, 255, 0.6 )',
	'--wpd-fg-faint': '#787c82',
	'--wpd-border-strong': '#8c8f94',
	'--wpd-hover': 'rgba( 0, 0, 0, 0.04 )',
	'--wpd-scrim': 'rgba( 0, 0, 0, 0.45 )',
	// Paired with --wpd-accent: #2271b1, so the blue family stays one
	// family instead of mixing the two blues the tree carries.
	'--wpd-accent-strong': '#135e96',
	'--wpd-accent-soft': 'rgba( 34, 113, 177, 0.18 )',
	'--wpd-success-fg': '#1d6f42',
	'--wpd-warning-fg': '#996800',
	'--wpd-info-fg': '#0969da',
	// Typography: the stacks the shell has always rendered with.
	'--wpd-font': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
	'--wpd-font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
	'--desktop-mode-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	// Documented to fall back to --desktop-mode-font; one read site
	// spells that fallback `inherit`, which is not a typeface.
	'--desktop-mode-titlebar-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} ) );

/** Derived from the icon it decorates — a literal would freeze it. */
const DERIVED = /-computed-size$|-badge-(size|font-size|padding)$/;

/** Written by the manifest's `textures` block, never by `tokens`. */
const TEXTURE_PROP = /-image(-|$)/;

/**
 * The documented `--wpd-*` palette. Components re-bind these inside
 * their own inverted variants, so a declaration is never evidence of
 * the default — they resolve from read sites (or HAND_PICK) only.
 */
const PALETTE = new Set( [
	'--wpd-surface', '--wpd-surface-elevated', '--wpd-surface-sunken', '--wpd-surface-raised',
	'--wpd-fg', '--wpd-fg-muted', '--wpd-fg-faint', '--wpd-fg-on-accent',
	'--wpd-border', '--wpd-border-strong', '--wpd-hover', '--wpd-scrim',
	'--wpd-accent', '--wpd-accent-strong', '--wpd-accent-soft',
	'--wpd-danger', '--wpd-danger-hover',
	'--wpd-warning-fg', '--wpd-warning-bg', '--wpd-warning-border',
	'--wpd-info-fg', '--wpd-info-bg', '--wpd-success-fg',
	'--wpd-font', '--wpd-font-mono',
] );

const THEMABLE = /^--(desktop-mode|wpd)-[a-z0-9-]+$/;

// ---------------------------------------------------------------- //
// Source scan                                                      //
// ---------------------------------------------------------------- //

function walk( dir, out = [] ) {
	for ( const e of fs.readdirSync( dir, { withFileTypes: true } ) ) {
		if ( e.name === 'node_modules' || e.name === '.git' || e.name === 'vendor' ) continue;
		const p = path.join( dir, e.name );
		if ( e.isDirectory() ) walk( p, out );
		else if ( /\.(css|ts)$/.test( e.name ) && ! /\.test\.ts$/.test( e.name ) ) out.push( p );
	}
	return out;
}

/** Index of the `)` closing the `(` at `open`. */
function matchParen( text, open ) {
	let depth = 0;
	for ( let i = open; i < text.length; i++ ) {
		if ( text[ i ] === '(' ) depth++;
		else if ( text[ i ] === ')' ) {
			depth--;
			if ( depth === 0 ) return i;
		}
	}
	return -1;
}

/** Split a `var()` body on its first top-level comma. */
function splitVarBody( body ) {
	let depth = 0;
	for ( let i = 0; i < body.length; i++ ) {
		const c = body[ i ];
		if ( c === '(' ) depth++;
		else if ( c === ')' ) depth--;
		else if ( c === ',' && depth === 0 ) {
			return [ body.slice( 0, i ).trim(), body.slice( i + 1 ).trim() ];
		}
	}
	return [ body.trim(), null ];
}

const files = [ ...walk( path.join( ROOT, 'assets/css' ) ), ...walk( path.join( ROOT, 'src' ) ) ];

/** `:root` declarations in variables.css — name => value. */
const declared = new Map();
{
	const text = fs.readFileSync( path.join( ROOT, 'assets/css/variables.css' ), 'utf8' );
	// The `:root` block, from its own brace to its own close — NOT to
	// the first `}` in the file, which since the brand landed belongs
	// to an `@font-face` rule several lines above it.
	const start = text.indexOf( ':root {' );
	const block = text.slice( start, text.indexOf( '\n}\n', start ) );
	for ( const m of block.matchAll( /^\t(--[a-z0-9-]+):\s*([^;]+);/gm ) ) {
		declared.set( m[ 1 ], m[ 2 ].replace( /\s+/g, ' ' ).trim() );
	}
}

/** Read sites: name => [ { fallback, count } ], most-read first. */
const usages = new Map();
/** Base `:host` declarations: name => [ { value, files } ]. */
const hostDecls = new Map();

for ( const file of files ) {
	const text = fs.readFileSync( file, 'utf8' );
	const rel = path.relative( ROOT, file );

	// --- reads -------------------------------------------------- //
	for ( let i = 0; ( i = text.indexOf( 'var(', i ) ) !== -1; i += 4 ) {
		if ( i > 0 && /[A-Za-z0-9_-]/.test( text[ i - 1 ] ) ) continue;
		const end = matchParen( text, i + 3 );
		if ( end === -1 ) continue;
		const [ name, fallback ] = splitVarBody( text.slice( i + 4, end ) );
		if ( ! THEMABLE.test( name ) || fallback === null ) continue;
		const key = fallback.replace( /\s+/g, ' ' ).trim();
		if ( ! usages.has( name ) ) usages.set( name, new Map() );
		const m = usages.get( name );
		m.set( key, ( m.get( key ) || 0 ) + 1 );
	}

	// --- base `:host` declarations ------------------------------ //
	if ( rel === 'assets/css/variables.css' ) continue;
	const seen = new Set();
	const re = /(^|[{;\n\t ])(--(?:desktop-mode|wpd)-[a-z0-9-]+)\s*:\s*/g;
	let m;
	while ( ( m = re.exec( text ) ) !== null ) {
		const name = m[ 2 ];
		if ( seen.has( name ) ) continue;
		const head = text.slice( Math.max( 0, m.index - 8 ), m.index + m[ 0 ].length - name.length - 1 );
		if ( /var\(\s*$/.test( head ) ) continue;

		// Enclosing selector: the last line before the opening brace.
		const upto = text.slice( 0, m.index );
		const brace = upto.lastIndexOf( '{' );
		if ( brace === -1 ) continue;
		const before = upto.slice( 0, brace );
		const cut = Math.max(
			before.lastIndexOf( '}' ), before.lastIndexOf( '{' ), before.lastIndexOf( ';' ),
			before.lastIndexOf( '\n' ), before.lastIndexOf( '`' )
		);
		const selector = before.slice( cut + 1 ).replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /\s+/g, ' ' ).trim();
		if ( ! /^(:host|:root|\*)$/.test( selector ) ) continue;

		// Value: up to the first top-level `;` or newline.
		let depth = 0, end = -1;
		for ( let k = re.lastIndex; k < text.length; k++ ) {
			const c = text[ k ];
			if ( c === '(' ) depth++;
			else if ( c === ')' ) depth--;
			else if ( ( c === ';' || c === '\n' ) && depth === 0 ) { end = k; break; }
		}
		if ( end === -1 ) continue;
		const value = text.slice( re.lastIndex, end ).replace( /\s+/g, ' ' ).trim();
		if ( ! value || value.length > 400 ) continue;

		seen.add( name );
		if ( ! hostDecls.has( name ) ) hostDecls.set( name, [] );
		hostDecls.get( name ).push( { value, file: rel } );
	}
}

// ---------------------------------------------------------------- //
// Resolution                                                       //
// ---------------------------------------------------------------- //

/**
 * A component's `:host` declaration counts only for the tokens that
 * component owns — `wpd-window-button` declaring `--wpd-button-bg-hover`
 * says nothing about every other button in the OS.
 */
function componentDefault( name ) {
	if ( PALETTE.has( name ) ) return null;
	const owns = ( file ) => {
		const m = /^src\/ui\/components\/([a-z0-9-]+)\//.exec( file );
		if ( ! m ) return false;
		const parts = m[ 1 ].split( '-' );
		for ( let n = parts.length; n >= 2; n-- ) {
			if ( name.startsWith( '--' + parts.slice( 0, n ).join( '-' ) + '-' ) ) return true;
		}
		return false;
	};
	const list = ( hostDecls.get( name ) || [] ).filter( ( d ) => owns( d.file ) );
	return list.length ? list[ 0 ].value : null;
}

function rawDefault( name ) {
	if ( declared.has( name ) ) return { expr: declared.get( name ) };
	const c = componentDefault( name );
	if ( c !== null ) return { expr: c };
	const reads = usages.get( name );
	if ( ! reads || ! reads.size ) return null;
	return { variants: [ ...reads ].map( ( [ fallback, count ] ) => ( { fallback, count } ) ) };
}

/** Expand nested `var()` the way the browser would, untheme d. */
function substitute( expr, seen = new Set(), depth = 0 ) {
	if ( depth > 12 ) return { value: expr, ok: false, schemeDerived: false };
	let out = '', i = 0, ok = true, schemeDerived = false;

	while ( i < expr.length ) {
		const idx = expr.indexOf( 'var(', i );
		if ( idx === -1 ) { out += expr.slice( i ); break; }
		if ( idx > 0 && /[A-Za-z0-9_-]/.test( expr[ idx - 1 ] ) ) {
			out += expr.slice( i, idx + 4 );
			i = idx + 4;
			continue;
		}
		out += expr.slice( i, idx );
		const end = matchParen( expr, idx + 3 );
		if ( end === -1 ) { ok = false; break; }

		const [ inner, innerFb ] = splitVarBody( expr.slice( idx + 4, end ) );
		if ( inner === '--wp-admin-theme-color' ) schemeDerived = true;

		let replacement = null;
		const next = new Set( [ ...seen, inner ] );
		// Declared in variables.css → the declaration is what computes.
		if ( declared.has( inner ) && ! seen.has( inner ) ) {
			const r = substitute( declared.get( inner ), next, depth + 1 );
			if ( r.ok ) { replacement = r.value; schemeDerived ||= r.schemeDerived; }
		}
		// Otherwise it is unset, so the written fallback is the value.
		if ( replacement === null && innerFb !== null ) {
			const r = substitute( innerFb, next, depth + 1 );
			if ( r.ok ) { replacement = r.value; schemeDerived ||= r.schemeDerived; }
		}
		// No fallback written — fall back to the token's own default.
		if ( replacement === null && ! seen.has( inner ) ) {
			const r = resolve( inner, next, depth + 1 );
			if ( r && r.ok ) { replacement = r.value; schemeDerived ||= r.schemeDerived; }
		}
		if ( replacement === null ) { ok = false; replacement = ''; }
		out += replacement;
		i = end + 1;
	}

	return { value: out.replace( /\s+/g, ' ' ).trim(), ok, schemeDerived };
}

/**
 * One token => one literal. Variants are substituted BEFORE they are
 * grouped, so two spellings of the same chain collapse to one answer
 * instead of reading as a conflict.
 */
function resolve( name, seen = new Set( [ name ] ), depth = 0 ) {
	if ( HAND_PICK.has( name ) ) {
		return { ok: true, value: HAND_PICK.get( name ), schemeDerived: false };
	}
	const rd = rawDefault( name );
	if ( ! rd ) return null;
	if ( rd.expr !== undefined ) return substitute( rd.expr, seen, depth );

	const groups = new Map();
	for ( const v of rd.variants ) {
		const r = substitute( v.fallback, seen, depth );
		if ( ! r.ok ) continue;
		const key = r.value.replace( /\s+/g, '' ).toLowerCase();
		if ( ! groups.has( key ) ) groups.set( key, { value: r.value, count: 0, schemeDerived: r.schemeDerived } );
		groups.get( key ).count += v.count;
	}
	if ( ! groups.size ) return { ok: false, value: '', schemeDerived: false };

	const sorted = [ ...groups.values() ].sort( ( a, b ) => b.count - a.count );
	const total = sorted.reduce( ( n, g ) => n + g.count, 0 );
	if ( sorted.length > 1 && sorted[ 0 ].count / total < MAJORITY ) {
		return {
			ok: false,
			value: sorted[ 0 ].value,
			schemeDerived: false,
			ambiguous: sorted.slice( 0, 3 ).map( ( g ) => `${ g.count }× ${ g.value }` ).join( ' / ' ),
		};
	}
	return { ok: true, value: sorted[ 0 ].value, schemeDerived: sorted[ 0 ].schemeDerived };
}

/** The manifest value grammar — see includes/desktop-themes/manifest.php. */
function grammarProblem( v ) {
	if ( ! v || v.length > 256 ) return 'length';
	if ( ! /^[A-Za-z0-9\s#%.,()/*+\-_'"]+$/.test( v ) ) return 'charset';
	if ( v.includes( '/*' ) || v.includes( '*/' ) ) return 'comment';
	for ( const fn of [ 'url(', 'image-set(', 'element(', 'attr(', 'var(', 'expression' ] ) {
		if ( v.toLowerCase().includes( fn ) ) return 'banned ' + fn;
	}
	let depth = 0;
	for ( const c of v ) {
		if ( c === '(' ) depth++;
		else if ( c === ')' && --depth < 0 ) return 'unbalanced parens';
	}
	return depth === 0 ? null : 'unbalanced parens';
}

/** WordPress CSS spacing: `rgba( 0, 0, 0, 0.4 )`. */
function normalize( v ) {
	return v
		.replace( /\(\s*/g, '( ' )
		.replace( /\s*\)/g, ' )' )
		.replace( /\s*,\s*/g, ', ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

// ---------------------------------------------------------------- //
// Emit                                                             //
// ---------------------------------------------------------------- //

const tokens = {};
const skipped = [];
const names = [ ...new Set( [ ...declared.keys(), ...hostDecls.keys(), ...usages.keys() ] ) ].sort(
	( a, b ) => ( a.startsWith( '--desktop-mode' ) ? 0 : 1 ) - ( b.startsWith( '--desktop-mode' ) ? 0 : 1 )
		|| a.localeCompare( b )
);

for ( const name of names ) {
	const drop = ( why ) => skipped.push( `${ name } — ${ why }` );

	if ( SKIP.has( name ) ) { drop( SKIP.get( name ) ); continue; }
	if ( ! THEMABLE.test( name ) ) { drop( 'outside the themable namespaces' ); continue; }
	if ( TEXTURE_PROP.test( name ) ) { drop( 'texture slot' ); continue; }
	if ( DERIVED.test( name ) ) { drop( 'derived size' ); continue; }

	const r = resolve( name );
	if ( ! r ) { drop( 'never read with a default' ); continue; }
	if ( ! r.ok ) { drop( r.ambiguous ? `no dominant default (${ r.ambiguous })` : 'unresolvable chain' ); continue; }

	const value = normalize( r.value );
	const bad = grammarProblem( value );
	if ( bad ) { drop( `${ bad }: ${ value }` ); continue; }

	tokens[ name ] = value;
}

const manifest = {
	manifestVersion: 1,
	id: 'desktop-mode/legacy',
	// Kept in step with the translatable copy in
	// includes/desktop-themes/builtin.php.
	name: 'Desktop Mode (Legacy)',
	version: '1.0.0',
	author: 'Desktop Mode',
	description:
		"The look Desktop Mode had before the OpenStation brand: every design token at the value it resolved to then. Wear it to put the old palette back, or fork it as the starting point for a theme of your own.",
	preview: 'preview.svg',
	tokens,
};

const json = JSON.stringify( manifest, null, '\t' ) + '\n';

if ( ! OUT ) {
	// Drift report: today's resolved defaults against the frozen
	// snapshot. Since the brand landed these differ by design — the
	// value is in seeing WHICH tokens moved, which is how you catch a
	// fill that now resolves to a 10%-alpha wash.
	const now = JSON.parse( json ).tokens;
	const then = JSON.parse( fs.readFileSync( LEGACY, 'utf8' ) ).tokens || {};
	const moved = Object.keys( now ).filter( ( k ) => k in then && then[ k ] !== now[ k ] );
	const added = Object.keys( now ).filter( ( k ) => ! ( k in then ) );
	const gone = Object.keys( then ).filter( ( k ) => ! ( k in now ) );

	if ( ! moved.length && ! added.length && ! gone.length ) {
		console.log( `Today's defaults match the Legacy snapshot exactly (${ Object.keys( now ).length } tokens).` );
	} else {
		console.log( "Today's defaults vs the frozen Legacy snapshot — expected to differ," );
		console.log( 'since the OpenStation palette is what `variables.css` now declares.' );
		console.log( 'Nothing here is written anywhere; read it as an audit of the rebrand.\n' );
		for ( const k of moved ) console.log( `  changed  ${ k }: ${ then[ k ] } -> ${ now[ k ] }` );
		for ( const k of added ) console.log( `  new      ${ k }: ${ now[ k ] }` );
		for ( const k of gone ) console.log( `  dropped  ${ k }: ${ then[ k ] }` );
	}
	process.exit( 0 );
}

fs.mkdirSync( path.dirname( OUT ), { recursive: true } );
fs.writeFileSync( OUT, json );
console.log( `Wrote a new snapshot to ${ path.relative( ROOT, OUT ) } with ${ Object.keys( tokens ).length } tokens.` );
console.log( 'Give it its own `id` and `name` before shipping it — the ids in this file' );
console.log( "are Legacy's, and an id collision would shadow the frozen theme." );
console.log( `Left undeclared: ${ skipped.length }. Run with DEBUG=1 to list them.` );
if ( process.env.DEBUG ) {
	for ( const line of skipped ) console.log( '  ' + line );
}
