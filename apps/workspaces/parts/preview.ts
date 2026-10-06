/**
 * The draft, drawn — a small desk the user checks before anything is
 * made.
 *
 * A wallpaper-shaped canvas with the 6 × 6 grid on it; each window a
 * skeleton on its cells (title bar, its app's icon and title, a few
 * placeholder lines); the dock along the bottom with the proposed apps'
 * real icons; the widget column down the right. It fills in step by
 * step, as the proposals arrive.
 *
 * Under it, the step being decided — with the toggle buttons that let
 * the user add or take out an app or a widget before accepting, and the button
 * that accepts. The buttons move the draft exactly as telling MIO does
 * (`./draft`), so the chat and the preview never disagree.
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import type { GridSpan } from '../../../src/types';
import {
	acceptStep,
	currentStep,
	removeNote,
	reopenStep,
	toggleApp,
	toggleWidget,
	windowApps,
	type DraftStep,
	type WorkspaceDraft,
} from './draft';

/** What the preview needs to know about an app or a widget. */
export interface PreviewItem {
	id: string;
	title: string;
	icon: string;
	/** False for an app with no dock icon — a window only. */
	dock?: boolean;
}

export interface PreviewDeps {
	draft: WorkspaceDraft;
	apps: readonly PreviewItem[];
	widgets: readonly PreviewItem[];
	/** Repaint after the draft changed. */
	changed: () => void;
	/**
	 * A step was accepted with the preview's own button — tell MIO, so
	 * the conversation moves on without the user having to say so.
	 */
	accepted?: ( step: DraftStep ) => void;
	/** Make (or save) the workspace from the accepted draft. */
	create: () => void;
	discard: () => void;
}

/** An icon from a nav item or widget: a Dashicon, or an image. */
export function iconOf( icon: string ): TemplateResult {
	if ( /^(data:|https?:|\/)/.test( icon ) ) {
		return html`<img class="os-workspaces__draft-icon" src=${ icon } alt="" />`;
	}
	const cls = /^dashicons-[a-z0-9-]+$/.test( icon ) ? icon : 'dashicons-admin-generic';
	return html`<span class="os-workspaces__draft-icon dashicons ${ cls }" aria-hidden="true"></span>`;
}

/** A span's box, in percent of the grid. */
function box( span: GridSpan | undefined ): string {
	if ( ! span ) {
		return 'left: 30%; top: 30%; width: 40%; height: 40%';
	}
	const c0 = Math.min( span.anchor.col, span.cursor.col );
	const c1 = Math.max( span.anchor.col, span.cursor.col ) + 1;
	const r0 = Math.min( span.anchor.row, span.cursor.row );
	const r1 = Math.max( span.anchor.row, span.cursor.row ) + 1;
	const pct = ( n: number, of: number ): string => `${ ( n / of ) * 100 }%`;
	return `left: ${ pct( c0, span.cols ) }; top: ${ pct( r0, span.rows ) }; width: ${ pct( c1 - c0, span.cols ) }; height: ${ pct( r1 - r0, span.rows ) }`;
}

const STEPS: Array< { id: DraftStep | 'ready'; label: () => string } > = [
	{ id: 'layout', label: () => __( 'Layout' ) },
	{ id: 'apps', label: () => __( 'Dock apps' ) },
	{ id: 'widgets', label: () => __( 'Widgets' ) },
	{ id: 'notes', label: () => __( 'Notes' ) },
	{ id: 'ready', label: () => __( 'Create' ) },
];

