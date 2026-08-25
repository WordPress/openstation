#!/usr/bin/env node
/**
 * Measure what a shell boot document actually costs, deterministically.
 *
 * Logs into a local WordPress, fetches one document, then fetches every
 * `<script src>` and `<link rel=stylesheet>` the SERVER printed into it and
 * reports request count plus raw and gzipped bytes, grouped by owner
 * (WordPress core / a plugin / this plugin).
 *
 * The point is that it measures the server's output, not the browser's
 * behaviour. DevTools' footer totals move with cache state, how long the tab
 * sat there polling, and how many windows you opened, which makes them
 * useless for comparing two builds. This does not: same code in, same
 * numbers out.
 *
 * Two modes:
 *
 *   measure   node bin/boot-cost.mjs --out before.json
 *   diff      node bin/boot-cost.mjs --diff before.json after.json
 *
 * See docs/DEVELOPMENT.md, "Measuring boot cost", for the trunk-vs-branch
 * workflow and the traps worth knowing about.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULTS = {
	base: 'http://localhost:8890',
	path: '/wp-admin/',
	user: 'admin',
	password: 'password',
	label: 'boot',
	concurrency: 8,
};

/** Owner buckets, in match order. First hit wins. */
const OWNERS = [
	[ /\/plugins\/desktop-mode\//, 'desktop-mode' ],
	[ /\/wp-content\/plugins\/([^/]+)\//, ( m ) => `plugin: ${ m[ 1 ] }` ],
	[ /\/wp-content\/themes\/([^/]+)\//, ( m ) => `theme: ${ m[ 1 ] }` ],
	[ /\/wp-(includes|admin)\//, 'wp-core' ],
];

function ownerOf( url ) {
	for ( const [ re, name ] of OWNERS ) {
		const m = re.exec( url );
		if ( m ) {
			return typeof name === 'function' ? name( m ) : name;
		}
	}
	return 'other';
}

/* -------------------------------------------------------------------------
 * A cookie jar just big enough for wp-login. `fetch()` has none of its own,
 * and the login flow needs the test cookie from the GET to survive into the
 * POST, and the auth cookies from the POST to survive the redirect chain.
 * ---------------------------------------------------------------------- */

/**
 * The jar is bound to ONE origin: the site being measured. Cookies are
 * only sent to, and only accepted from, that origin, and a `Secure`
 * cookie only travels over https. Assets frequently live on another host
 * (a CDN, a different hostname for the same site), and the WordPress
 * auth cookies must never go there. A static asset needs no cookie anyway.
 *
 * Map of name -> { value, secure }.
 */
const jar = new Map();
let jarOrigin = null;

function jarBind( base ) {
	jarOrigin = new URL( base ).origin;
	jar.clear();
}

function jarHeader( url ) {
	const target = new URL( url );
	if ( target.origin !== jarOrigin ) {
		return '';
	}
	return [ ...jar ]
		.filter( ( [ , c ] ) => ! c.secure || target.protocol === 'https:' )
		.map( ( [ name, c ] ) => `${ name }=${ c.value }` )
		.join( '; ' );
}

function jarStore( url, response ) {
	if ( new URL( url ).origin !== jarOrigin ) {
		return;
	}
	for ( const cookie of response.headers.getSetCookie() ) {
		const [ pair, ...attrs ] = cookie.split( ';' );
		const eq = pair.indexOf( '=' );
		if ( eq > 0 ) {
			jar.set( pair.slice( 0, eq ).trim(), {
				value: pair.slice( eq + 1 ).trim(),
				secure: attrs.some(
					( a ) => a.trim().toLowerCase() === 'secure',
				),
			} );
		}
	}
}

/**
 * fetch() with the jar wired in and redirects followed by hand, so cookies
 * set mid-chain are carried forward.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} maxHops
 * @return {Promise<{ response: Response, url: string }>}
 */
async function hop( url, init = {}, maxHops = 10 ) {
	let current = url;
	for ( let i = 0; i <= maxHops; i++ ) {
		const headers = { ...( init.headers || {} ) };
		const cookie = jarHeader( current );
		if ( cookie ) {
			headers.cookie = cookie;
		}
		const response = await fetch( current, {
			...init,
			headers,
			redirect: 'manual',
		} );
		jarStore( current, response );

		const location = response.headers.get( 'location' );
		if ( ! location || response.status < 300 || response.status >= 400 ) {
			return { response, url: current };
		}
		current = new URL( location, current ).toString();
		// Only the first request carries the body; a redirected POST
		// becomes a GET, which is what a browser does too.
		init = { method: 'GET' };
	}
	throw new Error( `too many redirects starting at ${ url }` );
}

async function login( base, user, password ) {
	jarBind( base );

	// Priming GET: this is what sets the test cookie the POST is checked
	// against. Skipping it makes the login silently fail.
	await hop( `${ base }/wp-login.php` );

	const body = new URLSearchParams( {
		log: user,
		pwd: password,
		'wp-submit': 'Log In',
		redirect_to: '/wp-admin/',
		testcookie: '1',
	} );

	const { url } = await hop( `${ base }/wp-login.php`, {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
	} );

	if ( url.includes( 'wp-login.php' ) ) {
		throw new Error(
			`login failed at ${ base } (landed back on ${ url }). Wrong credentials, or the site is not the wp-env instance you think it is.`,
		);
	}
}

/* ---------------------------------------------------------------------- */

const STYLE_TAG = /<link\b[^>]*?rel=(['"])stylesheet\1[^>]*?>/gi;
const HREF = /href=(['"])(.*?)\1/i;
const SCRIPT_SRC = /<script\b[^>]*?\bsrc=(['"])(.*?)\1[^>]*?>/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

function sumInline( html, re ) {
	let total = 0;
	for ( const m of html.matchAll( re ) ) {
		total += Buffer.byteLength( m[ 1 ], 'utf8' );
	}
	return total;
}

/** Fetch one asset uncompressed, and gzip it locally so the number is ours. */
async function sizeOf( url ) {
	try {
		const { response } = await hop( url, {
			headers: { 'accept-encoding': 'identity' },
		} );
		if ( ! response.ok ) {
			process.stderr.write( `  ! ${ response.status } ${ url }\n` );
			return { raw: 0, gz: 0 };
		}
		const buf = Buffer.from( await response.arrayBuffer() );
		return { raw: buf.length, gz: gzipSync( buf, { level: 6 } ).length };
	} catch ( err ) {
		process.stderr.write( `  ! ${ url } -> ${ err.message }\n` );
		return { raw: 0, gz: 0 };
	}
}

/** Run `jobs` with a fixed worker count, preserving input order. */
async function pool( jobs, workers ) {
	const out = new Array( jobs.length );
	let next = 0;
	await Promise.all(
		Array.from( { length: Math.min( workers, jobs.length ) }, async () => {
			while ( next < jobs.length ) {
				const i = next++;
				out[ i ] = await jobs[ i ]();
			}
		} ),
	);
	return out;
}

async function measure( opts ) {
	await login( opts.base, opts.user, opts.password );

	const { response, url: finalUrl } = await hop( opts.base + opts.path );
	const html = await response.text();

	const assets = [];
	for ( const tag of html.matchAll( STYLE_TAG ) ) {
		const href = HREF.exec( tag[ 0 ] );
		if ( href ) {
			assets.push( {
				kind: 'css',
				url: new URL( href[ 2 ], finalUrl ).toString(),
			} );
		}
	}
	for ( const m of html.matchAll( SCRIPT_SRC ) ) {
		assets.push( {
			kind: 'js',
			url: new URL( m[ 2 ], finalUrl ).toString(),
		} );
	}

	const sizes = await pool(
		assets.map( ( a ) => () => sizeOf( a.url ) ),
		opts.concurrency,
	);

	return {
		label: opts.label,
		base: opts.base,
		requested: opts.path,
		finalUrl,
		htmlBytes: Buffer.byteLength( html, 'utf8' ),
		htmlGzBytes: gzipSync( Buffer.from( html, 'utf8' ), { level: 6 } )
			.length,
		inlineJsBytes: sumInline( html, INLINE_SCRIPT ),
		inlineCssBytes: sumInline( html, INLINE_STYLE ),
		assets: assets.map( ( a, i ) => ( {
			...a,
			owner: ownerOf( a.url ),
			...sizes[ i ],
		} ) ),
	};
}

/* ---------------------------------------------------------------------- */

const kb = ( n ) => ( n / 1024 ).toFixed( 1 );
const mb = ( n ) => ( n / 1024 / 1024 ).toFixed( 2 );

function totals( rows ) {
	return rows.reduce(
		( acc, r ) => ( {
			requests: acc.requests + 1,
			raw: acc.raw + r.raw,
			gz: acc.gz + r.gz,
		} ),
		{ requests: 0, raw: 0, gz: 0 },
	);
}

function groupBy( rows, key ) {
	const out = new Map();
	for ( const r of rows ) {
		const k = r[ key ];
		const b = out.get( k ) || { requests: 0, raw: 0, gz: 0 };
		b.requests++;
		b.raw += r.raw;
		b.gz += r.gz;
		out.set( k, b );
	}
	return [ ...out ].sort( ( a, b ) => b[ 1 ].gz - a[ 1 ].gz );
}

function report( result ) {
	const t = totals( result.assets );
	process.stdout.write(
		`\n=== ${ result.label }\n` +
			`    ${ result.finalUrl }\n\n` +
			`document            ${ kb( result.htmlBytes ) } KB  ` +
			`(${ kb( result.htmlGzBytes ) } KB gz)\n` +
			`  inline JS / CSS   ${ kb( result.inlineJsBytes ) } KB / ` +
			`${ kb( result.inlineCssBytes ) } KB\n` +
			`assets              ${ t.requests } requests  ` +
			`${ mb( t.raw ) } MB raw  ${ mb( t.gz ) } MB gz\n`,
	);
	for ( const [ kind, b ] of groupBy( result.assets, 'kind' ) ) {
		process.stdout.write(
			`  ${ kind.padEnd( 16 ) }  ${ String( b.requests ).padStart( 3 ) }  ` +
				`${ kb( b.raw ).padStart( 9 ) } KB  ${ kb( b.gz ).padStart( 8 ) } KB gz\n`,
		);
	}
	process.stdout.write( '  by owner:\n' );
	for ( const [ owner, b ] of groupBy( result.assets, 'owner' ) ) {
		process.stdout.write(
			`  ${ owner.padEnd( 16 ) }  ${ String( b.requests ).padStart( 3 ) }  ` +
				`${ kb( b.raw ).padStart( 9 ) } KB  ${ kb( b.gz ).padStart( 8 ) } KB gz\n`,
		);
	}
}

/** Strip `?ver=` so the same file across two builds compares equal. */
const identity = ( url ) => url.replace( /\?ver=[^&]*/, '' );

function diff( beforeFile, afterFile ) {
	const a = JSON.parse( readFileSync( beforeFile, 'utf8' ) );
	const b = JSON.parse( readFileSync( afterFile, 'utf8' ) );
	const at = totals( a.assets );
	const bt = totals( b.assets );

	const pct = ( from, to ) =>
		from === 0 ? 'n/a' : `${ ( ( ( to - from ) / from ) * 100 ).toFixed( 2 ) }%`;

	const row = ( label, x, y, fmt = kb, unit = 'KB' ) =>
		`${ label.padEnd( 24 ) }${ fmt( x ).padStart( 11 ) }${ fmt( y ).padStart(
			11,
		) }${ ( ( y - x >= 0 ? '+' : '' ) + fmt( y - x ) ).padStart( 12 ) } ${ unit }` +
		`  ${ pct( x, y ).padStart( 9 ) }\n`;

	process.stdout.write(
		`\n=== ${ a.label }  ->  ${ b.label }\n\n` +
			`${ ''.padEnd( 24 ) }${ 'before'.padStart( 11 ) }${ 'after'.padStart(
				11,
			) }${ 'delta'.padStart( 12 ) }\n` +
			row(
				'asset requests',
				at.requests,
				bt.requests,
				( n ) => String( n ),
				'',
			) +
			row( 'assets raw', at.raw, bt.raw, mb, 'MB' ) +
			row( 'assets gzipped', at.gz, bt.gz, mb, 'MB' ) +
			row( 'document', a.htmlBytes, b.htmlBytes ) +
			row( 'document gzipped', a.htmlGzBytes, b.htmlGzBytes ) +
			row( '  inline JS', a.inlineJsBytes, b.inlineJsBytes ),
	);

	const beforeMap = new Map(
		a.assets.map( ( r ) => [ identity( r.url ), r ] ),
	);
	const afterMap = new Map( b.assets.map( ( r ) => [ identity( r.url ), r ] ) );
	const gone = [ ...beforeMap.keys() ].filter( ( k ) => ! afterMap.has( k ) );
	const added = [ ...afterMap.keys() ].filter( ( k ) => ! beforeMap.has( k ) );

	const list = ( title, keys, map ) => {
		if ( ! keys.length ) {
			return;
		}
		const sum = keys.reduce(
			( acc, k ) => ( {
				raw: acc.raw + map.get( k ).raw,
				gz: acc.gz + map.get( k ).gz,
			} ),
			{ raw: 0, gz: 0 },
		);
		process.stdout.write(
			`\n${ title }: ${ keys.length } files, ` +
				`${ mb( sum.raw ) } MB raw / ${ mb( sum.gz ) } MB gz\n`,
		);
		for ( const k of keys
			.sort( ( x, y ) => map.get( y ).raw - map.get( x ).raw )
			.slice( 0, 20 ) ) {
			const r = map.get( k );
			process.stdout.write(
				`  ${ kb( r.raw ).padStart( 9 ) } KB  ${ new URL( k ).pathname }\n`,
			);
		}
		if ( keys.length > 20 ) {
			process.stdout.write( `  … and ${ keys.length - 20 } more\n` );
		}
	};

	list( 'REMOVED from the boot document', gone, beforeMap );
	list( 'ADDED to the boot document', added, afterMap );
}

/* ---------------------------------------------------------------------- */

function parseArgs( argv, env = process.env ) {
	// Credentials: flag beats environment beats the wp-env default. The
	// environment route keeps a password out of shell history and `ps`.
	const opts = {
		...DEFAULTS,
		user: env.BOOT_COST_USER ?? DEFAULTS.user,
		password: env.BOOT_COST_PASSWORD ?? DEFAULTS.password,
		out: null,
		diff: null,
	};
	for ( let i = 0; i < argv.length; i++ ) {
		const arg = argv[ i ];
		const value = () => {
			const v = argv[ ++i ];
			if ( v === undefined ) {
				throw new Error( `${ arg } needs a value` );
			}
			return v;
		};
		switch ( arg ) {
			case '--diff':
				opts.diff = [ value(), value() ];
				break;
			case '--base':
				opts.base = value().replace( /\/$/, '' );
				break;
			case '--path':
				opts.path = value();
				break;
			case '--label':
				opts.label = value();
				break;
			case '--user':
				opts.user = value();
				break;
			case '--password':
				opts.password = value();
				break;
			case '--out':
				opts.out = value();
				break;
			case '--concurrency':
				opts.concurrency = Number( value() );
				break;
			case '-h':
			case '--help':
				opts.help = true;
				break;
			default:
				throw new Error( `unknown argument: ${ arg }` );
		}
	}
	return opts;
}

const USAGE = `
Measure the boot cost of an OpenStation shell document.

  node bin/boot-cost.mjs [--base URL] [--path PATH] [--label NAME] [--out FILE]
  node bin/boot-cost.mjs --diff BEFORE.json AFTER.json

Options
  --base URL         Site to measure (default ${ DEFAULTS.base })
  --path PATH        Document to fetch (default ${ DEFAULTS.path })
  --label NAME       Name for this run, shown in the report
  --out FILE         Write the full per-asset result as JSON, for --diff
  --user / --password  Credentials (default ${ DEFAULTS.user } / ${ DEFAULTS.password })
  --concurrency N    Parallel asset fetches (default ${ DEFAULTS.concurrency })
  --diff A B         Compare two --out files and list what moved

Environment
  BOOT_COST_USER, BOOT_COST_PASSWORD
                     Credentials without putting them on the command line.

Cookies are only ever sent to the --base origin. Assets on another host
are fetched anonymously, which is all a static asset needs.
`;

async function main() {
	let opts;
	try {
		opts = parseArgs( process.argv.slice( 2 ) );
	} catch ( err ) {
		process.stderr.write( `${ err.message }\n${ USAGE }` );
		process.exitCode = 1;
		return;
	}

	if ( opts.help ) {
		process.stdout.write( USAGE );
		return;
	}

	if ( opts.diff ) {
		diff( opts.diff[ 0 ], opts.diff[ 1 ] );
		return;
	}

	const result = await measure( opts );
	report( result );

	if ( opts.out ) {
		writeFileSync( opts.out, JSON.stringify( result, null, 1 ) );
		process.stdout.write( `\nwrote ${ opts.out }\n` );
	}
}

main().catch( ( err ) => {
	process.stderr.write( `${ err.stack || err.message }\n` );
	process.exitCode = 1;
} );
