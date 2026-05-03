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
 * Layout: cards live in NORMAL FLOW inside a flexbox column. The
 * browser handles every height / spacing concern; we never hand-
 * compute y coordinates. Branches are a flexbox row of two columns
 * inside the if-step's container — `then` and `else` are themselves
 * flex columns. After each rerender we make a single
 * `getBoundingClientRect()` pass to feed Pixi the real screen
 * positions in stage-local coordinates.
 *
 * Why no absolute positioning: the previous attempt (estimate, then
 * measure-and-place) overlapped cards as soon as content grew (a
 * third meta line, a long title, a custom template). Flex flow is
 * bulletproof against any of that.
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
import { mountViewport, type ViewportHandle } from './viewport';

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

	// Pan / zoom viewport — wraps the Pixi canvas + cards in a
	// transformed container. Both layers scale + translate together
	// so connectors stay perfectly aligned with their cards at any
	// zoom level. The toolbar (Fit / Reset / +/-) renders inside
	// the stage at the bottom-right, fixed-position relative to it.
	let viewport: ViewportHandle | null = null;

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

	viewport = mountViewport( stage );

	let pixi: PixiLayerHandle | null = null;
	try {
		// Pixi mounts inside `viewport.pixiHost` — a sibling of
		// `viewport.content`, NOT a child. The host stays at
		// native viewport pixel resolution while `content` (which
		// holds the cards) is CSS-transformed for pan/zoom.
		// Pixi mirrors the same transform via its own scene-graph
		// (`world.scale`/`world.position`), so connectors / halos
		// stay vector-sharp at any zoom level instead of being
		// bitmap-stretched by the parent's CSS scale.
		pixi = await mountPixiLayer( viewport.pixiHost, ctx.pluginUrl );
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
	viewport.content.append( cardLayer );

	// Shared anchor list — written by `rerender()`, re-read by the
	// ResizeObserver to avoid a full structural rebuild on every
	// resize event. Same array reference, different bounding rects
	// each tick.
	let trackedAnchors: Array< {
		id: string;
		el: HTMLElement;
		kind: CardAnchor[ 'kind' ];
		parentId?: string;
	} > = [];

	/**
	 * Layout strategy: STOP HAND-COMPUTING COORDINATES.
	 *
	 * Earlier passes tried to estimate or measure card heights and
	 * absolutely position each card at a hand-computed `(x, y)`.
	 * Both ways were brittle — estimates lied, measurements
	 * occasionally returned 0 or stale values during web-component
	 * upgrade, and any change to padding / line-wrap / shadow
	 * silently broke the math.
	 *
	 * Phase 2 final approach: cards live in NORMAL FLOW inside a
	 * flexbox column. The browser does what it's good at — laying
	 * content out top-to-bottom with no overlap, ever. After every
	 * rerender we read each card's `getBoundingClientRect()` once
	 * and feed those coordinates (in stage-local space) to the
	 * Pixi layer for connector + halo drawing.
	 *
	 * Branches are a flexbox row with two columns; the `then` and
	 * `else` step lists are themselves flex columns inside. CSS
	 * handles every height / spacing concern.
	 *
	 * Result: cards never overlap regardless of content. Adding a
	 * meta line, growing a title, swapping a built-in for a custom
	 * template — all flow naturally.
	 */
	const rerender = (): void => {
		cardLayer.replaceChildren();

		// Tracks the ordered list of anchored elements so we can do
		// a single `getBoundingClientRect()` pass after the DOM has
		// settled and feed Pixi authoritative coordinates.
		const tracked: Array< {
			id: string;
			el: HTMLElement;
			kind: CardAnchor[ 'kind' ];
			parentId?: string;
		} > = [];

		// Trigger card.
		const triggerNode = renderTriggerCard(
			ctx,
			() => setInspector( { kind: 'trigger' } ),
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
		cardLayer.append( triggerNode );
		tracked.push( { id: 'trigger', el: triggerNode, kind: 'trigger' } );

		// Conditions gate.
		const condNode = renderConditionsCard( ctx, () =>
			setInspector( { kind: 'condition' } ),
		);
		cardLayer.append( condNode );
		tracked.push( {
			id: 'conditions',
			el: condNode,
			kind: 'conditions',
			parentId: 'trigger',
		} );

		// Steps — recursive walk handles if/then/else as nested flex
		// rows. The walker appends into whichever container the
		// caller passes (root cardLayer, or a branch column).
		walkSteps(
			ctx,
			ctx.def.steps,
			[],
			'conditions',
			cardLayer,
			tracked,
			setInspector,
			() => rerender(),
			host,
		);

		// Trailing "+ Add step" button.
		const addNode = renderAddStepButton( ctx, [], host, () => rerender() );
		cardLayer.append( addNode );
		const lastStepEntry = [ ...tracked ]
			.reverse()
			.find( ( t ) => t.kind === 'step' );
		tracked.push( {
			id: 'add-root',
			el: addNode,
			kind: 'add',
			parentId: lastStepEntry?.id ?? 'conditions',
		} );

		// Hand the tracked list off to the ResizeObserver path so it
		// can refresh anchor positions on resize without rebuilding.
		trackedAnchors = tracked;

		pushAnchorsToPixi();
	};

	// Rate-limit `pixi.resize` to actual dimension changes. The
	// inspector slide-in transitions `grid-template-columns` over
	// 220ms; ResizeObserver fires every animation frame during that
	// transition, and a `renderer.resize()` call on every tick
	// clears the WebGL backing buffer for one frame on most drivers
	// — read by the user as a flicker on every halo + connector.
	// The canvas's CSS already stretches the `<canvas>` element to
	// fill its container (`width:100%; height:100%`), so visual
	// coverage stays correct during the transition; only the
	// internal pixel-buffer size needs to keep up, and only when
	// it actually changes.
	let lastResizeW = 0;
	let lastResizeH = 0;

	const pushAnchorsToPixi = (): void => {
		// Anchor coordinates are stored in cardLayer-LOCAL
		// (untransformed) space. Pixi's `world` layer then applies
		// the viewport's pan + zoom via `setTransform`, so the
		// renderer stays at native pixel resolution and paths are
		// re-rasterised sharp at every zoom level — no bitmap
		// stretching, no pixelation.
		if ( ! viewport ) {
			return;
		}
		const pixiRect = viewport.pixiHost.getBoundingClientRect();
		const state = viewport.getState();
		const zoom = state.zoom || 1;
		// Anchor (X, Y) is the card's position in pixiHost-local
		// UNTRANSFORMED space. Pixi's world layer then applies
		// scale=zoom + position=pan, mapping each anchor back to
		// the exact screen pixel where its card is drawn:
		//
		//   screen_x = pan.x + zoom * anchor.x
		//            = pan.x + zoom * ( ( card_screen_x - pixi_x - pan.x ) / zoom )
		//            = card_screen_x - pixi_x   ✓
		//
		// The math collapses to "wherever the browser placed the
		// card", which is exactly what we want — the connectors
		// follow whatever layout decision flexbox + the CSS
		// transform combined to produce, with zero arithmetic of
		// our own that could drift.
		const anchors: CardAnchor[] = trackedAnchors.map( ( t ) => {
			const r = t.el.getBoundingClientRect();
			return {
				id: t.id,
				x: ( r.left - pixiRect.left - state.pan.x ) / zoom,
				y: ( r.top - pixiRect.top - state.pan.y ) / zoom,
				width: r.width / zoom,
				height: r.height / zoom,
				kind: t.kind,
				parentId: t.parentId,
				state: 'idle',
			};
		} );

		// Pixi canvas covers the entire viewport.pixiHost (which is
		// itself the size of the visible viewport area, NOT scaled
		// with the content). So the renderer's pixel buffer matches
		// native screen resolution — no stretching, no pixelation.
		const w = Math.round( viewport.pixiHost.clientWidth );
		const h = Math.round( viewport.pixiHost.clientHeight );
		if ( w !== lastResizeW || h !== lastResizeH ) {
			lastResizeW = w;
			lastResizeH = h;
			pixi?.resize( w, h );
		}
		pixi?.setTransform( zoom, state.pan.x, state.pan.y );
		pixi?.setAnchors( anchors );
	};

	rerender();

	// "Hover-to-trace" — when the autocomplete (or any other UI
	// element) emits `wpdm-routines-highlight` with a step id /
	// payload path / "trigger" sentinel, glow the source card on
	// the canvas + scroll it into view. Lets the user follow a
	// `{{vars.foo}}` reference back to where it came from without
	// breaking their typing flow.
	const applyHighlight = ( source: string | null ): void => {
		cardLayer
			.querySelectorAll( '.is-highlighted' )
			.forEach( ( n ) => n.classList.remove( 'is-highlighted' ) );
		if ( ! source ) {
			return;
		}
		let targetId: string | null = null;
		if ( source.startsWith( 'payload' ) ) {
			targetId = 'trigger';
		} else if ( source.startsWith( 'vars.' ) ) {
			const stepId = source.slice( 'vars.'.length ).split( '.' )[ 0 ];
			const found = trackedAnchors.find(
				( t ) => t.kind === 'step' && t.el.dataset.stepId === stepId,
			);
			targetId = found?.id ?? null;
		}
		if ( ! targetId ) {
			return;
		}
		const tracked = trackedAnchors.find( ( t ) => t.id === targetId );
		if ( ! tracked ) {
			return;
		}
		tracked.el.classList.add( 'is-highlighted' );
		const r = tracked.el.getBoundingClientRect();
		const sr = stage.getBoundingClientRect();
		if ( r.top < sr.top || r.bottom > sr.bottom ) {
			tracked.el.scrollIntoView( {
				behavior: 'smooth',
				block: 'center',
				inline: 'nearest',
			} );
		}
		pixi?.pulse( targetId, 'active' );
	};
	host.addEventListener( 'wpdm-routines-highlight', ( ev ) => {
		const detail = ( ev as CustomEvent< { source: string | null } > )
			.detail;
		applyHighlight( detail?.source ?? null );
	} );

	// ResizeObserver re-reads anchor positions when the host size
	// changes (window maximize / split / mobile rotation). The DOM
	// tree hasn't changed — only positions — so we don't rerender;
	// we just push fresh bounding rects to Pixi.
	const ro = new ResizeObserver( () => {
		pushAnchorsToPixi();
	} );
	ro.observe( stage );

	// Re-paint Pixi anchors as the user pans / zooms.
	const offViewportChange = viewport.onChange( () => pushAnchorsToPixi() );

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
			offViewportChange();
			pixi?.destroy();
		},
	};
}

