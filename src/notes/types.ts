export const NOTES_POST_TYPE = 'wpd_note';

export interface Note {
	id: number;
	text: string;
	color: string;

	x: number;
	y: number;
	z: number;
	public: boolean;

	seed: number;
	ownerId: number;
	ownerName: string;
	ownerAvatar: string;
	canEdit: boolean;

	updatedAtMs: number;
}

export const NOTE_DRAFT_PAYLOAD_TYPE = 'note-draft';
export const NOTE_PAYLOAD_TYPE = 'note';

export const NOTE_CREATED_EVENT = 'os-note-created';

export const NOTES_HEARTBEAT_RESPONSE_FIELD = 'openstation_notes';

export interface NoteDraftDragData {
	text: string;
	color: string;
	isPublic: boolean;
	[ key: string ]: unknown;
}

export interface NoteDragData {
	noteId: number;
	canEdit: boolean;
	updatedAtMs: number;
	[ key: string ]: unknown;
}

export interface NotesHeartbeatSubscribe {
	knownIds: number[];
	sinceMs: number;
}

export interface NotesHeartbeatPayload {
	notes?: Note[];
	removed?: number[];
	serverTimeMs?: number;
	truncated?: boolean;
}
