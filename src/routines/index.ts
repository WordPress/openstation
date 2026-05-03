/**
 * Desktop Mode — Routines window.
 *
 * P1 UI scope:
 *
 *   - Sidebar list of routines with enable/disable toggle
 *   - Templates browser (one-click install)
 *   - Editor pane with: title field, run-as toggle, JSON definition
 *     editor (textarea — Monaco swap is P2), Save/Test/Run buttons
 *   - Run-history panel under the editor
 *
 * The visual builder canvas + Record Mode + Listen Mode + AI
 * "Describe it" land in P2/P3. The window id, REST contract,
 * and config shape stay constant so the upgrade is purely cosmetic.
 *
 * @since 0.22.0
 */
/* eslint-disable no-alert */

import { mountCanvas, type CanvasHandle } from './canvas';
import {
	cfg,
	createRoutine,
	deleteRoutine,
	fetchCatalog,
	fetchTemplates,
	installTemplate,
	listRoutines,
	listRuns,
	runRoutine,
	setEnabled,
	testRoutine,
	updateRoutine,
	RestError,
} from './rest';
import type {
	Catalog,
	Routine,
	RoutineDef,
	RoutineRun,
	Template,
} from './types';

type ViewMode = 'visual' | 'json';

const ROOT = '[data-wpdm-routines-root]';
const LIST = '[data-wpdm-routines-list]';
const MAIN = '[data-wpdm-routines-main]';
const NEW_BTN = '[data-wpdm-routines-new]';
const TEMPLATES_BTN = '[data-wpdm-routines-templates]';

interface ViewState {
	routines: Routine[];
	catalog: Catalog | null;
	selectedId: number | null;
	dirty: boolean;
}

const state: ViewState = {
	routines: [],
	catalog: null,
	selectedId: null,
	dirty: false,
};

const EMPTY_DEF: RoutineDef = {
	version: 1,
	trigger: { kind: 'hook', id: 'publish_post', priority: 10 },
	conditions: [],
	steps: [
		{
			kind: 'log',
			id: 'log_it',
			args: { level: 'info', message: 'Routine fired: {{payload.post.title}}' },
		},
	],
	run_as: 'author',
	settings: {
		rate_limit: { max: 0, per_seconds: 60 },
		timeout_ms: 5000,
		stop_on_error: true,
	},
};

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	props: Partial< HTMLElementTagNameMap[ K ] > & {
		class?: string;
		dataset?: Record< string, string >;
	} = {},
	children: ( Node | string )[] = [],
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	const { class: className, dataset, ...rest } = props as Record< string, unknown > & {
		class?: string;
		dataset?: Record< string, string >;
	};
	if ( className ) {
		node.className = className;
	}
	if ( dataset ) {
		for ( const [ k, v ] of Object.entries( dataset ) ) {
			node.dataset[ k ] = v;
		}
	}
	Object.assign( node, rest );
	for ( const child of children ) {
		node.append( child );
	}
	return node;
}

async function loadAll(): Promise< void > {
	const [ list, catalog ] = await Promise.all( [
		listRoutines(),
		fetchCatalog(),
	] );
	state.routines = list.items;
	state.catalog = catalog;
}

function renderList( body: HTMLElement ): void {
	const list = body.querySelector< HTMLDivElement >( LIST );
	if ( ! list ) {
		return;
	}
	list.replaceChildren();

	if ( state.routines.length === 0 ) {
		list.append(
			el( 'p', { class: 'wpdm-routines__list-empty' }, [
				'No routines yet — start from a template.',
			] ),
		);
		return;
	}

	for ( const routine of state.routines ) {
		const row = el( 'button', {
			class:
				'wpdm-routines__list-item' +
				( state.selectedId === routine.id ? ' is-selected' : '' ),
			type: 'button',
			dataset: { id: String( routine.id ) },
		} );

		const title = el( 'span', { class: 'wpdm-routines__list-title' } );
		title.textContent = routine.title;

		const meta = el( 'span', { class: 'wpdm-routines__list-meta' } );
		meta.textContent = `${ routine.def.trigger.id } • ${ routine.stats.runs } runs`;

		const dot = el( 'span', {
			class:
				'wpdm-routines__list-dot' +
				( routine.enabled ? ' is-on' : '' ),
		} );
		dot.title = routine.enabled ? 'Enabled' : 'Disabled';

		row.append( dot, title, meta );
		row.addEventListener( 'click', () => {
			if (
				state.dirty &&
				! confirm( 'Discard unsaved changes?' )
			) {
				return;
			}
			state.selectedId = routine.id;
			state.dirty = false;
			renderList( body );
			renderEditor( body );
		} );
		list.append( row );
	}
}

