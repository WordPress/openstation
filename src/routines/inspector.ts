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
		classify: 'Classify with AI',
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
	// Three-row layout (Left / Operator / Right) instead of one
	// horizontal row — at 280–360px panel widths the squeezed
	// horizontal version is cramped, and the vertical version
	// gives space for the variable-picker button without crowding
	// the value input.
	const row = el( 'div', { class: 'wpdm-routines__condition' } );

	const remove = el(
		'button',
		{
			class:
				'wpdm-routines__icon-btn wpdm-routines__condition-remove',
			type: 'button',
			title: 'Remove condition',
		},
		[ '×' ],
	);
	remove.addEventListener( 'click', onRemove );
	row.append( remove );

	row.append(
		labelledValueField( 'Left', String( cond.left ?? '' ), ctx, ( v ) => {
			cond.left = v;
			ctx.onChange();
		} ),
		formRow(
			'Operator',
			operatorSelect( ctx.catalog.operators, cond.op, ( v ) => {
				cond.op = v;
				ctx.onChange();
			} ),
		),
		labelledValueField(
			'Right',
			String( cond.right ?? '' ),
			ctx,
			( v ) => {
				cond.right = v;
				ctx.onChange();
			},
		),
	);

	return row;
}

/**
 * A value field with an inline "Variables" picker — the input
 * accepts free-form text + `{{placeholder}}` syntax with caret-
 * triggered autocomplete, but a button next to it opens a
 * popover listing every available variable (payload paths,
 * upstream step results, site/user globals) so users don't have
 * to know about the `{{ }}` syntax to discover what's there.
 *
 * @internal
 */
function labelledValueField(
	label: string,
	initial: string,
	ctx: InspectorContext,
	onInput: ( v: string ) => void,
): HTMLElement {
	const wrap = el( 'div', { class: 'wpdm-routines__form-row' } );
	const lab = el( 'label', { class: 'wpdm-routines__form-label' } );
	lab.textContent = label;
	wrap.append( lab );

	const inputWrap = el( 'div', { class: 'wpdm-routines__value-input' } );
	const input = textField( initial, onInput );
	attachAutocomplete( input, () => suggestionsFor( ctx ) );
	const picker = buildVarPickerButton( input, ctx );
	inputWrap.append( input, picker );
	wrap.append( inputWrap );
	return wrap;
}

/**
 * "{x}" button that opens a popover of every available variable.
 * Replaces the input value with `{{path}}` on selection — most
 * condition operands are single placeholders, so a full replace
 * is the right default. (For mixed text the user can still
 * type `{{` directly to invoke the inline autocomplete and
 * insert at the caret instead.)
 *
 * @internal
 */
function buildVarPickerButton(
	input: HTMLInputElement,
	ctx: InspectorContext,
): HTMLButtonElement {
	const btn = el( 'button', {
		class: 'wpdm-routines__var-picker-btn',
		type: 'button',
		title: 'Pick a variable',
	} ) as HTMLButtonElement;
	btn.textContent = '{x}';
	btn.addEventListener( 'click', ( ev ) => {
		ev.preventDefault();
		ev.stopPropagation();
		openVarPickerPopover( btn, input, ctx );
	} );
	return btn;
}

/**
 * Render a popover anchored to `anchor`, listing every
 * suggestion grouped by source. Click an entry → replace the
 * input's value with `{{path}}` and dispatch `input` so the
 * routine def updates. Clicking outside closes.
 *
 * @internal
 */