function canvas( deps: PreviewDeps ): TemplateResult {
	const { draft } = deps;
	const byId = new Map( deps.apps.map( ( a ) => [ a.id, a ] ) );
	const widgetsById = new Map( deps.widgets.map( ( w ) => [ w.id, w ] ) );
	return html`
		<div class="os-workspaces__desk" role="img" aria-label=${ __( 'Preview of the workspace' ) }>
			<div class="os-workspaces__desk-grid">
				${ draft.windows.map( ( win ) => {
					const app = byId.get( win.match );
					return html`
						<div class="os-workspaces__desk-window" style=${ box( win.gridSpan ) }>
							<div class="os-workspaces__desk-titlebar">
								${ iconOf( app?.icon ?? '' ) }
								<span>${ win.title || app?.title || win.match }</span>
							</div>
							<div class="os-workspaces__desk-lines" aria-hidden="true"><i></i><i></i><i></i></div>
						</div>
					`;
				} ) }
				${ ( draft.notes ?? [] ).map( ( note ) => html`
					<div
						class="os-workspaces__desk-note ${ 'xl' === note.size ? 'is-xl' : '' }"
						data-note-color=${ note.color }
						style=${ `left: ${ note.x * 100 }%; top: ${ note.y * 100 }%` }
						title=${ note.text }
					>${ note.text }</div>
				` ) }
				${ draft.widgets && draft.widgets.length
					? html`<div class="os-workspaces__desk-widgets">
							${ draft.widgets.map( ( id ) => html`<div class="os-workspaces__desk-widget">${ iconOf( widgetsById.get( id )?.icon ?? '' ) }</div>` ) }
						</div>`
					: '' }
			</div>
			<div class="os-workspaces__desk-dock">
				${ draft.apps
					? draft.apps.filter( ( id ) => false !== byId.get( id )?.dock ).map( ( id ) => html`<span class="os-workspaces__desk-dock-item" title=${ byId.get( id )?.title ?? id }>${ iconOf( byId.get( id )?.icon ?? '' ) }</span>` )
					: html`<span class="os-workspaces__hint">${ __( 'Dock apps come next' ) }</span>` }
			</div>
		</div>
	`;
}

function checklist(
	items: readonly PreviewItem[],
	chosen: readonly string[],
	locked: readonly string[],
	disabled: boolean,
	toggle: ( id: string ) => void,
): TemplateResult {
	return html`
		<div class="os-workspaces__draft-choices">
			${ items.map(
				( item ) => html`
					<button
						type="button"
						class="os-workspaces__draft-choice ${ chosen.includes( item.id ) ? 'is-on' : '' }"
						aria-pressed=${ chosen.includes( item.id ) ? 'true' : 'false' }
						?disabled=${ disabled || locked.includes( item.id ) }
						title=${ locked.includes( item.id ) ? __( 'A window on this desk uses it' ) : '' }
						@click=${ () => toggle( item.id ) }
					>
						${ iconOf( item.icon ) }
						<span>${ item.title }</span>
					</button>
				`,
			) }
		</div>
	`;
}

/** What the Notes step says, by where the proposal is. */
function notesHint( draft: WorkspaceDraft ): string {
	if ( null === draft.notes ) {
		return __( 'MIO is writing the notes for the people using this desk…' );
	}
	return draft.notes.length
		? __( 'These notes hang on the desk, read-only — the people using it can dismiss them. Take one out, or accept.' )
		: __( 'No notes on this desk. Accept, or ask MIO for one.' );
}

