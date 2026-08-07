export type RestTextField =
	| string
	| {
			raw?: string;
			rendered?: string;
		}
	| null
	| undefined;

export interface RestGuidelineTerm {
	id: number;
	name?: string;
	slug: string;
	parent?: number;
}

export interface RestStickyGuideline {
	id: number;
	slug?: string;
	status?: string;
	title?: RestTextField;
	content?: RestTextField;
	excerpt?: RestTextField;
	modified?: string;
	openstation_modified_ms?: number;
	link?: string;
	wp_guideline_type?: number[];
}

export interface StickyTerms {
	stickyTermId: number;
	termIds: number[];
}

export interface StickyNote {
	localId: string;
	guidelineId: number | null;
	title: string;
	body: string;
	modified?: string;
	modifiedMs?: number;
	link?: string;
	termIds: number[];
}

export interface StickyGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	desktopId?: string;
}

export interface StickyNotesHeartbeatSubscribe {
	stickyTermId: number;
	knownIds: number[];
	version: number;
}

export interface StickyNotesHeartbeatPayload {
	notes?: RestStickyGuideline[];
	removed?: number[];
	serverTimeMs?: number;
	truncated?: boolean;
}
