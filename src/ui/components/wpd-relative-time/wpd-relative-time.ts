/**
 * `<wpd-relative-time>` — auto-ticking relative timestamp.
 *
 * Renders "5 minutes ago" / "yesterday" / "in 3 hours" via
 * `Intl.RelativeTimeFormat` and updates itself on a shared
 * 30-second ticker so a long-lived UI (the Recycle Bin window,
 * a notifications widget, a log view) shows accurate copy
 * without asking the consumer to plumb a refresh.
 *
 * Usage:
 *
 *   <wpd-relative-time datetime="2026-04-28T13:00:00Z"></wpd-relative-time>
 *   → "5 minutes ago"
 *
 * Accepts ISO 8601 (`2026-04-28T13:00:00Z`) or MySQL-style
 * (`2026-04-28 13:00:00`) input; the latter is treated as UTC,
 * which matches WordPress's `*_gmt` columns.
 *
 * The pointer tooltip (`title`) carries the absolute, locale-
 * formatted datetime so users can always reach the precise
 * timestamp without losing the at-a-glance relative copy.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-relative-time.styles';

/**
 * Single ticker shared by every mounted instance. We use one
 * `setInterval` instead of per-instance timers so 100 visible
 * relative-time elements cost one tick, not 100. The interval is
 * armed only while at least one element is connected and torn
 * down again the moment the DOM goes empty.
 */
const _instances = new Set< WpdRelativeTime >();
let _ticker: number | null = null;

const TICK_INTERVAL_MS = 30_000;

function startTicker(): void {
	if ( _ticker !== null ) {
		return;
	}
	_ticker = window.setInterval( () => {
		for ( const i of _instances ) {
			i.tick();
		}
	}, TICK_INTERVAL_MS );
}

function stopTickerIfIdle(): void {
	if ( _ticker !== null && _instances.size === 0 ) {
		window.clearInterval( _ticker );
		_ticker = null;
	}
}

/**
 * Parse the `datetime` attribute. ISO 8601 is preferred; we also
 * accept the MySQL-flavoured `Y-m-d H:i:s` PHP hands us from
 * `*_gmt` columns. Anything unparseable returns `null`.
 */
function parseDatetime( raw: string | null ): Date | null {
	if ( ! raw ) {
		return null;
	}
	const tryDate = ( v: string ): Date | null => {
		const d = new Date( v );
		return Number.isNaN( d.getTime() ) ? null : d;
	};
	if ( raw.includes( 'T' ) || raw.endsWith( 'Z' ) ) {
		return tryDate( raw );
	}
	// MySQL "Y-m-d H:i:s" → ISO 8601 UTC.
	return tryDate( raw.replace( ' ', 'T' ) + 'Z' );
}

/** Lazily-built formatter — Intl objects are non-trivial to construct. */
let _rtfCache: Intl.RelativeTimeFormat | null = null;
let _narrowRtfCache: Intl.RelativeTimeFormat | null = null;

function locale(): string {
	return ( typeof navigator !== 'undefined' && navigator.language ) || 'en';
}

function getRtf(): Intl.RelativeTimeFormat {
	if ( ! _rtfCache ) {
		// `numeric: 'auto'` produces "yesterday" / "tomorrow" /
		// "last week" instead of "1 day ago" / "in 1 week" — much
		// closer to what humans actually say.
		_rtfCache = new Intl.RelativeTimeFormat( locale(), { numeric: 'auto' } );
	}
	return _rtfCache;
}

/**
 * Narrow-style formatter for `compact`. `numeric: 'always'` here on
 * purpose: "yesterday" is longer than "1d" and defeats the point of
 * the compact form.
 */
function getNarrowRtf(): Intl.RelativeTimeFormat {
	if ( ! _narrowRtfCache ) {
		_narrowRtfCache = new Intl.RelativeTimeFormat( locale(), {
			numeric: 'always',
			style: 'narrow',
		} );
	}
	return _narrowRtfCache;
}

/**
 * Bucket the diff into the largest unit that fits. Mirrors how
 * humans read time: "a few seconds" → "5 minutes" → "2 hours" →
 * "yesterday" → "3 weeks" → "a year", picking the unit so the
 * count stays small.
 */
function relativeText( date: Date, now: number ): string {
	const rtf = getRtf();
	const diffMs = date.getTime() - now;
	const diffSec = Math.round( diffMs / 1000 );
	const abs = Math.abs;

	if ( abs( diffSec ) < 45 ) {
		return rtf.format( 0, 'second' );
	}
	return relativeTextFrom( rtf, diffSec );
}