function renderEditor( body: HTMLElement ): void {
	const main = body.querySelector< HTMLElement >( MAIN );
	if ( ! main ) {
		return;
	}
	main.replaceChildren();

	const routine =
		state.selectedId !== null
			? state.routines.find( ( r ) => r.id === state.selectedId )
			: null;

	if ( ! routine ) {
		main.append(
			el( 'div', { class: 'wpdm-routines__empty' }, [
				el(
					'p',
					{},
					[ 'Pick a routine on the left, or start from a template.' ],
				),
			] ),
		);
		return;
	}

	main.append( buildEditorPanel( body, routine ) );
}

function buildEditorPanel( body: HTMLElement, routine: Routine ): HTMLElement {
	const panel = el( 'section', { class: 'wpdm-routines__editor' } );

	// `currentDef` is the source of truth the canvas mutates and the
	// JSON editor parses into. Switching modes serialises one
	// direction; saves persist whichever is currently active.
	let viewMode: ViewMode = 'visual';
	let canvasHandle: CanvasHandle | null = null;

	// Header — title, enabled toggle, view-mode toggle.
	const header = el( 'header', { class: 'wpdm-routines__editor-header' } );

	const titleField = el( 'input', {
		class: 'wpdm-routines__title-field',
		type: 'text',
		value: routine.title,
	} ) as HTMLInputElement;
	titleField.addEventListener( 'input', () => {
		state.dirty = true;
	} );

	const enabledLabel = el( 'label', { class: 'wpdm-routines__enable' } );
	const enabledInput = el( 'input', { type: 'checkbox' } ) as HTMLInputElement;
	enabledInput.checked = routine.enabled;
	enabledInput.addEventListener( 'change', async () => {
		try {
			const updated = await setEnabled( routine.id, enabledInput.checked );
			Object.assign( routine, updated );
			renderList( body );
		} catch ( err ) {
			alert( describeError( err ) );
			enabledInput.checked = ! enabledInput.checked;
		}
	} );
	enabledLabel.append( enabledInput, document.createTextNode( ' Enabled' ) );

	const viewToggle = el( 'div', { class: 'wpdm-routines__view-toggle' } );
	const visualBtn = el( 'button', {
		class: 'wpdm-routines__view-btn is-active',
		type: 'button',
	}, [ 'Visual' ] );
	const jsonBtn = el( 'button', {
		class: 'wpdm-routines__view-btn',
		type: 'button',
	}, [ 'JSON' ] );
	viewToggle.append( visualBtn, jsonBtn );

	header.append( titleField, enabledLabel, viewToggle );

	// View body — swapped between canvas and JSON textarea.
	const viewBody = el( 'div', { class: 'wpdm-routines__view-body' } );
	const validation = el( 'p', { class: 'wpdm-routines__validation' } );
	const out = el( 'div', { class: 'wpdm-routines__output' } );

	// JSON textarea — created once, kept as backing source for the
	// JSON view. The canvas mutates `routine.def` directly so we
	// re-serialise on every Visual→JSON switch.
	const jsonEditor = el( 'textarea', {
		class: 'wpdm-routines__json',
		spellcheck: false,
	} ) as HTMLTextAreaElement;
	jsonEditor.value = JSON.stringify( routine.def, null, 2 );
	jsonEditor.addEventListener( 'input', () => {
		state.dirty = true;
	} );

	const renderView = (): void => {
		viewBody.replaceChildren();
		canvasHandle?.destroy();
		canvasHandle = null;
		if ( viewMode === 'visual' ) {
			void mountCanvas( viewBody, {
				def: routine.def,
				catalog: state.catalog!,
				pluginUrl: cfg().pluginUrl,
				onChange: () => {
					state.dirty = true;
					// Keep the JSON view in sync if the user flips back.
					jsonEditor.value = JSON.stringify( routine.def, null, 2 );
				},
				onTest: async () => null, // canvas is presentational; test happens via the action bar
			} ).then( ( h ) => {
				canvasHandle = h;
			} );
		} else {
			const wrap = el( 'div', { class: 'wpdm-routines__json-wrap' } );
			wrap.append(
				el(
					'label',
					{ class: 'wpdm-routines__json-label' },
					[ 'Definition (JSON)' ],
				),
				jsonEditor,
			);
			viewBody.append( wrap );
		}
	};

	visualBtn.addEventListener( 'click', () => {
		if ( viewMode === 'visual' ) {
			return;
		}
		// Parse JSON into routine.def so the canvas opens with the
		// user's edits.
		const parsed = parseJson( jsonEditor.value, validation );
		if ( ! parsed ) {
			return;
		}
		routine.def = parsed as RoutineDef;
		viewMode = 'visual';
		visualBtn.classList.add( 'is-active' );
		jsonBtn.classList.remove( 'is-active' );
		renderView();
	} );
	jsonBtn.addEventListener( 'click', () => {
		if ( viewMode === 'json' ) {
			return;
		}
		jsonEditor.value = JSON.stringify( routine.def, null, 2 );
		viewMode = 'json';
		jsonBtn.classList.add( 'is-active' );
		visualBtn.classList.remove( 'is-active' );
		renderView();
	} );

	// Action bar.
	const bar = el( 'div', { class: 'wpdm-routines__action-bar' } );
	const saveBtn = el( 'button', {
		class: 'wpdm-routines__btn wpdm-routines__btn--primary',
		type: 'button',
	}, [ 'Save' ] );
	const testBtn = el( 'button', {
		class: 'wpdm-routines__btn',
		type: 'button',
	}, [ 'Test (dry-run)' ] );
	const runBtn = el( 'button', {
		class: 'wpdm-routines__btn',
		type: 'button',
	}, [ 'Run now' ] );
	const deleteBtn = el( 'button', {
		class: 'wpdm-routines__btn wpdm-routines__btn--danger',
		type: 'button',
	}, [ 'Delete' ] );
	bar.append( saveBtn, testBtn, runBtn, deleteBtn );

	// Run history.
	const history = el( 'section', { class: 'wpdm-routines__history' } );
	const historyTitle = el( 'h4', {}, [ 'Recent runs' ] );
	const historyList = el( 'div', { class: 'wpdm-routines__history-list' } );
	history.append( historyTitle, historyList );

	/**
	 * Sync the in-memory `routine.def` from whichever editor is
	 * currently visible, so subsequent Save / Test / Run all share
	 * one source of truth. Returns false (with a validation error
	 * shown) when JSON mode contains malformed input.
	 */
	const syncDefFromEditor = (): boolean => {
		if ( viewMode === 'json' ) {
			const parsed = parseJson( jsonEditor.value, validation );
			if ( ! parsed ) {
				return false;
			}
			routine.def = parsed as RoutineDef;
		}
		// Visual mode mutates routine.def directly via canvas.onChange.
		return true;
	};

	saveBtn.addEventListener( 'click', async () => {
		if ( ! syncDefFromEditor() ) {
			return;
		}
		try {
			const updated = await updateRoutine( routine.id, {
				title: titleField.value,
				def: routine.def,
			} );
			Object.assign( routine, updated );
			state.dirty = false;
			validation.textContent = 'Saved.';
			validation.className =
				'wpdm-routines__validation is-success';
			renderList( body );
		} catch ( err ) {
			validation.textContent = describeError( err );
			validation.className = 'wpdm-routines__validation is-error';
		}
	} );

	testBtn.addEventListener( 'click', async () => {
		if ( ! syncDefFromEditor() ) {
			return;
		}
		const trig = state.catalog?.triggers.find(
			( t ) => t.id === routine.def.trigger.id,
		);
		const payload = trig?.sample_payload ?? {};
		try {
			await updateRoutine( routine.id, {
				title: titleField.value,
				def: routine.def,
			} );
			const result = await testRoutine( routine.id, payload );
			renderRunResult( out, result );
			canvasHandle?.playRun( result.steps_log );
		} catch ( err ) {
			out.textContent = describeError( err );
		}
	} );

	runBtn.addEventListener( 'click', async () => {
		if (
			! confirm(
				'Run the routine for real? Side effects (emails, HTTP) will execute.',
			)
		) {
			return;
		}
		const trig = state.catalog?.triggers.find(
			( t ) => t.id === routine.def.trigger.id,
		);
		const payload = trig?.sample_payload ?? {};
		try {
			const result = await runRoutine( routine.id, payload );
			renderRunResult( out, result );
			canvasHandle?.playRun( result.steps_log );
			void refreshHistory( routine.id, historyList );
		} catch ( err ) {
			out.textContent = describeError( err );
		}
	} );

	deleteBtn.addEventListener( 'click', async () => {
		if ( ! confirm( `Delete "${ routine.title }"? This cannot be undone.` ) ) {
			return;
		}
		try {
			await deleteRoutine( routine.id );
			state.routines = state.routines.filter(
				( r ) => r.id !== routine.id,
			);
			state.selectedId = null;
			state.dirty = false;
			renderList( body );
			renderEditor( body );
		} catch ( err ) {
			alert( describeError( err ) );
		}
	} );

	panel.append( header, viewBody, validation, bar, out, history );
	renderView();

	void refreshHistory( routine.id, historyList );

	return panel;
}