function openVarPickerPopover(
	anchor: HTMLElement,
	input: HTMLInputElement,
	ctx: InspectorContext,
): void {
	// Single popover at a time — close any existing first.
	document
		.querySelectorAll( '.wpdm-routines__var-popover' )
		.forEach( ( n ) => n.remove() );

	const list = suggestionsFor( ctx );
	if ( list.length === 0 ) {
		return;
	}

	const pop = el( 'div', { class: 'wpdm-routines__var-popover' } );
	const groups = new Map< string, typeof list >();
	const labels: Record< string, string > = {
		payload: 'Trigger payload',
		vars: 'Upstream step results',
		site: 'Site',
		user: 'User',
		custom: 'Other',
	};
	for ( const s of list ) {
		const arr = groups.get( s.source ) ?? [];
		arr.push( s );
		groups.set( s.source, arr );
	}
	const order: Array< keyof typeof labels > = [
		'payload',
		'vars',
		'site',
		'user',
		'custom',
	];
	for ( const key of order ) {
		const items = groups.get( key );
		if ( ! items || items.length === 0 ) {
			continue;
		}
		const heading = el( 'h5', { class: 'wpdm-routines__var-popover-h' } );
		heading.textContent = labels[ key ];
		pop.append( heading );
		for ( const s of items ) {
			const item = el( 'button', {
				class: 'wpdm-routines__var-popover-item',
				type: 'button',
			} );
			const path = el( 'span', {
				class: 'wpdm-routines__var-popover-path',
			} );
			path.textContent = s.path;
			item.append( path );
			if ( s.type ) {
				const ty = el( 'span', {
					class: 'wpdm-routines__var-popover-type',
				} );
				ty.textContent = s.type;
				item.append( ty );
			}
			if ( s.description ) {
				const desc = el( 'span', {
					class: 'wpdm-routines__var-popover-desc',
				} );
				desc.textContent = s.description;
				item.append( desc );
			}
			// Hover-to-trace — same as autocomplete: glow the
			// source card on the canvas.
			item.addEventListener( 'mouseenter', () => {
				input.dispatchEvent(
					new CustomEvent( 'wpdm-routines-highlight', {
						bubbles: true,
						detail: { source: s.path },
					} ),
				);
			} );
			item.addEventListener( 'mouseleave', () => {
				input.dispatchEvent(
					new CustomEvent( 'wpdm-routines-highlight', {
						bubbles: true,
						detail: { source: null },
					} ),
				);
			} );
			item.addEventListener( 'click', ( ev ) => {
				ev.preventDefault();
				input.value = `{{${ s.path }}}`;
				input.dispatchEvent(
					new Event( 'input', { bubbles: true } ),
				);
				close();
				input.focus();
			} );
			pop.append( item );
		}
	}

	const ar = anchor.getBoundingClientRect();
	pop.style.top = `${ ar.bottom + 4 }px`;
	pop.style.left = `${ ar.left }px`;
	document.body.append( pop );

	const close = (): void => {
		pop.remove();
		document.removeEventListener( 'pointerdown', onOutside, true );
		document.removeEventListener( 'keydown', onKey );
	};
	const onOutside = ( ev: PointerEvent ): void => {
		if ( ! pop.contains( ev.target as Node ) ) {
			close();
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			close();
		}
	};
	// Defer adding the outside listener so the click that opened
	// the popover doesn't immediately close it.
	setTimeout( () => {
		document.addEventListener( 'pointerdown', onOutside, true );
		document.addEventListener( 'keydown', onKey );
	}, 0 );
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
		case 'classify':
			wrap.append( classifyFields( ctx, step ) );
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
			'Host must be in `desktop_mode_routine_http_allowlist` (default: empty).',
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

/**
 * Classify-step inspector — bucket-list editor + input + optional
 * extra instructions. The step's downstream variable shape is
 * `vars.<step.id>.bucket_id` / `.confidence` / `.reasoning`, so a
 * helpful hint at the bottom shows the user how to reference it.
 *
 * @internal
 */
function classifyFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	const args = step.args as {
		input?: string;
		buckets?: Array< { id: string; description: string } >;
		instructions?: string;
	};
	if ( ! Array.isArray( args.buckets ) ) {
		args.buckets = [
			{ id: 'spam', description: 'Spam / unwanted' },
			{ id: 'ham', description: 'Legitimate' },
		];
	}

	// Input field with the variable picker — typical use is a
	// `{{payload.comment.content}}` or similar single placeholder.
	const inputEl = textField( args.input || '', ( v ) => {
		args.input = v;
		ctx.onChange();
	} );
	attachAutocomplete( inputEl, () => suggestionsFor( ctx ) );
	const inputRow = el( 'div', { class: 'wpdm-routines__form-row' } );
	const inputLab = el( 'label', { class: 'wpdm-routines__form-label' } );
	inputLab.textContent = 'Text to classify';
	const inputWrap = el( 'div', { class: 'wpdm-routines__value-input' } );
	inputWrap.append( inputEl );
	inputRow.append( inputLab, inputWrap );
	const inputHint = el( 'p', { class: 'wpdm-routines__form-hint' } );
	inputHint.textContent =
		'Pick a payload variable (e.g. comment content) or type a literal.';
	inputRow.append( inputHint );
	wrap.append( inputRow );

	// Bucket list editor.
	const bucketsHeader = el( 'label', { class: 'wpdm-routines__form-label' } );
	bucketsHeader.textContent = 'Buckets — at least 2';
	wrap.append( bucketsHeader );

	const list = el( 'div', { class: 'wpdm-routines__buckets' } );
	wrap.append( list );

	const repaintBuckets = (): void => {
		list.replaceChildren();
		( args.buckets ?? [] ).forEach( ( bucket, i ) => {
			const row = el( 'div', { class: 'wpdm-routines__bucket-row' } );
			const idIn = el( 'input', {
				class: 'wpdm-routines__input wpdm-routines__bucket-id',
				type: 'text',
				placeholder: 'id',
				value: bucket.id,
			} ) as HTMLInputElement;
			idIn.addEventListener( 'input', () => {
				bucket.id = idIn.value
					.toLowerCase()
					.replace( /[^a-z0-9_\-]/g, '_' );
				ctx.onChange();
			} );
			const descIn = el( 'input', {
				class: 'wpdm-routines__input wpdm-routines__bucket-desc',
				type: 'text',
				placeholder: 'short description (helps the AI choose)',
				value: bucket.description,
			} ) as HTMLInputElement;
			descIn.addEventListener( 'input', () => {
				bucket.description = descIn.value;
				ctx.onChange();
			} );
			const remove = el(
				'button',
				{
					class: 'wpdm-routines__icon-btn',
					type: 'button',
					title: 'Remove bucket',
				},
				[ '×' ],
			);
			remove.addEventListener( 'click', () => {
				args.buckets!.splice( i, 1 );
				ctx.onChange();
				repaintBuckets();
			} );
			row.append( idIn, descIn, remove );
			list.append( row );
		} );
	};
	repaintBuckets();

	const addBtn = el(
		'button',
		{ class: 'wpdm-routines__btn', type: 'button' },
		[ '+ Add bucket' ],
	);
	addBtn.addEventListener( 'click', () => {
		args.buckets!.push( { id: '', description: '' } );
		ctx.onChange();
		repaintBuckets();
	} );
	wrap.append( addBtn );

	// Optional extra instructions for the classifier — niche
	// (think "always treat anything mentioning competitors as
	// urgent") so kept folded into a single textarea.
	const instructionsEl = textareaField(
		args.instructions || '',
		( v ) => {
			args.instructions = v;
			ctx.onChange();
		},
	);
	wrap.append(
		formRow(
			'Extra context (optional)',
			instructionsEl,
			'Any extra hints for the classifier — e.g. "treat company-name mentions as `important`".',
		),
	);

	// Variable hint — once the user has set a step id the
	// downstream tokens become `{{vars.<id>.bucket_id}}` etc.
	const hintBox = el( 'div', { class: 'wpdm-routines__classify-hint' } );
	const hintTitle = el( 'span', {
		class: 'wpdm-routines__classify-hint-title',
	} );
	hintTitle.textContent = 'Use the result downstream:';
	const hintList = el( 'ul', {} );
	const stepRef = step.id || '<step-id>';
	hintList.append(
		el( 'li', {}, [ `{{vars.${ stepRef }.bucket_id}} — picked bucket` ] ),
		el( 'li', {}, [ `{{vars.${ stepRef }.confidence}} — 0.0–1.0` ] ),
		el( 'li', {}, [ `{{vars.${ stepRef }.reasoning}} — one-sentence rationale` ] ),
	);
	hintBox.append( hintTitle, hintList );
	wrap.append( hintBox );

	return wrap;
}

function ifFields( ctx: InspectorContext, step: RoutineStep ): HTMLElement {
	const wrap = el( 'div', {} );
	if ( ! step.condition ) {
		step.condition = { left: '', op: 'eq', right: '' };
	}
	const cond = step.condition;
	wrap.append(
		labelledValueField( 'Left', String( cond.left ?? '' ), ctx, ( v ) => {
			cond.left = v;
			ctx.onChange();
		} ),
		formRow(
			'Operator',
			operatorSelect( ctx.catalog.operators, cond.op, ( v ) => {
				cond.op = v;
				ctx.onChange();
			} ),
		),
		labelledValueField( 'Right', String( cond.right ?? '' ), ctx, ( v ) => {
			cond.right = v;
			ctx.onChange();
		} ),
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
