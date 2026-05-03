/**
 * Routines — step inspector.
 *
 * Renders the right-hand side panel that opens when the user clicks
 * a card on the canvas. The form fields are driven by the step's
 * `kind`:
 *
 *   - log:     level + message (textarea, autocomplete)
 *   - email:   to + subject + body (autocomplete on each)
 *   - http:    url + method + headers + body
 *   - wait:    seconds (1–5)
 *   - set_var: name + value
 *   - stop:    reason
 *   - if:      condition (left/op/right) — children edited on canvas
 *   - action:  id (read-only) + dynamic args from args_schema
 *   - ai_tool: same shape as action
 *   - command: (records intent — Phase 3)
 *
 * Every text input gets `attachAutocomplete` so the user gets
 * `{{payload.…}}` / `{{vars.…}}` suggestions inline.
 *
 * @since 0.22.0
 */

import { attachAutocomplete, type Suggestion } from './autocomplete';
import { el } from './dom';
import type {
	Catalog,
	CatalogTrigger,
	Operator,
	RoutineCondition,
	RoutineDef,
	RoutineStep,
	StepKind,
} from './types';

export interface InspectorTarget {
	kind: 'trigger' | 'condition' | 'step';
	stepPath?: number[]; // index path through nested if-branches
	step?: RoutineStep;
}

export interface InspectorContext {
	def: RoutineDef;
	catalog: Catalog;
	target: InspectorTarget;
	onChange: () => void; // called when the def is mutated; canvas re-renders
	onClose: () => void;
}

/**
 * Render an inspector panel for the current target. Returns the
 * detached element — the canvas mounts it into its inspector slot.
 */
export function renderInspector( ctx: InspectorContext ): HTMLElement {
	const panel = el( 'aside', { class: 'wpdm-routines__inspector' } );

	const header = el( 'header', { class: 'wpdm-routines__inspector-head' } );
	const heading = el( 'h3', {} );
	const closeBtn = el( 'button', {
		class: 'wpdm-routines__icon-btn',
		type: 'button',
		title: 'Close',
	} );
	closeBtn.textContent = '×';
	closeBtn.addEventListener( 'click', ctx.onClose );
	header.append( heading, closeBtn );
	panel.append( header );

	const body = el( 'div', { class: 'wpdm-routines__inspector-body' } );
	panel.append( body );

	if ( ctx.target.kind === 'trigger' ) {
		heading.textContent = 'Trigger';
		body.append( renderTriggerEditor( ctx ) );
	} else if ( ctx.target.kind === 'condition' ) {
		heading.textContent = 'Top-level condition';
		body.append( renderConditionsEditor( ctx ) );
	} else if ( ctx.target.step ) {
		heading.textContent = stepHeading( ctx.target.step );
		body.append( renderStepEditor( ctx, ctx.target.step ) );
	}

	return panel;
}

function stepHeading( step: RoutineStep ): string {
	const kindLabel: Record< StepKind, string > = {
		command: 'Command',
		ai_tool: 'AI tool',
		action: 'Action',
		email: 'Email',
		http: 'HTTP request',
		log: 'Log',
		wait: 'Wait',
		if: 'Branch (if / else)',
		stop: 'Stop',
		set_var: 'Set variable',
	};
	return kindLabel[ step.kind ] + ( step.id ? ` — ${ step.id }` : '' );
}

// ---- Trigger editor --------------------------------------------------

function renderTriggerEditor( ctx: InspectorContext ): HTMLElement {
	const wrap = el( 'div', { class: 'wpdm-routines__form' } );
	const declared = ctx.catalog.triggers.find(
		( t: CatalogTrigger ) => t.id === ctx.def.trigger.id,
	);

	wrap.append(
		formRow( 'Trigger', readOnly( ctx.def.trigger.id ) ),
		formRow( 'Kind', readOnly( ctx.def.trigger.kind ) ),
		formRow(
			'Priority',
			numberField( String( ctx.def.trigger.priority ), ( v ) => {
				ctx.def.trigger.priority = parseInt( v, 10 ) || 10;
				ctx.onChange();
			} ),
		),
	);

	if ( declared ) {
		const schemaKeys = Object.keys( declared.payload_schema || {} );
		if ( schemaKeys.length > 0 ) {
			const schemaSection = el( 'section', {
				class: 'wpdm-routines__schema',
			} );
			const h = el( 'h4', {} );
			h.textContent = 'Available variables';
			schemaSection.append( h );
			const list = el( 'ul', { class: 'wpdm-routines__schema-list' } );
			for ( const path of schemaKeys ) {
				const entry = ( declared.payload_schema as Record<
					string,
					{ type?: string; description?: string }
				> )[ path ];
				const li = el( 'li', {} );
				const code = el( 'code', {} );
				code.textContent = `{{payload.${ path }}}`;
				li.append( code );
				if ( entry?.description ) {
					li.append( ' — ', entry.description );
				}
				if ( entry?.type ) {
					li.append( ` (${ entry.type })` );
				}
				list.append( li );
			}
			schemaSection.append( list );
			wrap.append( schemaSection );
		}
	} else {
		const note = el( 'p', { class: 'wpdm-routines__hint' }, [
			'This trigger is not declared by any plugin. Variable autocomplete uses positional `{{payload.arg0}}`, `{{payload.arg1}}`, … fallbacks.',
		] );
		wrap.append( note );
	}

	return wrap;
}