function parseJson(
	source: string,
	statusEl: HTMLElement,
): unknown | null {
	try {
		const parsed = JSON.parse( source );
		statusEl.textContent = '';
		statusEl.className = 'wpdm-routines__validation';
		return parsed;
	} catch ( err ) {
		statusEl.textContent = `Invalid JSON: ${ ( err as Error ).message }`;
		statusEl.className = 'wpdm-routines__validation is-error';
		return null;
	}
}

function describeError( err: unknown ): string {
	if ( err instanceof RestError ) {
		return `${ err.code } (${ err.status }): ${ err.message }`;
	}
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}

function renderRunResult(
	out: HTMLElement,
	result: {
		status: string;
		duration_ms: number;
		steps_log: RoutineRun[ 'steps_log' ];
		error: string;
	},
): void {
	out.replaceChildren();
	const head = el(
		'div',
		{
			class: `wpdm-routines__result wpdm-routines__result--${ result.status }`,
		},
		[ `${ result.status.toUpperCase() } in ${ result.duration_ms }ms` ],
	);
	out.append( head );
	if ( result.error ) {
		const err = el( 'pre', { class: 'wpdm-routines__error' } );
		err.textContent = result.error;
		out.append( err );
	}
	const log = el( 'ol', { class: 'wpdm-routines__log' } );
	for ( const entry of result.steps_log ) {
		const li = el( 'li', {
			class: entry.ok
				? 'wpdm-routines__log-ok'
				: 'wpdm-routines__log-fail',
		} );
		li.textContent = `${ entry.kind } ${ entry.id || '' } — ${ entry.ms }ms${
			entry.error ? ` — ${ entry.error }` : ''
		}${ entry.branch ? ` [${ entry.branch }]` : '' }`;
		log.append( li );
	}
	out.append( log );
}