// ---- Card renderers --------------------------------------------------
//
// Every renderer returns ONLY a node. Heights come from
// `placeAndMeasure` after the node is in the DOM — the browser is
// the one source of truth for rendered size. Estimates are
// invariably wrong as soon as a card grows a third line of meta or
// a custom template kicks in.

function renderTriggerCard(
	ctx: CanvasContext,
	onInspect: () => void,
	onChange: () => void,
): HTMLElement {
	const declared = ctx.catalog.triggers.find(
		( t ) => t.id === ctx.def.trigger.id,
	);
	const node = el( 'article', {
		class: 'wpdm-routines__card wpdm-routines__card--trigger',
	} );

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
	return node;
}

function renderConditionsCard(
	ctx: CanvasContext,
	onInspect: () => void,
): HTMLElement {
	const node = el( 'article', {
		class: 'wpdm-routines__card wpdm-routines__card--conditions',
	} );
	const head = el( 'header', { class: 'wpdm-routines__card-head' } );
	const icon = el( 'span', { class: 'dashicons dashicons-filter' } );
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
	return node;
}

function renderAddStepButton(
	ctx: CanvasContext,
	pathPrefix: number[],
	host: HTMLElement,
	rerender: () => void,
): HTMLElement {
	const node = el( 'div', { class: 'wpdm-routines__add' } );
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
	return node;
}

