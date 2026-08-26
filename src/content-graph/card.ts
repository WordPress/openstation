/**
 * Content Graph — node card copy.
 *
 * The text a node's card carries: a title that can wrap, and one
 * muted meta line naming what the post is. Pure string helpers so the
 * copy rules (what goes on the meta line, in what order, what a
 * non-public status is called) are testable without Pixi; the scene
 * measures and paints the result.
 *
 * @public
 */

import { __ } from '../i18n';
import { decodeHTML } from '../utils';

/**
 * Title cap in characters. At the card's 12px semibold and ~170px of
 * text width this is two full lines; the third line is what the cap
 * prevents for the rare very long title, so every card stays the
 * same height class and a small board reads as a row of cards
 * rather than a stack of paragraphs.
 */
export const CARD_TITLE_MAX_CHARS = 56;

/** Separator between meta parts, matching the toolbar's status line. */
export const CARD_META_SEPARATOR = ' · ';

export function truncate( text: string, max: number ): string {
	if ( text.length <= max ) {
		return text;
	}
	return text.slice( 0, max - 1 ).trimEnd() + '…';
}

/**
 * Card title: the decoded post title, or `#id` for an untitled post,
 * capped at {@link CARD_TITLE_MAX_CHARS}.
 */
export function cardTitle( rawTitle: string, id: number ): string {
	return truncate( decodeHTML( rawTitle ) || `#${ id }`, CARD_TITLE_MAX_CHARS );
}

/**
 * Human label for a post status that is not plain `publish`. The
 * graph only ever ships published and (readable) private posts, but
 * the map covers the other core statuses so a filtered-in draft is
 * named rather than silently passed off as published.
 */
export function statusLabel( status: string ): string {
	switch ( status ) {
		case 'private':
			return __( 'Private' );
		case 'draft':
			return __( 'Draft' );
		case 'pending':
			return __( 'Pending' );
		case 'future':
			return __( 'Scheduled' );
		default:
			return '';
	}
}

export interface CardMetaParts {
	/** Singular post-type label ("Post", "Page"). */
	typeLabel: string;
	/** Display name of the author, if the catalog knows it. */
	author?: string;
	/** `'YYYY-MM'` from the payload; formatted via {@link formatYearMonth}. */
	yearMonth?: string;
	/** Post status; only non-`publish` statuses are shown. */
	status?: string;
}

/**
 * Meta line parts in display order: status (when not published),
 * type, author, month. Returned as a list so the scene can drop the
 * author when the line would overflow the card and re-join.
 */
export function cardMetaParts( parts: CardMetaParts ): string[] {
	const out: string[] = [];
	const status = statusLabel( parts.status ?? '' );
	if ( status ) {
		out.push( status );
	}
	if ( parts.typeLabel ) {
		out.push( parts.typeLabel );
	}
	if ( parts.author ) {
		out.push( parts.author );
	}
	const month = parts.yearMonth ? formatYearMonth( parts.yearMonth ) : '';
	if ( month ) {
		out.push( month );
	}
	return out;
}

export function joinMeta( parts: string[] ): string {
	return parts.join( CARD_META_SEPARATOR );
}

/**
 * `'2024-03'` → `'Mar 2024'` in the viewer's locale. Anything that
 * isn't a `YYYY-MM` token is returned untouched, so an unexpected
 * payload value degrades to itself rather than to "Invalid Date".
 */
export function formatYearMonth( token: string ): string {
	const m = /^(\d{4})-(\d{2})$/.exec( token );
	if ( ! m ) {
		return token;
	}
	const monthIdx = Number( m[ 2 ] ) - 1;
	if ( monthIdx < 0 || monthIdx > 11 ) {
		return token;
	}
	const year = Number( m[ 1 ] );
	try {
		const d = new Date( Date.UTC( year, monthIdx, 1 ) );
		return new Intl.DateTimeFormat( undefined, {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC',
		} ).format( d );
	} catch {
		return token;
	}
}
