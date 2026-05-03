/**
 * Routines — visual canvas (Phase 2).
 *
 * Hybrid architecture:
 *
 *   - **DOM** layer holds interactive cards (titles, summaries,
 *     buttons). Forms / inputs / focus / a11y stay native — Pixi
 *     can't host real form controls.
 *
 *   - **Pixi WebGL** layer underneath draws connectors, halos, the
 *     drifting dot grid, and the run-time animation (a packet of
 *     light tracing the flow with particle bursts on each step).
 *
 * Layout is top-down by index. `if` steps split into a two-column
 * indented sub-pipeline (then / else). Cards are absolutely
 * positioned so Pixi can read their geometry from the same DOMRect
 * the browser uses — no double-source-of-truth.
 *
 * @since 0.22.0
 */

import { el } from './dom';
import { renderInspector, type InspectorTarget } from './inspector';
import {
	mountPixiLayer,
	type CardAnchor,
	type PixiLayerHandle,
} from './pixi-layer';
import { pickStep, pickTrigger } from './picker';
import type {
	Catalog,
	RoutineDef,
	RoutineRun,
	RoutineStep,
} from './types';

export interface CanvasContext {
	def: RoutineDef;
	catalog: Catalog;
	pluginUrl: string;
	onChange: () => void;
	onTest: () => Promise< {
		status: 'success' | 'failure' | 'skipped';
		steps_log: RoutineRun[ 'steps_log' ];
	} | null >;
}

const CARD_WIDTH = 280;
const CARD_GAP_Y = 28;
const SECTION_GAP_Y = 36;
const BRANCH_GAP_X = 36;

/**
 * Mount a canvas inside `host`. Returns a handle the editor uses to
 * trigger redraws after structural changes (a step added, a trigger
 * picked) and to run the success-flow animation when a routine
 * fires.
 */
export interface CanvasHandle {
	rerender: () => void;
	playRun: ( steps_log: RoutineRun[ 'steps_log' ] ) => void;
	destroy: () => void;
}

