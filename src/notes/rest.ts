/**
 * OpenStation — Pinned notes REST client.
 *
 * `createFeatureClient()` against `includes/notes/rest.php`: nonce
 * header, JSON body, a typed 409 conflict error carrying the server's
 * current copy, every other failure a `RestError`.
 */

import { joinRestUrl } from '../rest-url';
import { createFeatureClient } from '../core/api-client';
import type { Note } from './types';

export interface NotesRestDeps {
	baseUrl: string;
	nonce: string;
}

let deps: NotesRestDeps | null = null;

/** Install REST deps. Called once from the notes boot path. */
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

/**
 * The nonce to send RIGHT NOW. The heartbeat nonce-refresh
 * (`src/nonce-refresh.ts`) rewrites `window.openStationConfig.restNonce`
 * in place when the 24h `nonce_life` boundary rolls over — a nonce
 * captured once at install time would go stale and 403 every note
 * operation in a long-lived session. Fall back to the installed value
 * (tests, headless contexts without the config global).
 */
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

/**
 * 409 — the note changed under this client. `current` is the server's
 * copy so the caller can re-render instead of clobbering.
 */
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

/**
 * Any other failure is a `RestError` (`src/core/api-client.ts`) whose
 * console line keeps the `[openstation] notes REST <status>: …` shape;
 * a 409 is a `NotesConflictError` carrying the server's copy.
 */
const call = createFeatureClient( {
	prefix: '[openstation] notes REST',
	source: 'desktop-mode/notes',
	// `baseUrl` is a full `rest_url( 'desktop-mode/v1/notes' )` — for
	// the collection routes (empty `path`) use it verbatim; joining an
	// empty path would append a trailing slash the WP route regex
	// (`^/desktop-mode/v1/notes$`) refuses to match.
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
	/**
	 * Creation-time jitter seed (see `hashNoteSeed` in motion.ts).
	 * Persisted once — the server never rewrites it on PATCH.
	 */
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
	/** Concurrency token from the last-seen server copy. */
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

/** Result of converting a note into a draft post. */
export interface ConvertNoteResult {
	/** The (now-trashed) source note id. */
	noteId: number;
	/** The new draft post id. */
	postId: number;
	/** Absolute admin edit URL for the draft (`post.php?post=…&action=edit`). */
	editUrl: string;
}

/**
 * Convert a note into a draft post. The server spawns the draft, trashes
 * the note, and links the two so `restoreNote` reverses both sides.
 */
export function convertNote( id: number ): Promise< ConvertNoteResult > {
	return call< ConvertNoteResult >( `/${ id }/convert`, { method: 'POST' } );
}

/** Test-only. */
export function __resetNotesRestForTests(): void {
	deps = null;
}
