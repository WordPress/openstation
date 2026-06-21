/**
 * Desktop Mode — Jazz Quote Widget (lazy bundle).
 *
 * A love letter to WordPress's jazz musician release naming tradition.
 * Shows the current WP version, its jazz musician codename, and a
 * rotating quote from that musician — or a classic jazz wisdom quote
 * when the codename isn't in our list yet.
 *
 * Rotates to a new quote each day, persisted in ctx.storage so the
 * same quote shows across page loads until tomorrow.
 *
 * Data: WP REST /wp/v2 root endpoint for version info. Quotes are
 * bundled — no external API call needed, works fully offline.
 *
 * @since 0.26.0
 */
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID = 'desktop-mode/jazz-quote';

// ---------------------------------------------------------------------------
// WordPress release → jazz musician map.
// Each WP major version is named after a jazz musician.
// ---------------------------------------------------------------------------
const WP_CODENAMES: Record< string, string > = {
	'6.8': 'Chet Baker',
	'6.7': 'Miriam Makeba',
	'6.6': 'Dorival Caymmi',
	'6.5': 'Regina Carter',
	'6.4': 'Shirley Horn',
	'6.3': 'Lionel Hampton',
	'6.2': 'Dolly Parton',
	'6.1': 'Misha Dichter',
	'6.0': 'Arturo Sandoval',
	'5.9': 'Joséphine Baker',
	'5.8': 'Tatum',
	'5.7': 'Esperanza Spalding',
	'5.6': 'Simone',
	'5.5': 'Eckstine',
	'5.4': 'Adderley',
	'5.3': 'Kirk',
};

// ---------------------------------------------------------------------------
// Quotes keyed by musician name. Falls back to the jazz wisdom pool.
// ---------------------------------------------------------------------------
const MUSICIAN_QUOTES: Record< string, string[] > = {
	'Chet Baker': [
		'I just play what I hear in my head.',
		'You have to go beyond technical perfection.',
		'If I lose the melody, I lose myself.',
	],
	'Miriam Makeba': [
		'Music is medicine. Music is unity.',
		'I look at an ant and I see myself.',
		'I kept my culture. I kept the music of my roots.',
	],
	'Dorival Caymmi': [
		'The sea is the greatest teacher.',
		'Music is a feeling that has no borders.',
		'Simplicity is the highest form of elegance.',
	],
	'Regina Carter': [
		'The violin is not a barrier — it is a bridge.',
		'I never wanted to be put in a box.',
		'Swing is not a tempo. It is an attitude.',
	],
	'Shirley Horn': [
		'Space is where music lives.',
		'A slow tempo is a brave tempo.',
		'Every note needs room to breathe.',
	],
	'Lionel Hampton': [
		'I just hit the vibraphone and let God take over.',
		'You can always tell a musician by the way they listen.',
		'Jazz is the music of the moment that lasts forever.',
	],
	'Joséphine Baker': [
		'The most beautiful thing in the world is freedom.',
		'I improvised, caricatured, and made people laugh.',
		'I have walked into the palaces of kings and queens and into the houses of presidents. And much more. But I could not walk into a hotel in America.',
	],
};

