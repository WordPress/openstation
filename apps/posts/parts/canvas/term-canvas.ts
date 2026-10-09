/**
 * Posts app — the term canvas every taxonomy view is built on.
 *
 * The Categories mind map and the Tags cloud are one surface with two
 * metaphors: a PixiJS world inside an HTML chrome, a camera, a post
 * fan around the focused term, a sidebar editor. This module owns the
 * shared half — loading PixiJS, the chrome and the stage, the layers,
 * the camera and the pan gesture, the term fetch and the bulk-count
 * reconcile, the focus / close choreography (view restore, the
 * spotlight keep-out zone), the frame loop (paused while the tab or
 * the window is not visible), the search box, recentering, the empty
 * hint and the teardown. A canvas supplies its metaphor through
 * {@link TermCanvasHooks}: how it draws, what its bounds are, where a
 * term sits, what a pointer does to it.
 *
 * @public
 */

import type { CanvasEnv } from '../app';
import type { TermRow } from '../types';
import {
	isPinchGesture,
	POST_RING_RADIUS,
	createCamera,
	createInteraction,
	isEmptyCanvasClick,
	watchStageSize,
	type Bounds,
	type Camera,
	type Interaction,
} from './camera';
import { CANVAS_PREFIX, buildCanvasChrome, wireCanvasSearch, type CanvasChrome, type ChromeButton } from './chrome';
import { createPixiApp, destroyPixiApp, loadPixi, type PixiApp, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiPoint, type PixiPointerEvent } from './pixi';
import { mountTermDirectory } from './directory';
import { readCanvasPalette, watchCanvasPalette, type CanvasPalette } from './palette';
import { createPostFan, type PostFan } from './post-fan';

/**
 * The post ring + room for the pager + breathing room, so neighbouring
 * terms sit clearly outside the satellite cards.
 */
export const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

export interface TermCanvasSpec {
	taxonomy: 'categories' | 'tags';
	restTaxonomy: 'category' | 'post_tag';
	/** The host modifier class — the surface's own background. */
	modifier: string;
	unavailable: string;
	loadFailed: string;
	emptyHint: string;
	chrome: { buttons: ChromeButton[]; searchPlaceholder: string; searchAria: string; hint: string };
	/** Layer names, back to front. `postEdge`, `post` and `postChip` are the fan's. */
	layers: readonly string[];
	fan: { chipFontSize: number; chipTextRes: number; pagerLabelSize: number; pagerGlyphSize: number; pagerTextRes?: number };
}

export interface TermCanvasHooks {
	/** Repaint existing nodes after inherited palette changes. */
	themeChanged: () => void;
	/** Where a term sits, and its colour; null when it is gone. */
	center: ( id: number ) => { x: number; y: number; tone: number } | null;
	/** The authoritative post count landed for a term. */
	countReconciled: ( id: number, total: number ) => void;
	/** The focus changed (opened, moved or closed): repaint. */
	focusChanged: () => void;
	/** A focus just opened on `center` — the mind map shoves its pinned roots here. */
	focusOpened?: ( center: { x: number; y: number } ) => void;
	/** The focus just closed — undo what `focusOpened` did. */
	focusClosed?: () => void;
	/** The world box the camera fits, or null when empty. */
	bounds: () => Bounds | null;
	/** Per frame, after the camera eased: the metaphor's own motion and paint. */
	frame: ( dt: number ) => void;
	/** The fresh bulk counts landed and changed something: relayout. */
	countsChanged: () => void;
	/**
	 * The term list was reloaded because posts or terms changed in
	 * another window: terms may have appeared, gone or moved. Keep the
	 * camera where the user left it. Falls back to `countsChanged`.
	 */
	termsReloaded?: () => void;
	/** Whether a term is being dragged — a click then never closes the focus. */
	dragging: () => boolean;
	/** A stage pointer moved; return true when the canvas consumed it (a drag), false to pan. */
	pointerMove: ( ev: PixiPointerEvent, cursorWorld: PixiPoint ) => boolean;
	/** A stage pointer lifted. */
	pointerUp: ( ev?: PixiPointerEvent ) => void | Promise< void >;
	/** Cancel a pending node drag without saving, focusing or reparenting. */
	cancelGesture: () => void;
	/** The search box's candidates for a lowercase query. */
	search: ( q: string ) => Array< { id: number; count: number; name: string } >;
}