export async function mountCanvas(
	host: HTMLElement,
	ctx: CanvasContext,
): Promise< CanvasHandle > {
	host.classList.add( 'wpdm-routines__canvas-host' );

	const stage = el( 'div', { class: 'wpdm-routines__canvas-stage' } );
	const inspectorSlot = el( 'aside', {
		class: 'wpdm-routines__canvas-inspector',
	} );
	host.append( stage, inspectorSlot );

	let inspectorTarget: InspectorTarget | null = null;
	const setInspector = ( target: InspectorTarget | null ): void => {
		inspectorTarget = target;
		paintInspector();
	};
	const closeInspector = (): void => setInspector( null );

	const paintInspector = (): void => {
		inspectorSlot.replaceChildren();
		if ( ! inspectorTarget ) {
			inspectorSlot.classList.remove( 'is-open' );
			return;
		}
		inspectorSlot.classList.add( 'is-open' );
		const panel = renderInspector( {
			def: ctx.def,
			catalog: ctx.catalog,
			target: inspectorTarget,
			onChange: () => {
				ctx.onChange();
				rerender();
			},
			onClose: closeInspector,
		} );
		inspectorSlot.append( panel );
	};

	let pixi: PixiLayerHandle | null = null;
	try {
		pixi = await mountPixiLayer( stage, ctx.pluginUrl );
	} catch ( err ) {
		// PixiJS load failed — the canvas still works as a pure DOM
		// pipeline. We surface a one-time hint so the user can hit F5
		// or check the network tab.
		const hint = el(
			'p',
			{ class: 'wpdm-routines__pixi-hint' },
			[ 'Visual effects unavailable (PixiJS failed to load).' ],
		);
		host.append( hint );
	}

	const cardLayer = el( 'div', { class: 'wpdm-routines__cards' } );
	stage.append( cardLayer );

	const rerender = (): void => {
		cardLayer.replaceChildren();
		const anchors: CardAnchor[] = [];
		const stageRect = { width: stage.clientWidth || 720, height: 0 };
		const centerX = ( stageRect.width - CARD_WIDTH ) / 2;

		let y = SECTION_GAP_Y;

		// Trigger card.
		const triggerEntry = renderTriggerCard(
			ctx,
			centerX,
			y,
			() => {
				setInspector( { kind: 'trigger' } );
			},
			async () => {
				const picked = await pickTrigger( host, ctx.catalog );
				if ( picked ) {
					ctx.def.trigger.kind = picked.kind;
					ctx.def.trigger.id = picked.id;
					ctx.def.trigger.priority = picked.priority;
					ctx.onChange();
					rerender();
				}
			},
		);
		cardLayer.append( triggerEntry.node );
		anchors.push( {
			id: 'trigger',
			x: centerX,
			y,
			width: CARD_WIDTH,
			height: triggerEntry.height,
			kind: 'trigger',
			state: 'idle',
		} );
		y += triggerEntry.height + SECTION_GAP_Y;

		// Conditions card (shown only if any are configured, with an
		// "Add condition" button regardless).
		const condEntry = renderConditionsCard(
			ctx,
			centerX,
			y,
			() => setInspector( { kind: 'condition' } ),
		);
		cardLayer.append( condEntry.node );
		anchors.push( {
			id: 'conditions',
			x: centerX,
			y,
			width: CARD_WIDTH,
			height: condEntry.height,
			kind: 'conditions',
			parentId: 'trigger',
		} );
		y += condEntry.height + SECTION_GAP_Y;

		// Steps — recursive walk for if-branches.
		const stepWalk = walkSteps(
			ctx,
			ctx.def.steps,
			[],
			centerX,
			y,
			'conditions',
			cardLayer,
			anchors,
			setInspector,
		);
		y = stepWalk.y;

		// Trailing "+ Add step" button.
		const addNode = renderAddStepButton( ctx, centerX, y, [], cardLayer, () => rerender() );
		cardLayer.append( addNode.node );
		anchors.push( {
			id: 'add-root',
			x: centerX + CARD_WIDTH / 2 - 80,
			y,
			width: 160,
			height: addNode.height,
			kind: 'add',
			parentId: previousAnchorId( anchors ),
		} );
		y += addNode.height + SECTION_GAP_Y;

		stageRect.height = y + 20;
		stage.style.minHeight = `${ stageRect.height }px`;
		cardLayer.style.height = `${ stageRect.height }px`;

		pixi?.resize( stageRect.width || 720, stageRect.height );
		pixi?.setAnchors( anchors );
	};

	rerender();

	// Walker children (branch add-buttons, step removers) ask for a
	// rebuild via a bubbling CustomEvent so they don't need a direct
	// reference to `rerender`. Cheap, no observers to clean up.
	host.addEventListener( 'wpdm-routines-rerender', () => rerender() );

	const ro = new ResizeObserver( () => {
		const w = stage.clientWidth || 720;
		const h = parseInt( stage.style.minHeight || '0', 10 ) || stage.clientHeight;
		pixi?.resize( w, h );
		rerender();
	} );
	ro.observe( stage );

	return {
		rerender,
		playRun: ( log ) => {
			if ( ! pixi ) {
				return;
			}
			const sequence: Array< { id: string; ok: boolean; ms: number } > =
				log.map( ( entry, i ) => ( {
					id:
						entry.id && entry.id !== ''
							? `step-${ findStepIndexById( ctx.def.steps, entry.id, [] ) ?? i }`
							: `step-${ i }`,
					ok: entry.ok,
					ms: entry.ms,
				} ) );
			pixi.playRun( sequence );
		},
		destroy: () => {
			ro.disconnect();
			pixi?.destroy();
		},
	};
}

// ---- Card renderers --------------------------------------------------

interface CardRender {
	node: HTMLElement;
	height: number;
}