/** Shared bucketing for the long form, split out so `compact` reuses it. */
function relativeTextFrom(
	rtf: Intl.RelativeTimeFormat,
	diffSec: number,
): string {
	const abs = Math.abs;
	const diffMin = Math.round( diffSec / 60 );
	if ( abs( diffMin ) < 45 ) {
		return rtf.format( diffMin, 'minute' );
	}
	const diffHour = Math.round( diffMin / 60 );
	if ( abs( diffHour ) < 22 ) {
		return rtf.format( diffHour, 'hour' );
	}
	const diffDay = Math.round( diffHour / 24 );
	if ( abs( diffDay ) < 26 ) {
		return rtf.format( diffDay, 'day' );
	}
	const diffMonth = Math.round( diffDay / 30 );
	if ( abs( diffMonth ) < 11 ) {
		return rtf.format( diffMonth, 'month' );
	}
	const diffYear = Math.round( diffDay / 365 );
	return rtf.format( diffYear, 'year' );
}

/**
 * Compact form for dense lists — "now", "5m", "3h", "2d", then a
 * locale short date once the age passes a week.
 *
 * Uses `Intl.RelativeTimeFormat` with `style: 'narrow'`, so the
 * abbreviations are the ones the user's locale actually uses rather
 * than English initials pasted into a `sprintf`. Locales with no
 * narrow form fall back to their short form automatically.
 */
function compactText( date: Date, now: number ): string {
	const diffSec = Math.round( ( date.getTime() - now ) / 1000 );
	const abs = Math.abs;
	if ( abs( diffSec ) < 45 ) {
		return getNarrowRtf().format( 0, 'second' );
	}
	// Past a week the relative reading stops being useful in a narrow
	// cell ("7w" vs "13w" reads as noise) — a short date is denser
	// AND more informative.
	if ( abs( diffSec ) > 7 * 24 * 60 * 60 ) {
		return date.toLocaleDateString( undefined, {
			month: 'short',
			day: 'numeric',
		} );
	}
	return relativeTextFrom( getNarrowRtf(), diffSec );
}

export class WpdRelativeTime extends Component {
	static props = [ 'datetime', 'compact' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Relative time',
		summary:
			'Auto-ticking relative timestamp. Renders "5 minutes ago" / "yesterday" / "in 3 hours" via Intl.RelativeTimeFormat and updates itself every 30s while connected. Useful for any list cell that should age live (recycle bin, notifications, activity log) without forcing the surrounding view to repaint. Set `compact` for dense lists ("5m", "3h", "2d").',
		status: 'experimental',
		since: '0.6.0',
		props: [
			{
				name: 'datetime',
				type: 'ISO 8601 string OR MySQL-style "Y-m-d H:i:s" (treated as UTC)',
				description:
					'The moment the relative copy is anchored to. Accepts the format WordPress hands back from `*_gmt` columns directly.',
			},
			{
				name: 'compact',
				type: 'boolean attribute',
				description:
					'Abbreviated form for narrow cells — "now", "5m", "3h", "2d", then a short date past a week. Uses the locale\'s own narrow units, not English initials. The absolute timestamp stays in the title either way.',
			},
		],
		slots: [],
		cssProps: [],
		example: html`<wpd-relative-time
			datetime="${ new Date( Date.now() - 1000 * 60 * 5 ).toISOString() }"
		></wpd-relative-time>`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		_instances.add( this );
		startTicker();
	}

	disconnectedCallback(): void {
		_instances.delete( this );
		stopTickerIfIdle();
	}

	/** Public — the shared ticker calls this on every interval. */
	public tick(): void {
		this.requestUpdate();
	}

	protected render() {
		const raw = ( this as unknown as { datetime: string | null } ).datetime;
		const date = parseDatetime( raw );
		if ( ! date ) {
			// Show the raw string verbatim so a malformed input is
			// visible rather than silently rendering empty.
			return html`<span>${ raw ?? '' }</span>`;
		}
		const now = Date.now();
		const text = this.hasAttribute( 'compact' )
			? compactText( date, now )
			: relativeText( date, now );
		const absolute = date.toLocaleString();
		// Native `<time>` element with a typed `datetime` attribute
		// — search engines, accessibility tools, and copy-paste
		// flows all benefit from machine-readable timestamps.
		return html`<time datetime=${ date.toISOString() } title=${ absolute }
			>${ text }</time
		>`;
	}
}
defineComponent( 'wpd-relative-time', WpdRelativeTime );
