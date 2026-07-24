/**
 * Desktop Mode — Pinned notes types.
 *
 * The wire shape mirrors `desktop_mode_notes_prepare()` in
 * `includes/notes/rest.php`; the drag payload data shapes are the
 * cross-bundle contract between the Note Pad widget (its own IIFE
 * bundle) and the notes layer (main bundle). Only PLAIN DATA crosses
 * that boundary — the widget imports nothing but types from here.
 *
 * @since 0.9.6
 */

/** Wire shape of one note. */
export interface Note {
	id: number;
	text: string;
	color: string;
	/** Normalized 0–1 position of the note's top-left in the desktop area. */
	x: number;
	y: number;
	z: number;
	public: boolean;
	/**
	 * Jitter seed: hashed from the note's text ONCE at creation and
	 * persisted — edits never re-tilt a note. Drives the subtle
	 * per-note paper rotation + pin offset/twist.
	 */
	seed: number;
	ownerId: number;
	ownerName: string;
	ownerAvatar: string;
	canEdit: boolean;
	/** Concurrency token — echo back verbatim on PATCH. */
	updatedAtMs: number;
}

/**
 * DragPayload `type` slugs. `'note-draft'` = a not-yet-created note
 * being torn out of the Note Pad widget; `'note'` = an existing
 * pinned note being carried by its pushpin.
 */
export const NOTE_DRAFT_PAYLOAD_TYPE = 'note-draft';
export const NOTE_PAYLOAD_TYPE = 'note';

/**
 * CustomEvent (document-level) announcing a note created outside the
 * layer — the Note Pad widget's keyboard "Pin to desktop" path POSTs
 * from its own bundle and hands the note over via this event.
 * `detail: { note: Note }`.
 */
export const NOTE_CREATED_EVENT = 'desktop-mode-note-created';

/** `payload.data` for a `'note-draft'` drag (widget → wallpaper). */
export interface NoteDraftDragData {
	text: string;
	color: string;
	isPublic: boolean;
	[ key: string ]: unknown;
}

/** `payload.data` for a `'note'` drag (reposition / trash). */
export interface NoteDragData {
	noteId: number;
	canEdit: boolean;
	updatedAtMs: number;
	[ key: string ]: unknown;
}

/** Heartbeat subscribe payload (`desktop_mode_notes_subscribe`). */
export interface NotesHeartbeatSubscribe {
	knownIds: number[];
	sinceMs: number;
}

/** Heartbeat response payload (`desktop_mode_notes`). */
export interface NotesHeartbeatPayload {
	notes?: Note[];
	removed?: number[];
	serverTimeMs?: number;
	truncated?: boolean;
}