function renderTriggerCard(
	ctx: CanvasContext,
	x: number,
	y: number,
	onInspect: () => void,
	onChange: () => void,
): CardRender {
	const declared = ctx.catalog.triggers.find(
		( t ) => t.id === ctx.def.trigger.id,
	);
	const node = el( 'article', {
		class: 'wpdm-routines__card wpdm-routines__card--trigger',
	} );
	positionCard( node, x, y );

	const head = el( 'header', { class: 'wpdm-routines__card-head' } );
	const icon = el( 'span', {
		class: `dashicons ${ declared?.icon || 'dashicons-flag' }`,
	} );
	icon.setAttribute( 'aria-hidden', 'true' );
	const titleWrap = el( 'div', { class: 'wpdm-routines__card-title-wrap' } );
	const eyebrow = el( 'span', { class: 'wpdm-routines__card-eyebrow' } );
	eyebrow.textContent = 'Trigger';
	const title = el( 'h3', { class: 'wpdm-routines__card-title' } );
	title.textContent = declared?.label || ctx.def.trigger.id || 'Pick a trigger';
	titleWrap.append( eyebrow, title );
	head.append( icon, titleWrap );
	node.append( head );

	const meta = el( 'p', { class: 'wpdm-routines__card-meta' } );
	meta.textContent = `${ ctx.def.trigger.kind } • ${ ctx.def.trigger.id || '—' } • priority ${ ctx.def.trigger.priority }`;
	node.append( meta );

	const bar = el( 'div', { class: 'wpdm-routines__card-bar' } );
	const editBtn = el(
		'button',
		{ class: 'wpdm-routines__card-btn', type: 'button' },
		[ 'Inspect' ],
	);
	editBtn.addEventListener( 'click', ( ev ) => {
		ev.stopPropagation();
		onInspect();
	} );
	const changeBtn = el(
		'button',
		{ class: 'wpdm-routines__card-btn', type: 'button' },
		[ 'Change trigger' ],
	);
	changeBtn.addEventListener( 'click', ( ev ) => {
		ev.stopPropagation();
		onChange();
	} );
	bar.append( editBtn, changeBtn );
	node.append( bar );

	node.addEventListener( 'click', onInspect );

	const height = estimateCardHeight( declared?.label ? 1 : 1 );
	return { node, height };
}

function renderConditionsCard(
	ctx: CanvasContext,
	x: number,
	y: number,
	onInspect: () => void,
): CardRender {
	const node = el( 'article', {
		class: 'wpdm-routines__card wpdm-routines__card--conditions',
	} );
	positionCard( node, x, y );
	const head = el( 'header', { class: 'wpdm-routines__card-head' } );
	const icon = el( 'span', {
		class: 'dashicons dashicons-filter',
	} );
	icon.setAttribute( 'aria-hidden', 'true' );
	const titleWrap = el( 'div', { class: 'wpdm-routines__card-title-wrap' } );
	const eyebrow = el( 'span', { class: 'wpdm-routines__card-eyebrow' } );
	eyebrow.textContent = 'Gate';
	const title = el( 'h3', { class: 'wpdm-routines__card-title' } );
	title.textContent = ctx.def.conditions.length
		? `If ${ ctx.def.conditions.length } condition${ ctx.def.conditions.length === 1 ? '' : 's' } pass`
		: 'No conditions — runs every time';
	titleWrap.append( eyebrow, title );
	head.append( icon, titleWrap );
	node.append( head );

	if ( ctx.def.conditions.length > 0 ) {
		const list = el( 'ul', { class: 'wpdm-routines__cond-list' } );
		for ( const cond of ctx.def.conditions ) {
			const li = el( 'li', {} );
			const code = el( 'code', {} );
			code.textContent = `${ String( cond.left ) } ${ cond.op } ${ String( cond.right ) }`;
			li.append( code );
			list.append( li );
		}
		node.append( list );
	}

	node.addEventListener( 'click', onInspect );

	const height = estimateCardHeight( 1 + ctx.def.conditions.length * 0.5 );
	return { node, height };
}

function renderAddStepButton(
	ctx: CanvasContext,
	x: number,
	y: number,
	pathPrefix: number[],
	host: HTMLElement,
	rerender: () => void,
): CardRender {
	const node = el( 'div', { class: 'wpdm-routines__add' } );
	const cx = x + CARD_WIDTH / 2 - 80;
	node.style.cssText = `left:${ cx }px;top:${ y }px;width:160px;`;
	const btn = el(
		'button',
		{ class: 'wpdm-routines__add-btn', type: 'button' },
	);
	btn.append( '+ Add step' );
	btn.addEventListener( 'click', async () => {
		const picked = await pickStep( host.parentElement || host, ctx.catalog );
		if ( ! picked ) {
			return;
		}
		const step: RoutineStep = {
			kind: picked.kind,
			id: picked.id,
			args: defaultArgsFor( picked.kind ),
		};
		if ( picked.kind === 'if' ) {
			step.condition = { left: '', op: 'eq', right: '' };
			step.then = [];
			step.else = [];
		}
		const target = resolveStepList( ctx.def.steps, pathPrefix );
		target.push( step );
		ctx.onChange();
		rerender();
	} );
	node.append( btn );
	return { node, height: 44 };
}