function renderStepCard(
	ctx: CanvasContext,
	step: RoutineStep,
	path: number[],
	onInspect: ( target: InspectorTarget ) => void,
	rerender: () => void,
): HTMLElement {
	const node = el( 'article', {
		class: `wpdm-routines__card wpdm-routines__card--step wpdm-routines__card--${ step.kind }`,
		dataset: { stepId: step.id || '' },
	} );

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
	return node;
}

// ---- Walker ----------------------------------------------------------

interface Tracked {
	id: string;
	el: HTMLElement;
	kind: CardAnchor[ 'kind' ];
	parentId?: string;
}

function walkSteps(
	ctx: CanvasContext,
	steps: RoutineStep[],
	pathPrefix: number[],
	parentAnchor: string,
	host: HTMLElement,
	tracked: Tracked[],
	setInspector: ( t: InspectorTarget ) => void,
	rerender: () => void,
	rootHost: HTMLElement,
): void {
	let prev = parentAnchor;

	steps.forEach( ( step, i ) => {
		const path = [ ...pathPrefix, i ];
		const stepAnchorId = `step-${ pathToString( path ) }`;
		const node = renderStepCard( ctx, step, path, setInspector, rerender );
		host.append( node );
		tracked.push( {
			id: stepAnchorId,
			el: node,
			kind: 'step',
			parentId: prev,
		} );
		prev = stepAnchorId;

		if ( step.kind === 'if' ) {
			// Branches container: a flex row holding two columns.
			// CSS handles spacing + responsive wrapping.
			const branchesRow = el( 'div', {
				class: 'wpdm-routines__branches',
			} );
			host.append( branchesRow );

			const thenCol = el( 'div', {
				class: 'wpdm-routines__branch-col',
			} );
			const thenAnchor = `${ stepAnchorId }-then`;
			const thenHead = renderBranchHeader( 'then' );
			thenCol.append( thenHead );
			tracked.push( {
				id: thenAnchor,
				el: thenHead,
				kind: 'branch-then',
				parentId: stepAnchorId,
			} );
			walkSteps(
				ctx,
				step.then ?? [],
				[ ...path, -1 ],
				thenAnchor,
				thenCol,
				tracked,
				setInspector,
				rerender,
				rootHost,
			);
			const addThen = renderAddStepButton(
				ctx,
				[ ...path, -1 ],
				rootHost,
				rerender,
			);
			thenCol.append( addThen );

			const elseCol = el( 'div', {
				class: 'wpdm-routines__branch-col',
			} );
			const elseAnchor = `${ stepAnchorId }-else`;
			const elseHead = renderBranchHeader( 'else' );
			elseCol.append( elseHead );
			tracked.push( {
				id: elseAnchor,
				el: elseHead,
				kind: 'branch-else',
				parentId: stepAnchorId,
			} );
			walkSteps(
				ctx,
				step.else ?? [],
				[ ...path, -2 ],
				elseAnchor,
				elseCol,
				tracked,
				setInspector,
				rerender,
				rootHost,
			);
			const addElse = renderAddStepButton(
				ctx,
				[ ...path, -2 ],
				rootHost,
				rerender,
			);
			elseCol.append( addElse );

			branchesRow.append( thenCol, elseCol );
			// After a branch, the next step's parent is the if-card
			// itself (branches are visually nested inside the if).
			prev = stepAnchorId;
		}
	} );
}

function renderBranchHeader( kind: 'then' | 'else' ): HTMLElement {
	const node = el( 'div', {
		class: `wpdm-routines__branch-head wpdm-routines__branch-head--${ kind }`,
	} );
	const label = el( 'span', { class: 'wpdm-routines__branch-label' } );
	label.textContent = kind.toUpperCase();
	node.append( label );
	return node;
}

// ---- Helpers ---------------------------------------------------------

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