export interface TermCanvas {
	palette: CanvasPalette;
	pixi: PixiNamespace;
	app: PixiApp;
	world: PixiContainer;
	layers: Record< string, PixiContainer >;
	postEdgeGfx: PixiGraphics;
	chrome: CanvasChrome;
	stage: HTMLElement;
	sidebar: HTMLElement;
	interaction: Interaction;
	camera: Camera;
	fan: PostFan;
	/** The terms on the canvas — replaced whole on every change. */
	terms: TermRow[];
	/** The spotlight keep-out zone while a term is focused. */
	nudge: { x: number; y: number; radius: number } | null;
	/** Focus a term (toggle off when already focused): frame, spotlight, fan. */
	focusOn: ( id: number ) => Promise< void >;
	closeFocus: () => void;
	/** Frame the focus, or fit the whole canvas. */
	recenter: () => void;
	/** Show or hide the "nothing here yet" hint over the stage. */
	syncEmptyHint: ( show: boolean ) => void;
	/** Any-status counts from the cached bulk map; `countsChanged` when they differ. */
	refreshCounts: () => Promise< void >;
	/** Refetch the terms and their counts, then `termsReloaded` and refresh the fan. */
	reload: () => Promise< void >;
	/** Bind the metaphor and start: the loop, the search, the first fit, the counts. */
	start: ( hooks: TermCanvasHooks ) => void;
	teardown: () => void;
}

/** Changes arrive in bursts (an editor save, then its heartbeat echo). */
const RELOAD_DEBOUNCE_MS = 300;

/**
 * Subscribe to the shell broadcasts that mean a canvas's terms or counts
 * may be stale: any post saved or recategorised (`os.post.changed`), and
 * any term of this taxonomy created, renamed, moved or deleted
 * (`os.term.changed`). Returns the unsubscribe.
 */
export function subscribeToContentChanges( taxonomy: 'category' | 'post_tag', onChange: () => void ): () => void {
	const api = window.wp?.os;
	if ( ! api || typeof api.subscribe !== 'function' ) {
		return () => {};
	}
	const offPosts = api.subscribe( 'os.post.changed', () => onChange() );
	const offTerms = api.subscribe( 'os.term.changed', ( payload: unknown ) => {
		const changed = ( payload as { taxonomy?: string } | null )?.taxonomy;
		if ( ! changed || changed === taxonomy ) {
			onChange();
		}
	} );
	return () => {
		offPosts();
		offTerms();
	};
}

/**
 * Load PixiJS, build the chrome and the world, fetch the terms.
 * Resolves null when PixiJS is unavailable (the host says so).
 */