function renderStepCard(
	ctx: CanvasContext,
	step: RoutineStep,
	path: number[],
	x: number,
	y: number,
	onInspect: ( target: InspectorTarget ) => void,
	rerender: () => void,
): CardRender {
	const node = el( 'article', {
		class: `wpdm-routines__card wpdm-routines__card--step wpdm-routines__card--${ step.kind }`,
		dataset: { stepId: step.id || '' },
	} );
	positionCard( node, x, y );

	const head = el( 'header', { class: 'wpdm-routines__card-head' } );
	const icon = el( 'span', { class: `dashicons ${ iconFor( step ) }` } );
	icon.setAttribute( 'aria-hidden', 'true' );
	const titleWrap = el( 'div', { class: 'wpdm-routines__card-title-wrap' } );
	const eyebrow = el( 'span', { class: 'wpdm-routines__card-eyebrow' } );
	eyebrow.textContent = step.kind.replace( '_', ' ' );
	const title = el( 'h3', { class: 'wpdm-routines__card-title' } );
	title.textContent = stepTitle( step, ctx );
	titleWrap.append( eyebrow, title );
	head.append( icon, titleWrap );
	node.append( head );

	const summary = stepSummary( step );
	if ( summary ) {
		const meta = el( 'p', { class: 'wpdm-routines__card-meta' } );
		meta.textContent = summary;
		node.append( meta );
	}

	const bar = el( 'div', { class: 'wpdm-routines__card-bar' } );
	const removeBtn = el(
		'button',
		{
			class: 'wpdm-routines__card-btn wpdm-routines__card-btn--danger',
			type: 'button',
		},
		[ 'Remove' ],
	);
	removeBtn.addEventListener( 'click', ( ev ) => {
		ev.stopPropagation();
		const list = resolveStepList(
			ctx.def.steps,
			path.slice( 0, path.length - 1 ),
		);
		list.splice( path[ path.length - 1 ], 1 );
		ctx.onChange();
		rerender();
	} );
	bar.append( removeBtn );
	node.append( bar );

	node.addEventListener( 'click', () =>
		onInspect( { kind: 'step', stepPath: path, step } ),
	);

	const height = estimateCardHeight(
		summary ? 1.5 : 1,
		step.kind === 'if' ? 1.4 : 1,
	);
	return { node, height };
}

// ---- Walker ----------------------------------------------------------

interface WalkResult {
	y: number;
}

function walkSteps(
	ctx: CanvasContext,
	steps: RoutineStep[],
	pathPrefix: number[],
	centerX: number,
	startY: number,
	parentAnchor: string,
	host: HTMLElement,
	anchors: CardAnchor[],
	setInspector: ( t: InspectorTarget ) => void,
): WalkResult {
	let y = startY;
	let prev = parentAnchor;

	steps.forEach( ( step, i ) => {
		const path = [ ...pathPrefix, i ];
		const stepAnchorId = `step-${ pathToString( path ) }`;
		const card = renderStepCard(
			ctx,
			step,
			path,
			centerX,
			y,
			setInspector,
			() => walkRebuild( ctx, host ),
		);
		host.append( card.node );
		anchors.push( {
			id: stepAnchorId,
			x: centerX,
			y,
			width: CARD_WIDTH,
			height: card.height,
			kind: 'step',
			parentId: prev,
		} );
		y += card.height + CARD_GAP_Y;
		prev = stepAnchorId;

		if ( step.kind === 'if' ) {
			// Two columns under the if card. Then on the left, else on
			// the right. Each column gets a "branch header" anchor so
			// the connector colours apart cleanly.
			const halfWidth = CARD_WIDTH;
			const thenX = centerX - halfWidth / 2 - BRANCH_GAP_X / 2;
			const elseX = centerX + halfWidth / 2 + BRANCH_GAP_X / 2;

			const thenHead = renderBranchHeader(
				'then',
				thenX,
				y,
			);
			host.append( thenHead.node );
			const thenAnchor = `${ stepAnchorId }-then`;
			anchors.push( {
				id: thenAnchor,
				x: thenX,
				y,
				width: CARD_WIDTH,
				height: thenHead.height,
				kind: 'branch-then',
				parentId: stepAnchorId,
			} );
			const elseHead = renderBranchHeader( 'else', elseX, y );
			host.append( elseHead.node );
			const elseAnchor = `${ stepAnchorId }-else`;
			anchors.push( {
				id: elseAnchor,
				x: elseX,
				y,
				width: CARD_WIDTH,
				height: elseHead.height,
				kind: 'branch-else',
				parentId: stepAnchorId,
			} );

			const yThen = y + thenHead.height + CARD_GAP_Y;
			const yElse = y + elseHead.height + CARD_GAP_Y;

			const thenWalk = walkSteps(
				ctx,
				step.then ?? [],
				[ ...path, /* sentinel for `then` */ -1 ],
				thenX,
				yThen,
				thenAnchor,
				host,
				anchors,
				setInspector,
			);
			const elseWalk = walkSteps(
				ctx,
				step.else ?? [],
				[ ...path, /* sentinel for `else` */ -2 ],
				elseX,
				yElse,
				elseAnchor,
				host,
				anchors,
				setInspector,
			);

			// Add-step buttons inside each branch.
			const addThen = renderAddStepButton(
				ctx,
				thenX,
				thenWalk.y,
				[ ...path, -1 ],
				host,
				() => walkRebuild( ctx, host ),
			);
			host.append( addThen.node );
			const addElse = renderAddStepButton(
				ctx,
				elseX,
				elseWalk.y,
				[ ...path, -2 ],
				host,
				() => walkRebuild( ctx, host ),
			);
			host.append( addElse.node );

			y = Math.max( thenWalk.y, elseWalk.y ) + addThen.height + SECTION_GAP_Y;
			// After a branch, the next step's parent is the if-card
			// itself (the branches are visually inside the if).
			prev = stepAnchorId;
		}
	} );

	return { y };
}

