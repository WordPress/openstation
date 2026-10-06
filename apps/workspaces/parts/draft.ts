/**
 * The workspace MIO is building — a draft, and the rules for moving it
 * forward.
 *
 * Building a desk by asking is three proposals, each one accepted
 * before the next is made:
 *
 *   1. **Layout** — the windows and where they sit on the 6 × 6 grid.
 *   2. **Dock apps** — which apps the desk keeps on its dock.
 *   3. **Widgets** — which widgets it puts in its column.
 *   4. **Notes** — read-only notes pinned on the desk for the people
 *      using it (none is a fine answer).
 *
 * Only then can the workspace be created. The preview in the window
 * paints the draft as it grows, and its buttons accept a step exactly
 * as telling MIO "yes" does: both go through {@link acceptStep}, so the
 * two can never disagree about where the draft is.
 *
 * Nothing here touches a desk. A draft is memory; the one write is
 * {@link draftProfile}'s result handed to `wp.os.workspaces`.
 */

import type { WorkspaceLaunch, WorkspaceNote, WorkspaceProfile } from '../../../src/workspaces/types';

export type DraftStep = 'layout' | 'apps' | 'widgets' | 'notes';

const ORDER: DraftStep[] = [ 'layout', 'apps', 'widgets', 'notes' ];

export interface WorkspaceDraft {
	/** The workspace being edited, or '' for a new one. */
	target: string;
	name: string;
	icon: string;
	color: string;
	windows: WorkspaceLaunch[];
	/** Proposed dock apps; null until proposed. */
	apps: string[] | null;
	/** Proposed widgets; null until proposed. */
	widgets: string[] | null;
	/** Proposed notes; null until proposed (an empty list is "no notes"). */
	notes: WorkspaceNote[] | null;
	hideSettings: boolean;
	accepted: Record< DraftStep, boolean >;
}

/** A fresh draft for a new workspace, or for reworking an existing one. */
export function newDraft( init: Partial< WorkspaceDraft > = {} ): WorkspaceDraft {
	return {
		target: '',
		name: '',
		icon: 'dashicons-desktop',
		color: '',
		windows: [],
		apps: null,
		widgets: null,
		notes: null,
		hideSettings: false,
		...init,
		accepted: { layout: false, apps: false, widgets: false, notes: false },
	};
}

/** The step waiting on the user, or 'ready' when all three are accepted. */
export function currentStep( draft: WorkspaceDraft ): DraftStep | 'ready' {
	if ( ! draft.accepted.layout ) {
		return 'layout';
	}
	if ( ! draft.accepted.apps ) {
		return 'apps';
	}
	if ( ! draft.accepted.widgets ) {
		return 'widgets';
	}
	if ( ! draft.accepted.notes ) {
		return 'notes';
	}
	return 'ready';
}

/** The apps the draft's windows open — always on its dock. */
export function windowApps( draft: WorkspaceDraft ): string[] {
	return [ ...new Set( draft.windows.map( ( w ) => w.match ) ) ];
}

/** A new layout: every later step starts over, since it rested on this one. */
export function proposeLayout( draft: WorkspaceDraft, windows: WorkspaceLaunch[] ): void {
	draft.windows = windows;
	draft.accepted = { layout: false, apps: false, widgets: false, notes: false };
	if ( draft.apps ) {
		draft.apps = [ ...new Set( [ ...draft.apps, ...windowApps( draft ) ] ) ];
	}
}

/**
 * Dock apps, once the layout is accepted. The apps the windows open
 * are added whatever was proposed: a window whose app is off the dock
 * is a window the fence refuses for someone pinned to the desk.
 */
export function proposeApps( draft: WorkspaceDraft, apps: string[] ): boolean {
	if ( ! draft.accepted.layout ) {
		return false;
	}
	draft.apps = [ ...new Set( [ ...windowApps( draft ), ...apps ] ) ];
	draft.accepted.apps = false;
	draft.accepted.widgets = false;
	draft.accepted.notes = false;
	return true;
}

/** Widgets, once the dock apps are accepted. */
export function proposeWidgets( draft: WorkspaceDraft, widgets: string[] ): boolean {
	if ( ! draft.accepted.apps ) {
		return false;
	}
	draft.widgets = [ ...new Set( widgets ) ];
	draft.accepted.widgets = false;
	draft.accepted.notes = false;
	return true;
}

/** Notes, once the widgets are accepted. An empty list means no notes. */
export function proposeNotes( draft: WorkspaceDraft, notes: WorkspaceNote[] ): boolean {
	if ( ! draft.accepted.widgets ) {
		return false;
	}
	draft.notes = notes;
	draft.accepted.notes = false;
	return true;
}

/** Take one proposed note out before accepting. */
export function removeNote( draft: WorkspaceDraft, id: string ): void {
	if ( draft.notes && ! draft.accepted.notes ) {
		draft.notes = draft.notes.filter( ( n ) => n.id !== id );
	}
}

/** Accept a step — only the one waiting, and only once it has a proposal. */
export function acceptStep( draft: WorkspaceDraft, step: DraftStep ): boolean {
	if ( currentStep( draft ) !== step ) {
		return false;
	}
	if ( 'layout' === step && draft.windows.length === 0 ) {
		return false;
	}
	if ( 'apps' === step && null === draft.apps ) {
		return false;
	}
	if ( 'widgets' === step && null === draft.widgets ) {
		return false;
	}
	if ( 'notes' === step && null === draft.notes ) {
		return false;
	}
	draft.accepted[ step ] = true;
	return true;
}

/** Reopen a step — it and every step after it wait again. */
export function reopenStep( draft: WorkspaceDraft, step: DraftStep ): void {
	for ( const s of ORDER.slice( ORDER.indexOf( step ) ) ) {
		draft.accepted[ s ] = false;
	}
}

/** Toggle one app on the proposed dock. The windows' own apps stay. */
export function toggleApp( draft: WorkspaceDraft, id: string ): void {
	if ( ! draft.apps || draft.accepted.apps || windowApps( draft ).includes( id ) ) {
		return;
	}
	draft.apps = draft.apps.includes( id ) ? draft.apps.filter( ( a ) => a !== id ) : [ ...draft.apps, id ];
}

/** Toggle one proposed widget. */
export function toggleWidget( draft: WorkspaceDraft, id: string ): void {
	if ( ! draft.widgets || draft.accepted.widgets ) {
		return;
	}
	draft.widgets = draft.widgets.includes( id ) ? draft.widgets.filter( ( w ) => w !== id ) : [ ...draft.widgets, id ];
}

/**
 * The profile an accepted draft becomes. `base` is the workspace being
 * edited, whose other fields (look, settings) are kept.
 */
export function draftProfile( draft: WorkspaceDraft, base?: WorkspaceProfile | null ): WorkspaceProfile {
	const appearance = { ...( base?.appearance ?? {} ) } as Record< string, unknown >;
	return {
		preset: base?.preset ?? '',
		icon: draft.icon,
		color: draft.color,
		apps: { mode: 'only', ids: draft.apps ?? windowApps( draft ) },
		widgets: { mode: 'only', ids: draft.widgets ?? [] },
		appearance,
		windows: draft.windows,
		layout: 'free',
		provisioned: false,
		restricted: draft.hideSettings,
		notes: draft.notes ?? base?.notes ?? [],
	};
}
