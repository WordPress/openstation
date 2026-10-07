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

export const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

export interface TermCanvasSpec {
	taxonomy: 'categories' | 'tags';
	restTaxonomy: 'category' | 'post_tag';

	modifier: string;
	unavailable: string;
	loadFailed: string;
	emptyHint: string;
	chrome: { buttons: ChromeButton[]; searchPlaceholder: string; searchAria: string; hint: string };

	layers: readonly string[];
	fan: { chipFontSize: number; chipTextRes: number; pagerLabelSize: number; pagerGlyphSize: number; pagerTextRes?: number };
}

export interface TermCanvasHooks {

	themeChanged: () => void;

	center: ( id: number ) => { x: number; y: number; tone: number } | null;

	countReconciled: ( id: number, total: number ) => void;

	focusChanged: () => void;

	focusOpened?: ( center: { x: number; y: number } ) => void;

	focusClosed?: () => void;

	bounds: () => Bounds | null;

	frame: ( dt: number ) => void;

	countsChanged: () => void;

	dragging: () => boolean;

	pointerMove: ( ev: PixiPointerEvent, cursorWorld: PixiPoint ) => boolean;

	pointerUp: ( ev?: PixiPointerEvent ) => void | Promise< void >;

	cancelGesture: () => void;

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

	terms: TermRow[];

	nudge: { x: number; y: number; radius: number } | null;

	focusOn: ( id: number ) => Promise< void >;
	closeFocus: () => void;

	recenter: () => void;

	syncEmptyHint: ( show: boolean ) => void;

	refreshCounts: () => Promise< void >;

	start: ( hooks: TermCanvasHooks ) => void;
	teardown: () => void;
}

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

	const hidden = (): boolean => document.hidden || stage.clientWidth === 0 || stage.clientHeight === 0;
	const tick = (): void => {
		raf = null;
		if ( disposed || ! hooks ) {
			return;
		}
		if ( hidden() ) {
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

			}
		},

		start( next ) {
			hooks = next;
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