function walkRebuild( ctx: CanvasContext, host: HTMLElement ): void {
	// Rebuild is driven by the canvas's outer rerender. The walker
	// receives a closure that calls back into it; this small helper
	// re-emits a synthetic "structural" change so the host invokes
	// the canvas's rerender. We keep it as a separate hop so the
	// branch add-buttons can call it without holding a direct
	// reference to the outer mountCanvas closure.
	host.dispatchEvent(
		new CustomEvent( 'wpdm-routines-rerender', { bubbles: true } ),
	);
	void ctx; // silence "unused" — kept for API parity with other walkers.
}

function renderBranchHeader(
	kind: 'then' | 'else',
	x: number,
	y: number,
): CardRender {
	const node = el( 'div', {
		class: `wpdm-routines__branch-head wpdm-routines__branch-head--${ kind }`,
	} );
	positionCard( node, x, y );
	const label = el( 'span', { class: 'wpdm-routines__branch-label' } );
	label.textContent = kind.toUpperCase();
	node.append( label );
	return { node, height: 36 };
}

// ---- Helpers ---------------------------------------------------------

function positionCard( node: HTMLElement, x: number, y: number ): void {
	node.style.cssText = `left:${ x }px;top:${ y }px;width:${ CARD_WIDTH }px;`;
}

function estimateCardHeight(
	textLines: number,
	multiplier = 1,
): number {
	// 96 = head + meta + button bar with single-line title.
	// Each extra line adds ~18px; each multiplier point adds ~28px.
	return Math.round( 96 + ( textLines - 1 ) * 22 + ( multiplier - 1 ) * 28 );
}

function iconFor( step: RoutineStep ): string {
	switch ( step.kind ) {
		case 'log':
			return 'dashicons-text';
		case 'email':
			return 'dashicons-email';
		case 'http':
			return 'dashicons-cloud';
		case 'wait':
			return 'dashicons-clock';
		case 'set_var':
			return 'dashicons-tag';
		case 'stop':
			return 'dashicons-no';
		case 'if':
			return 'dashicons-randomize';
		case 'action':
			return 'dashicons-controls-play';
		case 'ai_tool':
			return 'dashicons-superhero';
		case 'command':
			return 'dashicons-arrow-right-alt';
	}
	return 'dashicons-marker';
}