// General jazz wisdom shown when the codename is not in our map yet.
const JAZZ_WISDOM = [
	'A jazz musician is a juggler who uses harmonies instead of oranges. — Benny Green',
	'Jazz is not just music, it is a way of life, it is a way of looking at the world. — Ray Charles',
	'Man, if you gotta ask, you\'ll never know. — Louis Armstrong',
	'There are no wrong notes in jazz: only notes in the wrong places. — Miles Davis',
	'Jazz is the music of the body. — Anita O\'Day',
	'Do not fear mistakes — there are none. — Miles Davis',
	'I never had much interest in the piano until I realized that every time I played, a girl would appear on the piano bench to my left. — Duke Ellington',
	'Music is your own experience, your thoughts, your wisdom. If you don\'t live it, it won\'t come out of your horn. — Charlie Parker',
	'You can play a shoestring if you\'re sincere. — John Coltrane',
	'If you have to ask what jazz is, you\'ll never know. — Louis Armstrong',
	'I\'m always thinking about creating. My future starts when I wake up every morning. — Miles Davis',
	'Jazz is not just music — it\'s life. — Nina Simone',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(): string {
	return new Date().toISOString().slice( 0, 10 );
}

function pickQuote( musician: string, seed: number ): string {
	const pool = MUSICIAN_QUOTES[ musician ] ?? JAZZ_WISDOM;
	return pool[ seed % pool.length ];
}

function majorVersion( version: string ): string {
	const parts = version.split( '.' );
	return parts.slice( 0, 2 ).join( '.' );
}

async function fetchWpVersion(): Promise< string > {
	const s = ( window as unknown as { wpApiSettings?: { root?: string; nonce?: string } } )
		.wpApiSettings ?? {};
	const res = await fetch(
		( s.root ?? '/wp-json/' ).replace( /\/$/, '' ) + '/wp/v2',
		{ headers: { 'X-WP-Nonce': s.nonce ?? '' }, credentials: 'same-origin' },
	);
	if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
	const data = await res.json() as { gmt_offset?: number; name?: string; description?: string };
	// The root endpoint doesn't expose WP version directly.
	// Read it from the generator meta tag already on the page instead.
	const meta = document.querySelector< HTMLMetaElement >( 'meta[name="generator"]' );
	const match = meta?.content?.match( /WordPress ([\d.]+)/ );
	return match ? match[ 1 ] : '6.8';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(
	container: HTMLElement,
	version: string,
	musician: string | null,
	quote: string,
): void {
	container.innerHTML = '';

	const root = document.createElement( 'div' );
	root.className = 'dm-jazz';

	// Note symbol — decorative
	const symbol = document.createElement( 'div' );
	symbol.className = 'dm-jazz__symbol';
	symbol.setAttribute( 'aria-hidden', 'true' );
	symbol.textContent = '\u266B'; // ♫

	// Quote text
	const quoteEl = document.createElement( 'blockquote' );
	quoteEl.className = 'dm-jazz__quote';
	quoteEl.textContent = quote;

	// Attribution line
	const attr = document.createElement( 'div' );
	attr.className = 'dm-jazz__attr';

	if ( musician ) {
		const nameEl = document.createElement( 'span' );
		nameEl.className = 'dm-jazz__musician';
		nameEl.textContent = musician;

		const wpEl = document.createElement( 'span' );
		wpEl.className = 'dm-jazz__version';
		wpEl.textContent = 'WordPress ' + version;

		attr.appendChild( nameEl );
		attr.appendChild( wpEl );
	} else {
		const wpEl = document.createElement( 'span' );
		wpEl.className = 'dm-jazz__version';
		wpEl.textContent = 'WordPress ' + version;
		attr.appendChild( wpEl );
	}

	root.appendChild( symbol );
	root.appendChild( quoteEl );
	root.appendChild( attr );
	container.appendChild( root );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {

	// Check if we already picked a quote today.
	const stored = ctx.storage.get< { date: string; quote: string; musician: string | null; version: string } >( 'daily' );
	const today  = todayKey();

	if ( stored && stored.date === today ) {
		render( container, stored.version, stored.musician, stored.quote );
		return () => undefined;
	}

	// Fetch the WP version and pick today's quote.
	try {
		const version  = await fetchWpVersion();
		const major    = majorVersion( version );
		const musician = WP_CODENAMES[ major ] ?? null;

		// Use today's date as a deterministic seed so everyone on
		// the same day sees the same quote — consistent, not random.
		const seed = parseInt( today.replace( /-/g, '' ), 10 );
		const quote = pickQuote( musician ?? '', seed );

		ctx.storage.set( 'daily', { date: today, quote, musician, version } );
		render( container, version, musician, quote );
	} catch {
		render( container, '', null, JAZZ_WISDOM[ 0 ] );
	}

	return () => undefined;
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
