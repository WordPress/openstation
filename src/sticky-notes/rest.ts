import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import {
	DEFAULT_STICKY_TITLE,
	noteComponentsForBody,
	noteFromGuideline,
} from './text';
import type {
	RestGuidelineTerm,
	RestStickyGuideline,
	StickyNote,
	StickyTerms,
} from './types';

export interface StickyNotesRestConfig {
	restUrl?: string;
	adminUrl: string;
}

export class StickyNotesRestError extends Error {
	status: number;

	constructor( message: string, status: number ) {
		super( message );
		this.name = 'StickyNotesRestError';
		this.status = status;
	}
}

export async function resolveStickyTerms(
	config: StickyNotesRestConfig,
): Promise< StickyTerms | null > {
	const terms = await fetchStickyTermCandidates( config );
	const picked = pickStickyTerms(
		[ ...terms.artifactTerms, ...terms.artifactsTerms ],
		terms.noteTerms,
		terms.stickyTerms,
	);
	if ( picked ) {
		return picked;
	}

	const artifact = await ensureTerm( config, {
		slug: 'artifact',
		name: 'Artifact',
		parent: 0,
	} );
	const note = await ensureTerm( config, {
		slug: 'note',
		name: 'Note',
		parent: artifact.id,
	} );
	const sticky = await ensureTerm( config, {
		slug: 'sticky',
		name: 'Sticky',
		parent: artifact.id,
	} );
	return {
		stickyTermId: sticky.id,
		termIds: uniqueNumbers( [ artifact.id, note.id, sticky.id ] ),
	};
}

async function fetchStickyTermCandidates(
	config: StickyNotesRestConfig,
): Promise< {
	artifactTerms: RestGuidelineTerm[];
	artifactsTerms: RestGuidelineTerm[];
	noteTerms: RestGuidelineTerm[];
	stickyTerms: RestGuidelineTerm[];
} > {
	const [ artifactTerms, artifactsTerms, noteTerms, stickyTerms ] =
		await Promise.all( [
			fetchTermsBySlug( config, 'artifact' ),
			fetchTermsBySlug( config, 'artifacts' ),
			fetchTermsBySlug( config, 'note' ),
			fetchTermsBySlug( config, 'sticky' ),
		] );
	return {
		artifactTerms,
		artifactsTerms,
		noteTerms,
		stickyTerms,
	};
}

export function pickStickyTerms(
	artifactTerms: RestGuidelineTerm[],
	noteTerms: RestGuidelineTerm[],
	stickyTerms: RestGuidelineTerm[],
): StickyTerms | null {
	if ( stickyTerms.length === 0 ) {
		return null;
	}
	const artifact = artifactTerms.find( ( term ) =>
		[ 'artifact', 'artifacts' ].includes( term.slug ),
	) ?? artifactTerms[ 0 ] ?? null;
	const sticky = artifact
		? stickyTerms.find( ( term ) => Number( term.parent ) === artifact.id ) ??
			stickyTerms[ 0 ]
		: stickyTerms[ 0 ];
	if ( ! sticky ) {
		return null;
	}
	const note = artifact
		? noteTerms.find( ( term ) => Number( term.parent ) === artifact.id ) ??
			null
		: null;
	return {
		stickyTermId: sticky.id,
		termIds: uniqueNumbers( [
			artifact?.id,
			note?.id,
			sticky.id,
		] ),
	};
}

export async function fetchStickyNotes(
	config: StickyNotesRestConfig,
	stickyTermId: number,
): Promise< StickyNote[] > {
	const guidelines = await requestJson< RestStickyGuideline[] >(
		config,
		pathWithQuery( 'wp/v2/guidelines', {
			context: 'edit',
			status: 'private',
			per_page: '100',
			orderby: 'modified',
			order: 'desc',
			wp_guideline_type: String( stickyTermId ),
		} ),
		undefined,
		true,
	);
	return guidelines
		.filter( ( guideline ) =>
			Array.isArray( guideline.wp_guideline_type )
				? guideline.wp_guideline_type.includes( stickyTermId )
				: true,
		)
		.map( noteFromGuideline );
}

