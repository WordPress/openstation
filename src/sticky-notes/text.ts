import type {
	RestStickyGuideline,
	RestTextField,
	StickyNote,
} from './types';

export const DEFAULT_STICKY_TITLE = 'Sticky Note';

const LEGACY_METADATA_PREFIX = '<!-- wpworkspace-sticky:';
const LEGACY_METADATA_SUFFIX = '-->';
const TITLE_MAX = 64;
const GENERATED_TITLE_MAX = 48;
const EXCERPT_MAX = 180;

export function noteFromGuideline(
	guideline: RestStickyGuideline,
): StickyNote {
	const title = titleField( guideline.title );
	const content = removeLegacyMetadataComment(
		textFieldValue( guideline.content, { stripHtmlForRendered: true } ),
	);
	const modifiedMs = modifiedTimeMs( guideline );
	return {
		localId: `guideline:${ guideline.id }`,
		guidelineId: guideline.id,
		title,
		body: editorBody( title, content ),
		modified: guideline.modified,
		...( modifiedMs > 0 ? { modifiedMs } : {} ),
		link: guideline.link,
		termIds: Array.isArray( guideline.wp_guideline_type )
			? guideline.wp_guideline_type.filter( isFiniteNumber )
			: [],
	};
}

export function titleField( field: RestTextField ): string {
	const candidates: string[] = [];
	if ( typeof field === 'string' ) {
		candidates.push( field );
	} else if ( field && typeof field === 'object' ) {
		if ( typeof field.raw === 'string' ) {
			candidates.push( field.raw );
		}
		if ( typeof field.rendered === 'string' ) {
			candidates.push( stripHtml( field.rendered ) );
		}
	}
	for ( const candidate of candidates ) {
		const trimmed = stripHtml( candidate ).trim();
		if ( trimmed ) {
			return trimmed;
		}
	}
	return DEFAULT_STICKY_TITLE;
}

export function textFieldValue(
	field: RestTextField,
	options: { stripHtmlForRendered?: boolean } = {},
): string {
	if ( typeof field === 'string' ) {
		return field;
	}
	if ( ! field || typeof field !== 'object' ) {
		return '';
	}
	if ( typeof field.raw === 'string' && field.raw.length > 0 ) {
		return field.raw;
	}
	if ( typeof field.rendered === 'string' ) {
		return options.stripHtmlForRendered
			? stripHtml( field.rendered )
			: field.rendered;
	}
	return '';
}

export function titleForBody( body: string ): string {
	const line = body
		.split( /\r?\n/ )
		.find( ( item ) => item.trim().length > 0 )
		?.trim();
	const title = line && line.length > 0 ? line : DEFAULT_STICKY_TITLE;
	return truncate( title, TITLE_MAX );
}

export function generatedTitle( body: string ): string {
	const collapsed = body.replace( /\s+/g, ' ' ).trim();
	const title = collapsed || DEFAULT_STICKY_TITLE;
	return truncate( title, GENERATED_TITLE_MAX );
}

export function editorBody( title: string, content: string ): string {
	const trimmedTitle = title.trim();
	if ( ! trimmedTitle ) {
		return content;
	}
	const firstLine = content.split( /\r?\n/ )[ 0 ]?.trim();
	if ( firstLine === trimmedTitle ) {
		return content;
	}
	if ( ! content ) {
		return trimmedTitle;
	}
	return `${ trimmedTitle }\n${ content }`;
}

export interface StickyNoteComponents {
	title: string;
	content: string;
	excerpt: string;
}

export function noteComponentsForBody(
	editorValue: string,
	fallbackTitle: string = DEFAULT_STICKY_TITLE,
): StickyNoteComponents {
	const fallback = fallbackTitle.trim() || DEFAULT_STICKY_TITLE;
	const title = titleForBody( editorValue );
	const firstNewline = editorValue.search( /\r?\n/ );
	if ( firstNewline === -1 ) {
		const resolvedTitle = title === DEFAULT_STICKY_TITLE ? fallback : title;
		return {
			title: resolvedTitle,
			content: '',
			excerpt: excerptFor( resolvedTitle ),
		};
	}
	let content = editorValue.slice( firstNewline );
	content = content.replace( /^\r?\n/, '' );
	if ( content.startsWith( '\n' ) ) {
		content = content.slice( 1 );
	}
	return {
		title,
		content,
		excerpt: excerptFor( content.trim() ? content : title ),
	};
}

export function excerptFor( body: string ): string {
	const collapsed = body.replace( /[\n\t]+/g, ' ' ).trim();
	return truncate( collapsed, EXCERPT_MAX );
}

export function removeLegacyMetadataComment( content: string ): string {
	if (
		! content.startsWith( LEGACY_METADATA_PREFIX ) ||
		! content.includes( LEGACY_METADATA_SUFFIX )
	) {
		return content;
	}
	const end = content.indexOf( LEGACY_METADATA_SUFFIX );
	let body = content.slice( end + LEGACY_METADATA_SUFFIX.length );
	if ( body.startsWith( '\r\n' ) ) {
		body = body.slice( 2 );
	} else if ( body.startsWith( '\n' ) ) {
		body = body.slice( 1 );
	}
	return body;
}

function stripHtml( value: string ): string {
	if ( typeof document !== 'undefined' ) {
		const template = document.createElement( 'template' );
		template.innerHTML = value;
		return ( template.content.textContent ?? '' ).trim();
	}
	return value.replace( /<[^>]*>/g, '' ).trim();
}

function truncate( value: string, max: number ): string {
	return value.length > max ? `${ value.slice( 0, max ) }...` : value;
}

function modifiedTimeMs( guideline: RestStickyGuideline ): number {
	if (
		typeof guideline.open_station_modified_ms === 'number' &&
		Number.isFinite( guideline.open_station_modified_ms )
	) {
		return guideline.open_station_modified_ms;
	}
	if ( ! guideline.modified ) {
		return 0;
	}
	const parsed = Date.parse( guideline.modified );
	return Number.isFinite( parsed ) ? parsed : 0;
}

function isFiniteNumber( value: unknown ): value is number {
	return typeof value === 'number' && Number.isFinite( value );
}
