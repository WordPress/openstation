/**
 * Desktop Mode — Jazz Quote Widget (lazy bundle).
 *
 * A love letter to WordPress's jazz musician release naming tradition.
 * Shows the current WP version, its jazz musician codename, and a
 * rotating daily quote from that musician.
 *
 * Version detection priority:
 *   1. window.desktopModeJazzQuote.wpVersion — inlined by PHP via the
 *      main shell payload (most reliable, no DOM scraping)
 *   2. <meta name="generator"> tag — present on most WP installs
 *   3. Falls back to jazz wisdom pool with no version shown
 *
 * Quotes rotate daily using a day-of-year seed so the index stays
 * bounded and all three quotes in a pool see roughly equal rotation.
 * Persisted in ctx.storage so it does not re-evaluate on every page load.
 *
 * @since 0.26.0
 */
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID = 'desktop-mode/jazz-quote';

// ---------------------------------------------------------------------------
// WordPress release → jazz musician map.
// Source: https://wordpress.org/documentation/article/learn-about-wordpress-and-version-history/
// Verified against official release announcements June 2026.
// Keys use unquoted numeric strings where valid — quote-props rule requires
// keys only be quoted when necessary (e.g. containing dots would need quotes,
// but the ESLint config here flags unnecessary quotes).
// ---------------------------------------------------------------------------
const WP_CODENAMES: Record< string, string > = {
	7.0: 'Louis Armstrong',
	6.9: 'Gene Harris',
	6.8: 'Cecil Taylor',
	6.7: 'Sonny Rollins',
	6.6: 'Tommy Dorsey',
	6.5: 'Regina Carter',
	6.4: 'Shirley Horn',
	6.3: 'Lionel Hampton',
	6.2: 'Eric Dolphy', // "Dolphy" — woodwind multi-instrumentalist
	6.1: 'Mikhail Alperin', // "Misha" — jazz pianist/composer (NOT Misha Dichter)
	6.0: 'Arturo O\'Farrill', // "Arturo" — Latin jazz pianist
	5.9: 'Joséphine Baker', // "Josephine"
	5.8: 'Art Tatum', // "Tatum"
	5.7: 'Esperanza Spalding', // "Esperanza"
	5.6: 'Nina Simone', // "Simone"
	5.5: 'Billy Eckstine', // "Eckstine"
	5.4: 'Nat Adderley', // "Adderley"
	5.3: 'Rahsaan Roland Kirk', // "Kirk"
	5.2: 'Jaco Pastorius', // "Jaco"
	5.1: 'Betty Carter', // "Betty"
	5.0: 'Bebo Valdés', // "Bebo"
};

