import { joinRestUrl } from '../rest-url';
import { createFeatureClient } from '../core/api-client';
import type { Note } from './types';

export interface NotesRestDeps {
	baseUrl: string;
	nonce: string;
}

let deps: NotesRestDeps | null = null;

export function installNotesRestDeps( next: NotesRestDeps ): void {
	deps = next;
}

function ensureDeps(): NotesRestDeps {
	if ( ! deps ) {
		throw new Error(
			'[openstation] notes REST client called before installNotesRestDeps().',
		);
	}
	return deps;
}

function liveNonce( installed: string ): string {
	const cfg = (
		window as unknown as {
			openStationConfig?: { restNonce?: unknown };
		}
	).openStationConfig;
	return typeof cfg?.restNonce === 'string' && cfg.restNonce
		? cfg.restNonce
		: installed;
}

export class NotesConflictError extends Error {
	readonly status = 409;
	readonly current: Note | null;
	constructor( current: Note | null ) {
		super( 'Note was changed by another session.' );
		this.name = 'NotesConflictError';
		this.current = current;
	}
}

export function isNotesConflict( err: unknown ): err is NotesConflictError {
	return err instanceof NotesConflictError;
}

const call = createFeatureClient( {
	prefix: '[openstation] notes REST',
	source: 'desktop-mode/notes',

	url: ( path ) => {
		const { baseUrl } = ensureDeps();
		return path ? joinRestUrl( baseUrl, path ) : baseUrl;
	},
	nonce: () => liveNonce( ensureDeps().nonce ),
	conflict: ( body ) => {
		const current = ( body as { data?: { current?: Note } } | null )?.data?.current;
		return new NotesConflictError( current ?? null );
	},
} );

export function listNotes(): Promise< { notes: Note[] } > {
	return call< { notes: Note[] } >( '', { method: 'GET' } );
}

export interface CreateNoteBody {
	text: string;
	color: string;
	x: number;
	y: number;
	public: boolean;

	seed?: number;
}

export function createNote( body: CreateNoteBody ): Promise< Note > {
	return call< Note >( '', {
		method: 'POST',
		body: JSON.stringify( body ),
	} );
}

export interface UpdateNoteBody {
	text?: string;
	color?: string;
	x?: number;
	y?: number;
	z?: number;
	public?: boolean;

	updatedAtMs?: number;
}

export function updateNote( id: number, body: UpdateNoteBody ): Promise< Note > {
	return call< Note >( `/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
	} );
}

export function deleteNote( id: number ): Promise< { trashed: boolean; id: number } > {
	return call< { trashed: boolean; id: number } >( `/${ id }`, {
		method: 'DELETE',
	} );
}

export function restoreNote( id: number ): Promise< Note > {
	return call< Note >( `/${ id }/restore`, { method: 'POST' } );
}

export interface ConvertNoteResult {

	noteId: number;

	postId: number;

	editUrl: string;
}

export function convertNote( id: number ): Promise< ConvertNoteResult > {
	return call< ConvertNoteResult >( `/${ id }/convert`, { method: 'POST' } );
}

export function __resetNotesRestForTests(): void {
	deps = null;
}