export async function saveStickyNote(
	config: StickyNotesRestConfig,
	note: StickyNote,
	terms: StickyTerms,
): Promise< StickyNote > {
	const components = noteComponentsForBody( note.body, note.title );
	const payload: Record< string, unknown > = {
		status: 'private',
		title: components.title,
		content: components.content,
		excerpt: components.excerpt,
	};
	if ( note.guidelineId === null ) {
		payload.wp_guideline_type = terms.termIds;
	}
	const path = note.guidelineId === null
		? 'wp/v2/guidelines'
		: `wp/v2/guidelines/${ note.guidelineId }`;
	const guideline = await requestJson< RestStickyGuideline >(
		config,
		path,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( payload ),
		},
		false,
	);
	return noteFromGuideline( guideline );
}

export function buildGuidelineEditUrl(
	adminUrl: string,
	guidelineId: number,
): string {
	const url = new URL( 'post.php', adminUrl );
	url.searchParams.set( 'post', String( guidelineId ) );
	url.searchParams.set( 'action', 'edit' );
	return url.toString();
}

async function fetchTermsBySlug(
	config: StickyNotesRestConfig,
	slug: string,
): Promise< RestGuidelineTerm[] > {
	try {
		return await requestJson< RestGuidelineTerm[] >(
			config,
			pathWithQuery( 'wp/v2/wp_guideline_type', {
				context: 'edit',
				slug,
				per_page: '100',
			} ),
			undefined,
			true,
		);
	} catch ( error ) {
		if (
			error instanceof StickyNotesRestError &&
			( error.status === 404 || error.status === 400 )
		) {
			return [];
		}
		throw error;
	}
}

async function ensureTerm(
	config: StickyNotesRestConfig,
	term: { slug: string; name: string; parent: number },
): Promise< RestGuidelineTerm > {
	const existing = await fetchTermsBySlug( config, term.slug );
	const byParent = existing.find(
		( item ) => Number( item.parent ?? 0 ) === term.parent,
	);
	if ( byParent ) {
		return byParent;
	}
	if ( existing[ 0 ] ) {
		return existing[ 0 ];
	}
	try {
		return await requestJson< RestGuidelineTerm >(
			config,
			'wp/v2/wp_guideline_type',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify( term ),
			},
			true,
		);
	} catch ( error ) {
		const fallback = await fetchTermsBySlug( config, term.slug );
		if ( fallback[ 0 ] ) {
			return fallback[ 0 ];
		}
		throw error;
	}
}

async function requestJson< T >(
	config: StickyNotesRestConfig,
	path: string,
	init?: RequestInit,
	silent = true,
): Promise< T > {
	const response = await trackedFetch(
		joinRestUrl( restRoot( config ), path ),
		init,
		{
			source: 'desktop-mode/sticky-notes',
			silent,
		},
	);
	if ( ! response.ok ) {
		throw new StickyNotesRestError(
			response.statusText || `${ DEFAULT_STICKY_TITLE } request failed`,
			response.status,
		);
	}
	return await response.json() as T;
}

function restRoot( config: StickyNotesRestConfig ): string {
	if ( config.restUrl ) {
		return config.restUrl;
	}
	return `${ window.location.origin }/wp-json/`;
}

function pathWithQuery(
	path: string,
	query: Record< string, string >,
): string {
	const params = new URLSearchParams();
	Object.entries( query ).forEach( ( [ key, value ] ) => {
		params.set( key, value );
	} );
	return `${ path }?${ params.toString() }`;
}

function uniqueNumbers( values: Array< number | undefined > ): number[] {
	const out: number[] = [];
	values.forEach( ( value ) => {
		if (
			typeof value === 'number' &&
			Number.isFinite( value ) &&
			! out.includes( value )
		) {
			out.push( value );
		}
	} );
	return out;
}