// ---- Condition editor ------------------------------------------------

function renderConditionsEditor( ctx: InspectorContext ): HTMLElement {
	const wrap = el( 'div', { class: 'wpdm-routines__form' } );

	const intro = el( 'p', { class: 'wpdm-routines__hint' }, [
		'Top-level conditions ALL must pass for the steps to run. Use them as a coarse filter; per-step branching belongs in `if` steps.',
	] );
	wrap.append( intro );

	const list = el( 'div', { class: 'wpdm-routines__conditions-list' } );

	const repaint = (): void => {
		list.replaceChildren();
		ctx.def.conditions.forEach( ( cond, i ) => {
			list.append(
				conditionRow(
					cond,
					ctx,
					() => {
						ctx.def.conditions.splice( i, 1 );
						ctx.onChange();
						repaint();
					},
				),
			);
		} );
	};
	repaint();
	wrap.append( list );

	const addBtn = el(
		'button',
		{ class: 'wpdm-routines__btn', type: 'button' },
		[ '+ Add condition' ],
	);
	addBtn.addEventListener( 'click', () => {
		ctx.def.conditions.push( { left: '', op: 'eq', right: '' } );
		ctx.onChange();
		repaint();
	} );
	wrap.append( addBtn );
	return wrap;
}

function conditionRow(
	cond: RoutineCondition,
	ctx: InspectorContext,
	onRemove: () => void,
): HTMLElement {
	const row = el( 'div', { class: 'wpdm-routines__condition' } );
	const left = textField( String( cond.left ?? '' ), ( v ) => {
		cond.left = v;
		ctx.onChange();
	} );
	attachAutocomplete( left, () => suggestionsFor( ctx ) );
	const opSel = operatorSelect( ctx.catalog.operators, cond.op, ( v ) => {
		cond.op = v;
		ctx.onChange();
	} );
	const right = textField( String( cond.right ?? '' ), ( v ) => {
		cond.right = v;
		ctx.onChange();
	} );
	attachAutocomplete( right, () => suggestionsFor( ctx ) );
	const remove = el(
		'button',
		{
			class: 'wpdm-routines__icon-btn',
			type: 'button',
			title: 'Remove condition',
		},
		[ '×' ],
	);
	remove.addEventListener( 'click', onRemove );
	row.append( left, opSel, right, remove );
	return row;
}

// ---- Step editors ----------------------------------------------------

function renderStepEditor( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', { class: 'wpdm-routines__form' } );

	wrap.append(
		formRow(
			'Step ID',
			textField( step.id, ( v ) => {
				step.id = v;
				ctx.onChange();
			} ),
			"Optional — used to reference this step's result via {{vars.<id>}}.",
		),
	);

	switch ( step.kind ) {
		case 'log':
			wrap.append( logFields( ctx, step ) );
			break;
		case 'email':
			wrap.append( emailFields( ctx, step ) );
			break;
		case 'http':
			wrap.append( httpFields( ctx, step ) );
			break;
		case 'wait':
			wrap.append( waitFields( ctx, step ) );
			break;
		case 'set_var':
			wrap.append( setVarFields( ctx, step ) );
			break;
		case 'stop':
			wrap.append( stopFields( ctx, step ) );
			break;
		case 'if':
			wrap.append( ifFields( ctx, step ) );
			break;
		case 'action':
		case 'ai_tool':
		case 'command':
			wrap.append( dynamicArgsFields( ctx, step ) );
			break;
	}

	return wrap;
}

function logFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	const args = step.args as { level?: string; message?: string };
	wrap.append(
		formRow(
			'Level',
			selectField(
				[ 'info', 'warning', 'error' ],
				args.level || 'info',
				( v ) => {
					args.level = v;
					ctx.onChange();
				},
			),
		),
	);
	const ta = textareaField(
		args.message || '',
		( v ) => {
			args.message = v;
			ctx.onChange();
		},
	);
	attachAutocomplete( ta, () => suggestionsFor( ctx ) );
	wrap.append( formRow( 'Message', ta ) );
	return wrap;
}

function emailFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	const args = step.args as {
		to?: string;
		subject?: string;
		body?: string;
	};
	const toEl = textField( args.to || '', ( v ) => {
		args.to = v;
		ctx.onChange();
	} );
	attachAutocomplete( toEl, () => suggestionsFor( ctx ) );
	const subEl = textField( args.subject || '', ( v ) => {
		args.subject = v;
		ctx.onChange();
	} );
	attachAutocomplete( subEl, () => suggestionsFor( ctx ) );
	const bodyEl = textareaField( args.body || '', ( v ) => {
		args.body = v;
		ctx.onChange();
	} );
	attachAutocomplete( bodyEl, () => suggestionsFor( ctx ) );
	wrap.append(
		formRow( 'To', toEl, 'Defaults to admin email when blank.' ),
		formRow( 'Subject', subEl ),
		formRow( 'Body', bodyEl ),
	);
	return wrap;
}

function httpFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	const args = step.args as {
		url?: string;
		method?: string;
		body?: unknown;
	};
	const urlEl = textField( String( args.url || '' ), ( v ) => {
		args.url = v;
		ctx.onChange();
	} );
	attachAutocomplete( urlEl, () => suggestionsFor( ctx ) );
	const bodyEl = textareaField(
		typeof args.body === 'string' ? args.body : JSON.stringify( args.body ?? '' ),
		( v ) => {
			try {
				args.body = JSON.parse( v );
			} catch {
				args.body = v;
			}
			ctx.onChange();
		},
	);
	attachAutocomplete( bodyEl, () => suggestionsFor( ctx ) );
	wrap.append(
		formRow(
			'URL',
			urlEl,
			'Host must be in `wp_desktop_routine_http_allowlist` (default: empty).',
		),
		formRow(
			'Method',
			selectField(
				[ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' ],
				String( args.method || 'GET' ).toUpperCase(),
				( v ) => {
					args.method = v;
					ctx.onChange();
				},
			),
		),
		formRow( 'Body', bodyEl, 'JSON or raw string.' ),
	);
	return wrap;
}

function waitFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const args = step.args as { seconds?: number };
	const wrap = el( 'div', {} );
	wrap.append(
		formRow(
			'Seconds',
			numberField(
				String( args.seconds ?? 1 ),
				( v ) => {
					args.seconds = Math.max( 0, Math.min( 5, parseInt( v, 10 ) || 0 ) );
					ctx.onChange();
				},
			),
			'Capped at 5 seconds. Longer waits land in Phase 3 via Action Scheduler.',
		),
	);
	return wrap;
}

function setVarFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const args = step.args as { name?: string; value?: unknown };
	const wrap = el( 'div', {} );
	wrap.append(
		formRow(
			'Name',
			textField( args.name || '', ( v ) => {
				args.name = v;
				ctx.onChange();
			} ),
		),
	);
	const valEl = textField(
		typeof args.value === 'string'
			? args.value
			: JSON.stringify( args.value ?? '' ),
		( v ) => {
			try {
				args.value = JSON.parse( v );
			} catch {
				args.value = v;
			}
			ctx.onChange();
		},
	);
	attachAutocomplete( valEl, () => suggestionsFor( ctx ) );
	wrap.append( formRow( 'Value', valEl ) );
	return wrap;
}

function stopFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const args = step.args as { reason?: string };
	const wrap = el( 'div', {} );
	const reasonEl = textField( args.reason || '', ( v ) => {
		args.reason = v;
		ctx.onChange();
	} );
	attachAutocomplete( reasonEl, () => suggestionsFor( ctx ) );
	wrap.append( formRow( 'Reason', reasonEl ) );
	return wrap;
}

function ifFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	if ( ! step.condition ) {
		step.condition = { left: '', op: 'eq', right: '' };
	}
	const cond = step.condition;
	const leftEl = textField( String( cond.left ?? '' ), ( v ) => {
		cond.left = v;
		ctx.onChange();
	} );
	attachAutocomplete( leftEl, () => suggestionsFor( ctx ) );
	const rightEl = textField( String( cond.right ?? '' ), ( v ) => {
		cond.right = v;
		ctx.onChange();
	} );
	attachAutocomplete( rightEl, () => suggestionsFor( ctx ) );
	wrap.append(
		formRow( 'Left', leftEl ),
		formRow(
			'Operator',
			operatorSelect( ctx.catalog.operators, cond.op, ( v ) => {
				cond.op = v;
				ctx.onChange();
			} ),
		),
		formRow( 'Right', rightEl ),
		el( 'p', { class: 'wpdm-routines__hint' }, [
			'Edit `then` and `else` branches by clicking their cards on the canvas.',
		] ),
	);
	return wrap;
}

function dynamicArgsFields(
	ctx: InspectorContext,
	step: RoutineStep,
): HTMLElement {
	const wrap = el( 'div', {} );
	let schema: Record< string, unknown > | null = null;
	if ( step.kind === 'action' ) {
		const found = ctx.catalog.actions.find( ( a ) => a.id === step.id );
		schema = ( found?.args_schema as Record< string, unknown > ) || null;
	} else if ( step.kind === 'ai_tool' ) {
		const found = ctx.catalog.ai_tools.find( ( t ) => t.name === step.id );
		const params = found?.parameters as
			| { properties?: Record< string, unknown > }
			| undefined;
		schema = params?.properties || null;
	}
	const args = step.args as Record< string, unknown >;

	if ( ! schema || Object.keys( schema ).length === 0 ) {
		// No schema declared — fall back to a free-form JSON editor.
		const ta = textareaField( JSON.stringify( args, null, 2 ), ( v ) => {
			try {
				step.args = JSON.parse( v );
				ctx.onChange();
			} catch {
				/* leave args alone until valid JSON */
			}
		} );
		attachAutocomplete( ta, () => suggestionsFor( ctx ) );
		wrap.append( formRow( 'Args (JSON)', ta ) );
		return wrap;
	}

	for ( const key of Object.keys( schema ) ) {
		const desc = ( schema[ key ] as { type?: string; description?: string } ) || {};
		const cur = args[ key ];
		let initial = '';
		if ( cur !== undefined && cur !== null ) {
			initial = typeof cur === 'string' ? cur : JSON.stringify( cur );
		}
		const input = textField( initial, ( v ) => {
			if ( desc.type === 'integer' || desc.type === 'number' ) {
				const n = parseFloat( v );
				args[ key ] = Number.isFinite( n ) ? n : v;
			} else {
				args[ key ] = v;
			}
			ctx.onChange();
		} );
		attachAutocomplete( input, () => suggestionsFor( ctx ) );
		wrap.append(
			formRow( key, input, desc.description || `Type: ${ desc.type || 'string' }` ),
		);
	}
	return wrap;
}

// ---- Field primitives ------------------------------------------------

function formRow(
	label: string,
	control: HTMLElement,
	hint?: string,
): HTMLElement {
	const row = el( 'div', { class: 'wpdm-routines__form-row' } );
	const lab = el( 'label', { class: 'wpdm-routines__form-label' } );
	lab.textContent = label;
	row.append( lab, control );
	if ( hint ) {
		const h = el( 'p', { class: 'wpdm-routines__form-hint' } );
		h.textContent = hint;
		row.append( h );
	}
	return row;
}

function textField(
	value: string,
	onChange: ( v: string ) => void,
): HTMLInputElement {
	const input = el( 'input', {
		class: 'wpdm-routines__input',
		type: 'text',
		value,
	} ) as HTMLInputElement;
	input.addEventListener( 'input', () => onChange( input.value ) );
	return input;
}

function numberField(
	value: string,
	onChange: ( v: string ) => void,
): HTMLInputElement {
	const input = el( 'input', {
		class: 'wpdm-routines__input',
		type: 'number',
		value,
	} ) as HTMLInputElement;
	input.addEventListener( 'input', () => onChange( input.value ) );
	return input;
}

function textareaField(
	value: string,
	onChange: ( v: string ) => void,
): HTMLTextAreaElement {
	const ta = el( 'textarea', {
		class: 'wpdm-routines__textarea',
		spellcheck: false,
	} ) as HTMLTextAreaElement;
	ta.value = value;
	ta.addEventListener( 'input', () => onChange( ta.value ) );
	return ta;
}

