/**
 * Desktop Mode — Pinned notes REST client.
 *
 * Thin `trackedFetch` wrapper against `includes/notes/rest.php`.
 * Same conventions as the files client (`src/desktop-files/rest.ts`):
 * nonce header, JSON body, typed 409 conflict error carrying the
 * server's current copy.
 */

import { trackedFetch } from '../tracked-fetch';
import { joinRestUrl } from '../rest-url';
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
			'[desktop-mode] notes REST client called before installNotesRestDeps().',
		);
	}
	return deps;
}

/**
 * The nonce to send RIGHT NOW. The heartbeat nonce-refresh
 * (`src/nonce-refresh.ts`) rewrites `window.desktopModeConfig.restNonce`
 * in place when the 24h `nonce_life` boundary rolls over — a nonce
 * captured once at install time would go stale and 403 every note
 * operation in a long-lived session. Fall back to the installed value
 * (tests, headless contexts without the config global).
 */
function liveNonce( installed: string ): string {
	const cfg = (
		window as unknown as {
			desktopModeConfig?: { restNonce?: unknown };
		}
	).desktopModeConfig;
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

async function call< T >( path: string, init: RequestInit ): Promise< T > {
	const { baseUrl, nonce } = ensureDeps();
	// `baseUrl` is a full `rest_url( 'desktop-mode/v1/notes' )` — for
	// the collection routes (empty `path`) use it verbatim; joining an
	// empty path would append a trailing slash the WP route regex
	// (`^/desktop-mode/v1/notes$`) refuses to match.
	const url = path ? joinRestUrl( baseUrl, path ) : baseUrl;
	const headers = new Headers( init.headers ?? {} );
	headers.set( 'X-WP-Nonce', liveNonce( nonce ) );
	if ( init.body && ! headers.has( 'Content-Type' ) ) {
		headers.set( 'Content-Type', 'application/json' );
	}
	const res = await trackedFetch(
		url,
		{ ...init, headers, credentials: 'same-origin' },
		{ source: 'desktop-mode/notes' },
	);
	const text = await res.text();
	let body: unknown = null;
	if ( text ) {
		try {
			body = JSON.parse( text );
		} catch {
			body = null;
		}
	}
	if ( ! res.ok ) {
		if ( res.status === 409 ) {
			const current = ( body as { data?: { current?: Note } } | null )
				?.data?.current;
			throw new NotesConflictError( current ?? null );
		}
		const err = body as { code?: string; message?: string } | null;
		throw new Error(
			`[desktop-mode] notes REST ${ res.status }: ${ err?.code ?? '' } ${ err?.message ?? '' }`.trim(),
		);
	}
	if ( null === body ) {
		throw new Error(
			`[desktop-mode] notes REST ${ res.status }: empty or unparseable body.`,
		);
	}
	return body as T;
}

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