export async function createTermCanvas( host: HTMLElement, env: CanvasEnv, spec: TermCanvasSpec ): Promise< TermCanvas | null > {
	const loaded = await loadPixi( host, spec.unavailable );
	if ( ! loaded ) {
		return null;
	}
	const pixi: PixiNamespace = loaded;
	const chrome = buildCanvasChrome( host, spec.modifier, spec.chrome );
	const { stage, sidebar } = chrome;
	const { app, world } = await createPixiApp( pixi, stage, `${ CANVAS_PREFIX }__canvas` );

	const layers: Record< string, PixiContainer > = {};
	for ( const name of spec.layers ) {
		const layer = new pixi.Container();
		layers[ name ] = layer;
		world.addChild( layer );
	}
	const postEdgeGfx = new pixi.Graphics();
	layers.postEdge.addChild( postEdgeGfx );

	const palette = readCanvasPalette( stage );
	const interaction = createInteraction();
	let hooks: TermCanvasHooks | null = null;
	const camera = createCamera( world, stage, {
		start: () => {
			interaction.pinchUntil = Infinity; interaction.panActive = false; interaction.panStart = null;
			hooks?.cancelGesture();
		},
		end: () => {
			interaction.pinchUntil = performance.now() + 300;
		},
	} );
	let prevView: { scale: number; x: number; y: number } | null = null;
	let raf: number | null = null;
	let lastTick = performance.now();
	let unwatch: ( () => void ) | null = null;
	let undirectory: ( () => void ) | null = null;
	let unsearch: ( () => void ) | null = null;
	let unchanges: ( () => void ) | null = null;
	let reloadTimer: ReturnType< typeof setTimeout > | null = null;
	let disposed = false;

	const fan = createPostFan( {
		palette,
		pixi,
		postLayer: layers.post,
		postChipLayer: layers.postChip,
		postEdgeGfx,
		env,
		param: spec.taxonomy,
		interaction,
		...spec.fan,
		getCenter: ( id ) => hooks?.center( id ) ?? null,
		onCountReconciled: ( id, total ) => hooks?.countReconciled( id, total ),
		onOpenPost: () => canvas.closeFocus(),
	} );

	const repaintTheme = (): void => {
		Object.assign( palette, readCanvasPalette( stage ) );
		hooks?.themeChanged();
		fan.repaintTheme();
		app.render();
	};
	const untheme = watchCanvasPalette( stage, repaintTheme );

	// --- The frame loop, paused while nothing can see it --------------
	const hidden = (): boolean => document.hidden || stage.clientWidth === 0 || stage.clientHeight === 0;
	const tick = (): void => {
		raf = null;
		if ( disposed || ! hooks ) {
			return;
		}
		if ( hidden() ) {
			// A hidden tab, a minimized window, the list tab in front:
			// nothing to paint for, and the physics would spin for no one.
			return;
		}
		const now = performance.now();
		const dt = Math.min( 50, now - lastTick );
		lastTick = now;
		camera.ease();
		hooks.frame( dt );
		raf = requestAnimationFrame( tick );
	};
	const resume = (): void => {
		if ( disposed || raf !== null || ! hooks || hidden() ) {
			return;
		}
		lastTick = performance.now();
		raf = requestAnimationFrame( tick );
	};
	const onVisibility = (): void => resume();

	// --- Pan (the metaphor may claim the pointer for a drag) -----------
	app.stage.on( 'pointerdown', ( e ) => {
		if ( isPinchGesture( interaction ) ) {
			return;
		}
		const ev = e as PixiPointerEvent;
		interaction.panActive = true;
		interaction.panStart = { x: ev.global.x, y: ev.global.y };
		interaction.panMovedDist = 0;
	} );
	app.stage.on( 'pointermove', ( e ) => {
		if ( isPinchGesture( interaction ) ) {
			return;
		}
		const ev = e as PixiPointerEvent;
		if ( hooks?.pointerMove( ev, camera.stageToWorld( ev.global ) ) ) {
			return;
		}
		if ( interaction.panActive && interaction.panStart ) {
			const dx = ev.global.x - interaction.panStart.x;
			const dy = ev.global.y - interaction.panStart.y;
			camera.pan( dx, dy );
			interaction.panMovedDist += Math.sqrt( dx * dx + dy * dy );
			interaction.panStart = { x: ev.global.x, y: ev.global.y };
		}
	} );
	const onPointerUp = async ( e?: unknown ): Promise< void > => {
		if ( ! isPinchGesture( interaction ) ) {
			await hooks?.pointerUp( e as PixiPointerEvent | undefined );
		}
		interaction.panActive = false;
		interaction.panStart = null;
		// `panMovedDist` deliberately survives: the DOM click fires after
		// pointerup and reads it.
	};
	app.stage.on( 'pointerup', ( e ) => void onPointerUp( e ) );
	app.stage.on( 'pointerupoutside', ( e ) => void onPointerUp( e ) );
	app.canvas.addEventListener( 'click', ( e ) => {
		if ( isEmptyCanvasClick( interaction, e, app.canvas ) && ! hooks?.dragging() && fan.focusId !== null ) {
			canvas.closeFocus();
		}
	} );

	const canvas: TermCanvas = {
		palette,
		pixi,
		app,
		world,
		layers,
		postEdgeGfx,
		chrome,
		stage,
		sidebar,
		interaction,
		camera,
		fan,
		terms: [],
		nudge: null,

		async focusOn( id ) {
			if ( fan.focusId === id ) {
				canvas.closeFocus();
				return;
			}
			const wasFocused = fan.focusId !== null;
			fan.focusId = id;
			fan.focusPage = 1;
			interaction.lastFocusChange = performance.now();
			const center = hooks?.center( id ) ?? null;
			if ( center ) {
				// The view before the FIRST deploy of a focus session is
				// restored on close; switching between terms keeps it.
				if ( ! wasFocused ) {
					prevView = { scale: camera.targetScale, x: camera.targetWorldX, y: camera.targetWorldY };
				}
				camera.frameOn( center.x, center.y );
				canvas.nudge = { x: center.x, y: center.y, radius: SPOTLIGHT_RADIUS };
				hooks?.focusOpened?.( center );
			}
			hooks?.focusChanged();
			await fan.load();
		},

		closeFocus() {
			fan.focusId = null;
			interaction.lastFocusChange = performance.now();
			fan.invalidate();
			canvas.nudge = null;
			hooks?.focusClosed?.();
			if ( prevView ) {
				camera.targetScale = prevView.scale;
				camera.targetWorldX = prevView.x;
				camera.targetWorldY = prevView.y;
				prevView = null;
			}
			fan.clear();
			hooks?.focusChanged();
		},

		recenter() {
			const center = fan.focusId === null ? null : hooks?.center( fan.focusId ) ?? null;
			if ( center && camera.frameOn( center.x, center.y ) ) {
				return;
			}
			camera.fitToView( hooks?.bounds() ?? null, { animate: true } );
		},

		syncEmptyHint( show ) {
			const existing = stage.querySelector< HTMLElement >( `.${ CANVAS_PREFIX }__empty` );
			if ( show && ! existing ) {
				const empty = document.createElement( 'div' );
				empty.className = `${ CANVAS_PREFIX }__empty`;
				empty.textContent = spec.emptyHint;
				stage.appendChild( empty );
			} else if ( ! show && existing ) {
				existing.remove();
			}
		},

		async refreshCounts() {
			if ( canvas.terms.length === 0 ) {
				return;
			}
			try {
				const map = await env.client.fetchTermCounts( spec.restTaxonomy, canvas.terms.map( ( t ) => t.id ) );
				let dirty = false;
				canvas.terms = canvas.terms.map( ( t ) => {
					const fresh = map[ String( t.id ) ];
					if ( typeof fresh === 'number' && fresh !== t.count ) {
						dirty = true;
						return { ...t, count: fresh };
					}
					return t;
				} );
				if ( dirty && ! disposed ) {
					hooks?.countsChanged();
				}
			} catch {
				// The term-list count stays; the bulk map is a refinement.
			}
		},

		async reload() {
			let fresh: TermRow[];
			try {
				fresh = await env.client.fetchAllTerms( spec.taxonomy );
			} catch {
				return; // Keep what is on screen; the next change retries.
			}
			try {
				const map = fresh.length > 0
					? await env.client.fetchTermCounts( spec.restTaxonomy, fresh.map( ( t ) => t.id ) )
					: {};
				fresh = fresh.map( ( t ) => {
					const count = map[ String( t.id ) ];
					return typeof count === 'number' ? { ...t, count } : t;
				} );
			} catch {
				// The term-list counts stand; the bulk map is a refinement.
			}
			if ( disposed ) {
				return;
			}
			canvas.terms = fresh;
			( hooks?.termsReloaded ?? hooks?.countsChanged )?.();
			fan.forget();
			if ( fan.focusId !== null ) {
				if ( fresh.some( ( t ) => t.id === fan.focusId ) ) {
					await fan.load();
				} else {
					canvas.closeFocus();
				}
			}
		},

		start( next ) {
			hooks = next;
			// Posts recategorised or terms edited in another window (the
			// block editor, a Posts table cell, the heartbeat for classic
			// saves) change the counts and the fans. One reload per burst,
			// and never under a node the user is dragging.
			const scheduleReload = (): void => {
				if ( reloadTimer !== null ) {
					clearTimeout( reloadTimer );
				}
				reloadTimer = setTimeout( () => {
					reloadTimer = null;
					if ( disposed ) {
						return;
					}
					if ( hooks?.dragging() ) {
						scheduleReload();
						return;
					}
					void canvas.reload();
				}, RELOAD_DEBOUNCE_MS );
			};
			unchanges = subscribeToContentChanges( spec.restTaxonomy, scheduleReload );
			unwatch = watchStageSize( pixi, app, stage, {
				onFirstFit: () => camera.fitToView( next.bounds() ),
				onSettle: () => canvas.recenter(),
				onResize: resume,
			} );
			document.addEventListener( 'visibilitychange', onVisibility );
			undirectory = mountTermDirectory( chrome, () => canvas.terms, ( id ) => void canvas.focusOn( id ) );
			unsearch = wireCanvasSearch( chrome, {
				matches: next.search,
				select: ( item ) => void canvas.focusOn( item.id ),
			} );
			resume();
			void canvas.refreshCounts();
		},

		teardown() {
			disposed = true;
			if ( raf !== null ) {
				cancelAnimationFrame( raf );
				raf = null;
			}
			document.removeEventListener( 'visibilitychange', onVisibility );
			if ( reloadTimer !== null ) {
				clearTimeout( reloadTimer );
				reloadTimer = null;
			}
			unchanges?.();
			unwatch?.();
			unsearch?.();
			undirectory?.();
			untheme();
			camera.dispose();
			destroyPixiApp( app, host, [ CANVAS_PREFIX, spec.modifier ] );
		},
	};

	try {
		canvas.terms = await env.client.fetchAllTerms( spec.taxonomy );
	} catch ( err ) {
		env.toast( spec.loadFailed, err );
	}
	return canvas;
}