function selectField(
	options: string[],
	value: string,
	onChange: ( v: string ) => void,
): HTMLSelectElement {
	const sel = el( 'select', { class: 'wpdm-routines__input' } ) as HTMLSelectElement;
	for ( const opt of options ) {
		const o = el( 'option', { value: opt } ) as HTMLOptionElement;
		o.textContent = opt;
		if ( opt === value ) {
			o.selected = true;
		}
		sel.append( o );
	}
	sel.addEventListener( 'change', () => onChange( sel.value ) );
	return sel;
}

function operatorSelect(
	operators: Operator[],
	value: Operator,
	onChange: ( v: Operator ) => void,
): HTMLSelectElement {
	const sel = el( 'select', { class: 'wpdm-routines__input' } ) as HTMLSelectElement;
	for ( const op of operators ) {
		const o = el( 'option', { value: op } ) as HTMLOptionElement;
		o.textContent = op;
		if ( op === value ) {
			o.selected = true;
		}
		sel.append( o );
	}
	sel.addEventListener( 'change', () => onChange( sel.value as Operator ) );
	return sel;
}

function readOnly( value: string ): HTMLElement {
	const span = el( 'span', { class: 'wpdm-routines__readonly' } );
	span.textContent = value;
	return span;
}

// ---- Suggestion catalog (powering autocomplete) ----------------------

/**
 * Build the suggestion catalogue visible to whichever input the
 * autocomplete is attached to. Combines:
 *
 *   1. Trigger payload paths (always available)
 *   2. Site / user globals
 *   3. Variables produced by upstream steps (`vars.<step.id>`)
 *
 * The function gets re-invoked on every popover open so additions
 * to upstream step ids are picked up immediately.
 */
export function suggestionsFor( ctx: InspectorContext ): Suggestion[] {
	const out: Suggestion[] = [];

	// Site + user globals.
	out.push(
		{ path: 'site.url', type: 'string', description: 'Site URL', source: 'site' },
		{ path: 'site.name', type: 'string', description: 'Site name', source: 'site' },
		{ path: 'user.id', type: 'integer', description: 'Run-as user id', source: 'user' },
	);

	// Trigger payload paths.
	const declared = ctx.catalog.triggers.find(
		( t ) => t.id === ctx.def.trigger.id,
	);
	if ( declared && declared.payload_schema ) {
		for ( const [ path, raw ] of Object.entries( declared.payload_schema ) ) {
			const d = ( raw as { type?: string; description?: string } ) || {};
			out.push( {
				path: 'payload.' + path,
				type: d.type || 'unknown',
				description: d.description || '',
				source: 'payload',
			} );
		}
	} else {
		// Positional fallback for undeclared triggers.
		for ( let i = 0; i < 4; i++ ) {
			out.push( {
				path: `payload.arg${ i }`,
				type: 'unknown',
				description: 'Positional hook arg',
				source: 'payload',
			} );
		}
	}

	// Upstream step ids — collected by walking the step tree up to
	// the current target's path. Phase 2 keeps this simple: every
	// step with an explicit id at any depth above is a candidate.
	const upstream = collectStepIds( ctx.def.steps, ctx.target.stepPath );
	for ( const id of upstream ) {
		out.push( {
			path: `vars.${ id }`,
			type: 'unknown',
			description: 'Result of an upstream step',
			source: 'vars',
		} );
	}

	return out;
}

function collectStepIds(
	steps: RoutineStep[],
	stopAt: number[] | undefined,
): string[] {
	const out: string[] = [];
	const walk = ( list: RoutineStep[], path: number[] ): void => {
		for ( let i = 0; i < list.length; i++ ) {
			const here = [ ...path, i ];
			if ( stopAt && pathStartsWith( stopAt, here ) ) {
				return;
			}
			const step = list[ i ];
			if ( step.id ) {
				out.push( step.id );
			}
			if ( step.kind === 'if' ) {
				if ( step.then ) {
					walk( step.then, [ ...here, 0 ] );
				}
				if ( step.else ) {
					walk( step.else, [ ...here, 1 ] );
				}
			}
		}
	};
	walk( steps, [] );
	return out;
}

function pathStartsWith( a: number[], prefix: number[] ): boolean {
	if ( prefix.length > a.length ) {
		return false;
	}
	for ( let i = 0; i < prefix.length; i++ ) {
		if ( a[ i ] !== prefix[ i ] ) {
			return false;
		}
	}
	return true;
}