function stepTitle( step: RoutineStep, ctx: CanvasContext ): string {
	if ( step.kind === 'action' ) {
		const a = ctx.catalog.actions.find( ( x ) => x.id === step.id );
		return a?.label || step.id || 'Action';
	}
	if ( step.kind === 'ai_tool' ) {
		return step.id || 'AI tool';
	}
	if ( step.kind === 'command' ) {
		return step.id || 'Command';
	}
	if ( step.kind === 'if' ) {
		return 'If / then / else';
	}
	if ( step.kind === 'log' ) {
		return 'Log message';
	}
	if ( step.kind === 'email' ) {
		return 'Send email';
	}
	if ( step.kind === 'http' ) {
		return 'HTTP request';
	}
	if ( step.kind === 'wait' ) {
		return 'Wait';
	}
	if ( step.kind === 'set_var' ) {
		return 'Set variable';
	}
	if ( step.kind === 'stop' ) {
		return 'Stop';
	}
	return step.kind;
}

function stepSummary( step: RoutineStep ): string {
	const args = step.args as Record< string, unknown >;
	if ( step.kind === 'log' ) {
		return String( args.message || '' ).slice( 0, 80 );
	}
	if ( step.kind === 'email' ) {
		return `${ args.to || 'admin' } — ${ String( args.subject || '' ).slice( 0, 60 ) }`;
	}
	if ( step.kind === 'http' ) {
		return `${ String( args.method || 'GET' ).toUpperCase() } ${ String( args.url || '' ).slice( 0, 60 ) }`;
	}
	if ( step.kind === 'wait' ) {
		return `${ args.seconds ?? 1 }s`;
	}
	if ( step.kind === 'if' && step.condition ) {
		return `${ String( step.condition.left ) } ${ step.condition.op } ${ String( step.condition.right ) }`;
	}
	if ( step.kind === 'set_var' ) {
		return `${ args.name } = ${ JSON.stringify( args.value ) }`;
	}
	if ( step.kind === 'stop' ) {
		return String( args.reason || '' );
	}
	if ( step.kind === 'action' || step.kind === 'ai_tool' ) {
		return Object.keys( args ).slice( 0, 3 ).join( ', ' );
	}
	return '';
}

function defaultArgsFor( kind: RoutineStep[ 'kind' ] ): Record< string, unknown > {
	switch ( kind ) {
		case 'log':
			return { level: 'info', message: '' };
		case 'email':
			return { to: '', subject: '', body: '' };
		case 'http':
			return { method: 'GET', url: '', body: '' };
		case 'wait':
			return { seconds: 1 };
		case 'set_var':
			return { name: '', value: '' };
		case 'stop':
			return { reason: '' };
		case 'if':
			return {};
	}
	return {};
}

function resolveStepList(
	root: RoutineStep[],
	path: number[],
): RoutineStep[] {
	let cur: RoutineStep[] = root;
	for ( let i = 0; i < path.length; i++ ) {
		const idx = path[ i ];
		if ( idx === -1 ) {
			// `then` sentinel
			const parent = cur[ path[ i - 1 ] ];
			cur = parent?.then ?? [];
			continue;
		}
		if ( idx === -2 ) {
			const parent = cur[ path[ i - 1 ] ];
			cur = parent?.else ?? [];
			continue;
		}
		// Walking past a regular index — only used when the next
		// hop is a branch sentinel.
		if ( i === path.length - 1 ) {
			return cur;
		}
	}
	return cur;
}

function pathToString( path: number[] ): string {
	return path
		.map( ( n ) => {
			if ( n === -1 ) {
				return 'T';
			}
			if ( n === -2 ) {
				return 'E';
			}
			return String( n );
		} )
		.join( '.' );
}

function previousAnchorId( anchors: CardAnchor[] ): string {
	for ( let i = anchors.length - 1; i >= 0; i-- ) {
		if ( anchors[ i ].kind !== 'add' ) {
			return anchors[ i ].id;
		}
	}
	return 'trigger';
}

function findStepIndexById(
	steps: RoutineStep[],
	id: string,
	path: number[],
): string | null {
	for ( let i = 0; i < steps.length; i++ ) {
		const here = [ ...path, i ];
		if ( steps[ i ].id === id ) {
			return pathToString( here );
		}
		if ( steps[ i ].kind === 'if' ) {
			const inThen = findStepIndexById(
				steps[ i ].then ?? [],
				id,
				[ ...here, -1 ],
			);
			if ( inThen ) {
				return inThen;
			}
			const inElse = findStepIndexById(
				steps[ i ].else ?? [],
				id,
				[ ...here, -2 ],
			);
			if ( inElse ) {
				return inElse;
			}
		}
	}
	return null;
}