async function refreshHistory(
	routineId: number,
	listNode: HTMLElement,
): Promise< void > {
	listNode.replaceChildren( document.createTextNode( 'Loading…' ) );
	try {
		const { items } = await listRuns( routineId, 20 );
		listNode.replaceChildren();
		if ( items.length === 0 ) {
			listNode.append(
				el( 'p', { class: 'wpdm-routines__history-empty' }, [
					'No runs yet.',
				] ),
			);
			return;
		}
		for ( const r of items ) {
			const row = el( 'div', {
				class: `wpdm-routines__history-row wpdm-routines__history-row--${ r.status }`,
			} );
			row.textContent = `${ r.started_at } — ${ r.status } — ${ r.duration_ms }ms${
				r.error ? ` — ${ r.error }` : ''
			}`;
			listNode.append( row );
		}
	} catch ( err ) {
		listNode.replaceChildren(
			document.createTextNode( describeError( err ) ),
		);
	}
}

async function openTemplatesPicker( body: HTMLElement ): Promise< void > {
	const dialog = el( 'div', { class: 'wpdm-routines__modal' } );
	const card = el( 'div', { class: 'wpdm-routines__modal-card' } );
	card.append(
		el( 'h3', {}, [ 'Browse templates' ] ),
		el(
			'p',
			{ class: 'wpdm-routines__modal-hint' },
			[
				'Each template installs as a disabled routine — review the JSON, then enable when you’re ready.',
			],
		),
	);
	const list = el( 'div', { class: 'wpdm-routines__template-list' } );
	card.append( list );
	const close = el( 'button', { class: 'wpdm-routines__btn', type: 'button' }, [ 'Close' ] );
	close.addEventListener( 'click', () => dialog.remove() );
	card.append( close );
	dialog.append( card );
	body.append( dialog );

	try {
		const { items } = await fetchTemplates();
		if ( items.length === 0 ) {
			list.textContent = 'No templates registered yet.';
			return;
		}
		for ( const tpl of items ) {
			list.append( renderTemplateCard( body, tpl, dialog ) );
		}
	} catch ( err ) {
		list.textContent = describeError( err );
	}
}