// ---------------------------------------------------------------------------
// Quotes keyed by musician. Falls back to JAZZ_WISDOM for any missing entry.
// ---------------------------------------------------------------------------
const MUSICIAN_QUOTES: Record< string, string[] > = {
	'Louis Armstrong': [
		'If you have to ask what jazz is, you\'ll never know.',
		'Musicians don\'t retire; they stop when there\'s no more music in them.',
		'All music is folk music. I ain\'t never heard a horse sing a song.',
	],
	'Gene Harris': [
		'Play from your heart and the rest will follow.',
		'The blues is the roots; everything else is the fruits.',
		'Swing is a feeling, not a formula.',
	],
	'Cecil Taylor': [
		'Music has to do with a lot of areas which are magical rather than logical.',
		'The piano is a vehicle by which I can express my spirit.',
		'I try to imitate on the piano the leaping of a plant.',
	],
	'Sonny Rollins': [
		'Jazz is not just music — it\'s a way of life.',
		'If you\'re not making a mistake, it\'s a mistake.',
		'Playing is the easiest way for me to communicate with other people.',
	],
	'Tommy Dorsey': [
		'A real pro is someone who does their best work even when they don\'t feel like it.',
		'Make it swing and the people will follow.',
		'The trombone is the voice of the orchestra.',
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
	'Eric Dolphy': [
		'When you hear music, after it\'s over, it\'s gone in the air. You can never capture it again.',
		'I play a little different on each instrument.',
		'Music is a reflection of everything — and that includes all kinds of beauty.',
	],
	'Mikhail Alperin': [
		'Music is about finding your own voice, not someone else\'s.',
		'Silence is part of music — the space between notes is where meaning lives.',
		'Every note I play comes from somewhere inside that I cannot explain.',
	],
	'Arturo O\'Farrill': [
		'Latin jazz is the only truly American music.',
		'Music is the universal language — and jazz is its most democratic dialect.',
		'My job is to swing hard and think deep.',
	],
	'Joséphine Baker': [
		'The most beautiful thing in the world is freedom.',
		'I improvised, caricatured, and made people laugh.',
		'One word frees us of all the weight and pain of life — that word is love.',
	],
	'Art Tatum': [
		'I\'m always trying to do things differently.',
		'The piano is a complete orchestra.',
		'Speed is nothing without control.',
	],
	'Nina Simone': [
		'Jazz is not just music — it\'s life.',
		'I\'ll tell you what freedom is to me: no fear.',
		'You\'ve got to learn to leave the table when love\'s no longer being served.',
	],
	'Esperanza Spalding': [
		'Music is a living thing.',
		'I want to create something that is beyond genre.',
		'A song is a conversation between the singer and the listener.',
	],
	'Bebo Valdés': [
		'Cuban music is the most complete in the world.',
		'You play with what you have, and you make it beautiful.',
		'Music is the bridge between where you are and where you want to be.',
	],
};

// General jazz wisdom — shown when the version has no entry in the map.
const JAZZ_WISDOM = [
	'Do not fear mistakes — there are none. — Miles Davis',
	'Man, if you gotta ask, you\'ll never know. — Louis Armstrong',
	'There are no wrong notes in jazz: only notes in the wrong places. — Miles Davis',
	'Music is your own experience, your thoughts, your wisdom. If you don\'t live it, it won\'t come out of your horn. — Charlie Parker',
	'You can play a shoestring if you\'re sincere. — John Coltrane',
	'Jazz is the music of the body. — Anita O\'Day',
	'I\'m always thinking about creating. My future starts when I wake up every morning. — Miles Davis',
	'It takes a long time to play like yourself. — Miles Davis',
	'Don\'t play what\'s there — play what\'s not there. — Miles Davis',
];

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

declare global {
	interface Window {
		desktopModeJazzQuote?: { wpVersion?: string };
	}
}

function detectWpVersion(): string | null {
	// Priority 1: PHP-inlined global via main shell payload.
	const inlined = window.desktopModeJazzQuote?.wpVersion;
	if ( inlined && /^\d+\.\d+/.test( inlined ) ) {
		return inlined;
	}

	// Priority 2: Generator meta tag (present unless a security plugin strips it).
	const meta = document.querySelector< HTMLMetaElement >( 'meta[name="generator"]' );
	const match = meta?.content?.match( /WordPress ([\d.]+)/ );
	if ( match ) {
		return match[ 1 ];
	}

	return null;
}

function majorVersion( version: string ): string {
	return version.split( '.' ).slice( 0, 2 ).join( '.' );
}

function todayKey(): string {
	return new Date().toISOString().slice( 0, 10 );
}

/**
 * Day-of-year seed: 1–366. Stays bounded so modulo against small
 * pool sizes (3 quotes) gives even rotation across the year.
 */
function dayOfYearSeed(): number {
	const now = new Date();
	const start = new Date( now.getFullYear(), 0, 0 );
	const diff = now.getTime() - start.getTime();
	return Math.floor( diff / 86_400_000 );
}

function pickQuote( musician: string | null ): string {
	const pool = musician ? ( MUSICIAN_QUOTES[ musician ] ?? JAZZ_WISDOM ) : JAZZ_WISDOM;
	return pool[ dayOfYearSeed() % pool.length ];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(
	container: HTMLElement,
	version: string | null,
	musician: string | null,
	quote: string,
): void {
	container.innerHTML = '';

	const root = document.createElement( 'div' );
	root.className = 'dm-jazz';

	const symbol = document.createElement( 'div' );
	symbol.className = 'dm-jazz__symbol';
	symbol.setAttribute( 'aria-hidden', 'true' );
	symbol.textContent = '\u266B';

	const quoteEl = document.createElement( 'blockquote' );
	quoteEl.className = 'dm-jazz__quote';
	quoteEl.textContent = quote;

	const attr = document.createElement( 'div' );
	attr.className = 'dm-jazz__attr';

	if ( musician ) {
		const nameEl = document.createElement( 'span' );
		nameEl.className = 'dm-jazz__musician';
		nameEl.textContent = musician;
		attr.appendChild( nameEl );
	}

	if ( version ) {
		const wpEl = document.createElement( 'span' );
		wpEl.className = 'dm-jazz__version';
		wpEl.textContent = 'WordPress ' + version + ( musician ? '' : ' — jazz wisdom' );
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
	type Stored = { date: string; quote: string; musician: string | null; version: string | null };
	const stored = ctx.storage.get< Stored >( 'daily' );
	const today = todayKey();

	if ( stored && stored.date === today ) {
		render( container, stored.version, stored.musician, stored.quote );
		return () => undefined;
	}

	const version = detectWpVersion();
	const major = version ? majorVersion( version ) : null;
	const musician = major ? ( WP_CODENAMES[ major ] ?? null ) : null;
	const quote = pickQuote( musician );

	ctx.storage.set( 'daily', { date: today, quote, musician, version } );
	render( container, version, musician, quote );

	return () => undefined;
};

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
