import { Component, defineComponent, html } from '../../core';
import { styles } from './os-relative-time.styles';

const _instances = new Set< OsRelativeTime >();
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

function parseDatetime( raw: string | null ): Date | null {
	if ( ! raw ) {
		return null;
	}
	const tryDate = ( v: string ): Date | null => {
		const d = new Date( v );
		return Number.isNaN( d.getTime() ) ? null : d;
	};
	if ( hasTimezone( raw ) ) {
		return tryDate( raw );
	}

	return tryDate( raw.replace( ' ', 'T' ) + 'Z' );
}

function hasTimezone( raw: string ): boolean {
	const sep = Math.max( raw.indexOf( 'T' ), raw.indexOf( ' ' ) );
	const timePart = sep === -1 ? '' : raw.slice( sep + 1 );
	return /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test( timePart );
}

let _rtfCache: Intl.RelativeTimeFormat | null = null;
let _narrowRtfCache: Intl.RelativeTimeFormat | null = null;

function locale(): string {
	return ( typeof navigator !== 'undefined' && navigator.language ) || 'en';
}

function getRtf(): Intl.RelativeTimeFormat {
	if ( ! _rtfCache ) {
		_rtfCache = new Intl.RelativeTimeFormat( locale(), { numeric: 'auto' } );
	}
	return _rtfCache;
}

function getNarrowRtf(): Intl.RelativeTimeFormat {
	if ( ! _narrowRtfCache ) {
		_narrowRtfCache = new Intl.RelativeTimeFormat( locale(), {
			numeric: 'always',
			style: 'narrow',
		} );
	}
	return _narrowRtfCache;
}

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

function compactText( date: Date, now: number ): string {
	const diffSec = Math.round( ( date.getTime() - now ) / 1000 );
	const abs = Math.abs;
	if ( abs( diffSec ) < 45 ) {
		return getNarrowRtf().format( 0, 'second' );
	}

	if ( abs( diffSec ) > 7 * 24 * 60 * 60 ) {
		return date.toLocaleDateString( undefined, {
			month: 'short',
			day: 'numeric',
		} );
	}
	return relativeTextFrom( getNarrowRtf(), diffSec );
}

export class OsRelativeTime extends Component {
	static props = [ 'datetime', 'compact' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Relative time',
		summary:
			'Auto-ticking relative timestamp. Renders "5 minutes ago" / "yesterday" / "in 3 hours" via Intl.RelativeTimeFormat and updates itself every 30s while connected. Useful for any list cell that should age live (recycle bin, notifications, activity log) without forcing the surrounding view to repaint. Set `compact` for dense lists ("5m", "3h", "2d").',
		status: 'stable',
		props: [
			{
				name: 'datetime',
				type: 'ISO 8601 string; a value with no timezone designator is read as UTC',
				description:
					'The moment the relative copy is anchored to. Accepts what WordPress hands back from `*_gmt` columns directly. Pass the `*_gmt` variant — `date` and `date_gmt` share a shape but not a meaning, and a site-local value read as UTC is wrong by the site offset.',
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
		example: html`<os-relative-time
			datetime="${ new Date( Date.now() - 1000 * 60 * 5 ).toISOString() }"
		></os-relative-time>`,
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

	public tick(): void {
		this.requestUpdate();
	}

	protected render() {
		const raw = ( this as unknown as { datetime: string | null } ).datetime;
		const date = parseDatetime( raw );
		if ( ! date ) {
			return html`<span>${ raw ?? '' }</span>`;
		}
		const now = Date.now();
		const text = this.hasAttribute( 'compact' )
			? compactText( date, now )
			: relativeText( date, now );
		const absolute = date.toLocaleString();

		return html`<time datetime=${ date.toISOString() } title=${ absolute }
			>${ text }</time
		>`;
	}
}
defineComponent( 'os-relative-time', OsRelativeTime );