function renderTemplateCard(
	body: HTMLElement,
	tpl: Template,
	dialog: HTMLElement,
): HTMLElement {
	const card = el( 'article', { class: 'wpdm-routines__template-card' } );
	const title = el( 'h4', {} );
	title.textContent = tpl.title;
	const desc = el( 'p', {} );
	desc.textContent = tpl.description;
	const meta = el( 'p', { class: 'wpdm-routines__template-meta' } );
	meta.textContent = `${ tpl.group } • trigger: ${ tpl.def.trigger.id }`;
	const install = el( 'button', {
		class: 'wpdm-routines__btn wpdm-routines__btn--primary',
		type: 'button',
	}, [ 'Install' ] );
	install.addEventListener( 'click', async () => {
		try {
			const created = await installTemplate( tpl.id );
			state.routines = [ created, ...state.routines ];
			state.selectedId = created.id;
			renderList( body );
			renderEditor( body );
			dialog.remove();
		} catch ( err ) {
			alert( describeError( err ) );
		}
	} );
	card.append( title, meta, desc, install );
	return card;
}

async function createBlankRoutine( body: HTMLElement ): Promise< void > {
	try {
		const created = await createRoutine( {
			title: 'Untitled routine',
			enabled: false,
			def: structuredClone( EMPTY_DEF ),
		} );
		state.routines = [ created, ...state.routines ];
		state.selectedId = created.id;
		renderList( body );
		renderEditor( body );
	} catch ( err ) {
		alert( describeError( err ) );
	}
}

/**
 * Render callback the native window registry calls when the
 * Routines window opens. Body is freshly cloned from the PHP
 * template each open, so every render starts from a clean DOM.
 *
 * @since 0.22.0
 *
 * @param body The window body element.
 */
async function renderRoutinesWindow( body: HTMLElement ): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT );
	if ( ! root ) {
		return;
	}

	const newBtn = body.querySelector< HTMLButtonElement >( NEW_BTN );
	newBtn?.addEventListener( 'click', () => createBlankRoutine( body ) );

	const tplBtn = body.querySelector< HTMLButtonElement >( TEMPLATES_BTN );
	tplBtn?.addEventListener( 'click', () => openTemplatesPicker( body ) );

	try {
		await loadAll();
	} catch ( err ) {
		const main = body.querySelector< HTMLElement >( MAIN );
		if ( main ) {
			main.replaceChildren();
			main.append(
				el( 'p', { class: 'wpdm-routines__validation is-error' }, [
					describeError( err ),
				] ),
			);
		}
		return;
	}

	if ( state.selectedId === null && state.routines.length > 0 ) {
		state.selectedId = state.routines[ 0 ].id;
	}

	renderList( body );
	renderEditor( body );
}

window.wpDesktopNativeWindows = window.wpDesktopNativeWindows ?? {};
window.wpDesktopNativeWindows[ 'wpdm-routines' ] = ( body ) => {
	void renderRoutinesWindow( body );
};