function stepPanel( deps: PreviewDeps ): TemplateResult {
	const { draft } = deps;
	const step = currentStep( draft );
	const accept = ( s: DraftStep ): void => {
		if ( acceptStep( draft, s ) ) {
			deps.changed();
			deps.accepted?.( s );
		}
	};
	switch ( step ) {
		case 'layout':
			return html`
				<p class="os-workspaces__hint">${ draft.windows.length
					? __( 'Is this where the windows should go? Accept it, or tell MIO what to move.' )
					: __( 'Tell MIO which windows the desk opens and where.' ) }</p>
				<os-button variant="primary" ?disabled=${ ! draft.windows.length } @click=${ () => accept( 'layout' ) }>${ __( 'Accept layout' ) }</os-button>
			`;
		case 'apps': {
			const chosen = draft.apps ?? [];
			// Only apps with a dock icon can be kept on the dock.
			const shown = deps.apps.filter( ( a ) => false !== a.dock );
			return html`
				<p class="os-workspaces__hint">${ null === draft.apps
					? __( 'MIO is choosing the dock apps…' )
					: __( 'These icons go on the dock. Tap one to add or remove it, then accept.' ) }</p>
				${ null !== draft.apps
					? checklist( shown, chosen, windowApps( draft ), false, ( id ) => {
						toggleApp( draft, id );
						deps.changed();
					} )
					: '' }
				<os-button variant="primary" ?disabled=${ null === draft.apps } @click=${ () => accept( 'apps' ) }>${ __( 'Accept apps' ) }</os-button>
			`;
		}
		case 'widgets':
			return html`
				<p class="os-workspaces__hint">${ null === draft.widgets
					? __( 'MIO is choosing the widgets…' )
					: __( 'These widgets go in the column. Tap one to add or remove it, then accept.' ) }</p>
				${ null !== draft.widgets
					? checklist( deps.widgets, draft.widgets, [], false, ( id ) => {
						toggleWidget( draft, id );
						deps.changed();
					} )
					: '' }
				<os-button variant="primary" ?disabled=${ null === draft.widgets } @click=${ () => accept( 'widgets' ) }>${ __( 'Accept widgets' ) }</os-button>
			`;
		case 'notes':
			return html`
				<p class="os-workspaces__hint">${ notesHint( draft ) }</p>
				${ draft.notes?.length
					? html`<div class="os-workspaces__draft-notes">
							${ draft.notes.map( ( note ) => html`
								<div class="os-workspaces__draft-note" data-note-color=${ note.color }>
									<span class="os-workspaces__draft-note-size">${ 'xl' === note.size ? __( 'XL note' ) : __( 'Note' ) }</span>
									<p>${ note.text }</p>
									<button type="button" aria-label=${ __( 'Take this note out' ) } @click=${ () => {
										removeNote( draft, note.id );
										deps.changed();
									} }>×</button>
								</div>
							` ) }
						</div>`
					: '' }
				<os-button variant="primary" ?disabled=${ null === draft.notes } @click=${ () => accept( 'notes' ) }>${ __( 'Accept notes' ) }</os-button>
			`;
		default:
			return html`
				<p class="os-workspaces__hint">${ __( 'Everything is accepted.' ) }</p>
				<os-button variant="holo" @click=${ deps.create }>${ draft.target ? __( 'Save workspace' ) : __( 'Create workspace' ) }</os-button>
			`;
	}
}

/** A step pill's state: behind the current one, the current one, or ahead. */
function stepClass( i: number, current: number ): string {
	if ( i < current ) {
		return 'is-done';
	}
	return i === current ? 'is-current' : '';
}

/** The draft card: steps, the desk, and the decision in front of the user. */
export function renderDraft( deps: PreviewDeps ): TemplateResult {
	const { draft } = deps;
	const step = currentStep( draft );
	const stepIndex = STEPS.findIndex( ( s ) => s.id === step );
	return html`
		<section class="os-workspaces__draft" aria-live="polite">
			<header class="os-workspaces__draft-head">
				<strong>✦ ${ draft.name
					? sprintf(
						// translators: %s is the workspace name.
						__( 'Draft: %s' ),
						draft.name,
					)
					: __( 'Draft workspace' ) }</strong>
				<os-button variant="ghost" @click=${ deps.discard }>${ __( 'Discard' ) }</os-button>
			</header>
			<ol class="os-workspaces__draft-steps">
				${ STEPS.map( ( s, i ) => html`
					<li class=${ stepClass( i, stepIndex ) }>
						${ i < stepIndex && 'ready' !== s.id
							? html`<button type="button" @click=${ () => {
								reopenStep( draft, s.id as DraftStep );
								deps.changed();
							} } title=${ __( 'Change this step' ) }>✓ ${ s.label() }</button>`
							: s.label() }
					</li>
				` ) }
			</ol>
			${ canvas( deps ) }
			<div class="os-workspaces__draft-panel">${ stepPanel( deps ) }</div>
		</section>
	`;
}
