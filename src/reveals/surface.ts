import {
	LOADING_OVERLAY_CLASS,
	LOADING_OVERLAY_FADE_OUT_MS,
	LOADING_OVERLAY_VISIBLE_CLASS,
} from '../window/constants';
import { createSharedStore } from '../shared-store';
import { getActiveWindowReveal, getActiveWindowRevealDuration } from './engine';
import {
	clampRevealDuration,
	clampRevealDurationOverride,
	clampRevealEdgeLag,
	DEFAULT_REVEAL_EASING,
	getWindowReveal,
	REVEAL_DURATION_AUTO,
	revealLayerPairs,
} from './registry';
import type {
	WindowRevealDef,
	WindowRevealLayer,
	WindowRevealRenderContext,
} from './types';

export const REVEAL_SURFACE_CLASS = 'os-window__reveal';

export const REVEAL_EDGE_CLASS = 'os-window__reveal--edge';

export const REVEAL_CUSTOM_CLASS = 'os-window__reveal--custom';

export const REVEALING_BODY_CLASS = 'os-window__body--revealing';

const REVEAL_ID_ATTR = 'data-os-reveal';

const LAYER_INDEX_ATTR = 'data-os-reveal-layer';

const running = new WeakMap< HTMLElement, Animation >();

type RenderedPlay = ( ctx: WindowRevealRenderContext ) => Animation[];
const renderedStore = createSharedStore< {
	plays: WeakMap< HTMLElement, RenderedPlay >;
} >( 'desktop-mode/window-reveal-rendered', () => ( { plays: new WeakMap() } ) );
const rendered = renderedStore.state.plays;

function prefersReducedMotion(): boolean {
	if ( typeof window === 'undefined' || typeof window.matchMedia !== 'function' ) {
		return false;
	}
	try {
		return window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches;
	} catch {
		return false;
	}
}

const DURATION_TOKEN = '--os-window-reveal-duration';

const EDGE_THICKNESS_TOKEN = '--os-window-reveal-edge-thickness';

function parseCssDuration( raw: string ): number {
	const value = raw.trim();
	if ( value === '' ) {
		return 0;
	}
	const match = /^(-?\d*\.?\d+)\s*(ms|s)?$/i.exec( value );
	if ( ! match ) {
		return 0;
	}
	const n = Number( match[ 1 ] );
	if ( ! Number.isFinite( n ) ) {
		return 0;
	}
	return match[ 2 ]?.toLowerCase() === 's' ? n * 1000 : n;
}

function themeDuration( el: HTMLElement ): number {
	if ( typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' ) {
		return 0;
	}
	try {
		return clampRevealDurationOverride(
			parseCssDuration(
				window.getComputedStyle( el ).getPropertyValue( DURATION_TOKEN ),
			),
		);
	} catch {
		return 0;
	}
}

function readToken( el: HTMLElement, token: string ): string {
	if ( typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' ) {
		return '';
	}
	try {
		return window.getComputedStyle( el ).getPropertyValue( token ).trim();
	} catch {
		return '';
	}
}

function themeEdgeLag( el: HTMLElement, duration: number ): number | null {
	const raw = readToken( el, EDGE_THICKNESS_TOKEN );
	if ( raw === '' ) {
		return null;
	}
	const percent = /^(-?\d*\.?\d+)%$/.exec( raw );
	if ( percent ) {
		return clampRevealEdgeLag( ( duration * Number( percent[ 1 ] ) ) / 100 );
	}
	const fraction = /^(-?\d*\.?\d+)$/.exec( raw );
	if ( fraction ) {
		return clampRevealEdgeLag( duration * Number( fraction[ 1 ] ) );
	}
	const time = parseCssDuration( raw );

	if ( /^-?\d*\.?\d+\s*(ms|s)$/i.test( raw ) ) {
		return clampRevealEdgeLag( time );
	}
	return null;
}

function paintsNothing( el: HTMLElement ): boolean {
	if ( typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' ) {
		return false;
	}
	try {
		const style = window.getComputedStyle( el );

		const image = style.backgroundImage;
		if ( image && image !== 'none' ) {
			return false;
		}
		const match = /^rgba?\(([^)]+)\)$/.exec( style.backgroundColor.trim() );
		if ( ! match ) {
			return false;
		}
		const parts = match[ 1 ].split( /[,\s/]+/ ).filter( Boolean );
		return parts.length >= 4 && Number( parts[ 3 ] ) === 0;
	} catch {
		return false;
	}
}

function resolveTiming(
	el: HTMLElement,
	def: WindowRevealDef,
): { duration: number; edgeLag: number } {
	const base = clampRevealDuration( def.duration );

	const override = getActiveWindowRevealDuration();
	const resolved =
		override !== REVEAL_DURATION_AUTO ? override : themeDuration( el ) || base;

	const themed = themeEdgeLag( el, resolved );
	if ( themed !== null ) {
		return { duration: resolved, edgeLag: themed };
	}

	const lag = clampRevealEdgeLag( def.edgeLag );
	if ( resolved === base ) {
		return { duration: base, edgeLag: lag };
	}
	return {
		duration: resolved,
		edgeLag: clampRevealEdgeLag( ( lag * resolved ) / base ),
	};
}

function findBody( windowEl: HTMLElement ): HTMLElement | null {
	return windowEl.querySelector< HTMLElement >(
		':scope .os-window__body',
	);
}

function findSurface( body: HTMLElement ): HTMLElement | null {
	return body.querySelector< HTMLElement >(
		`:scope .${ REVEAL_SURFACE_CLASS }:not( .${ REVEAL_EDGE_CLASS } )`,
	);
}

function findEdge( body: HTMLElement ): HTMLElement | null {
	return body.querySelector< HTMLElement >( `:scope .${ REVEAL_EDGE_CLASS }` );
}

function findSurfaces( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >(
			`:scope .${ REVEAL_SURFACE_CLASS }:not( .${ REVEAL_EDGE_CLASS } )`,
		),
	);
}

function findEdges( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >( `:scope .${ REVEAL_EDGE_CLASS }` ),
	);
}

function findLayers( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >(
			`:scope .${ REVEAL_SURFACE_CLASS }`,
		),
	);
}

function createLayer(
	def: WindowRevealDef,
	pair: WindowRevealLayer,
	index: number,
	edge: boolean,
): HTMLElement {
	const layer = document.createElement( 'div' );
	layer.className = edge
		? `${ REVEAL_SURFACE_CLASS } ${ REVEAL_EDGE_CLASS }`
		: REVEAL_SURFACE_CLASS;

	const paint = edge ? def.edgeColor : pair.color ?? def.surfaceColor;
	if ( typeof paint === 'string' && paint !== '' ) {
		layer.style.background = paint;
	}

	layer.setAttribute( 'aria-hidden', 'true' );
	layer.setAttribute( REVEAL_ID_ATTR, def.id );
	layer.setAttribute( LAYER_INDEX_ATTR, String( index ) );
	layer.style.clipPath = pair.from;
	return layer;
}

export function createRevealLayers(): HTMLElement[] {
	const def = getActiveWindowReveal();
	if ( ! def ) {
		return [];
	}

	if ( typeof def.render === 'function' ) {
		let built;
		try {
			built = def.render();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] window reveal "${ def.id }" render threw:`,
					err,
				);
			}
			return [];
		}
		if ( ! built?.element || typeof built.play !== 'function' ) {
			return [];
		}
		const host = built.element;
		host.classList.add( REVEAL_SURFACE_CLASS );

		host.classList.add( REVEAL_CUSTOM_CLASS );
		host.setAttribute( 'aria-hidden', 'true' );
		host.setAttribute( REVEAL_ID_ATTR, def.id );
		host.setAttribute( LAYER_INDEX_ATTR, '0' );
		rendered.set( host, built.play );
		return [ host ];
	}

	const pairs = revealLayerPairs( def );
	if ( pairs.length === 0 ) {
		return [];
	}
	const layers: HTMLElement[] = [];

	if ( clampRevealEdgeLag( def.edgeLag ) > 0 ) {
		pairs.forEach( ( pair, i ) =>
			layers.push( createLayer( def, pair, i, true ) ),
		);
	}
	pairs.forEach( ( pair, i ) =>
		layers.push( createLayer( def, pair, i, false ) ),
	);
	return layers;
}

export function armWindowReveal( windowEl: HTMLElement ): void {
	const body = findBody( windowEl );
	if ( ! body ) {
		return;
	}
	body.classList.remove( REVEALING_BODY_CLASS );
	for ( const layer of findLayers( body ) ) {
		running.get( layer )?.cancel();
		running.delete( layer );
		layer.remove();
	}
	for ( const layer of createRevealLayers() ) {
		body.appendChild( layer );
	}
}

export function playWindowReveal( windowEl: HTMLElement ): void {
	const body = findBody( windowEl );
	if ( ! body ) {
		return;
	}
	const surface = findSurface( body );
	if ( ! surface ) {
		return;
	}

	let def: WindowRevealDef | undefined;
	try {
		def = getWindowReveal( surface.getAttribute( REVEAL_ID_ATTR ) ?? '' );
	} catch ( err ) {
		if ( typeof console !== 'undefined' ) {
			console.error(
				'[openstation] window-reveal lookup threw; uncovering without a reveal:',
				err,
			);
		}
	}
	if ( ! def ) {
		findLayers( body ).forEach( ( layer ) => layer.remove() );
		return;
	}

	const spinnerVisible = !! body
		.querySelector( `:scope .${ LOADING_OVERLAY_CLASS }` )
		?.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS );
	const delay = spinnerVisible ? LOADING_OVERLAY_FADE_OUT_MS : 0;

	const { duration, edgeLag } = resolveTiming( body, def );
	const easingValue = def.easing ?? DEFAULT_REVEAL_EASING;

	const playRendered = rendered.get( surface );
	if ( playRendered ) {
		body.classList.add( REVEALING_BODY_CLASS );
		const finishRendered = (): void => {
			running.delete( surface );
			surface.remove();
			body.classList.remove( REVEALING_BODY_CLASS );
		};
		if ( prefersReducedMotion() || typeof surface.animate !== 'function' ) {
			window.setTimeout( finishRendered, delay );
			return;
		}
		let animations: Animation[] = [];
		try {
			animations = playRendered( {
				duration,
				easing: easingValue,
				delay,
			} );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] window reveal "${ def.id }" play threw:`,
					err,
				);
			}
		}
		if ( animations.length === 0 ) {
			finishRendered();
			return;
		}

		animations[ 0 ].addEventListener( 'finish', finishRendered );
		animations[ 0 ].addEventListener( 'cancel', () => {
			running.delete( surface );
			body.classList.remove( REVEALING_BODY_CLASS );
		} );

		running.set( surface, animations[ 0 ] );
		return;
	}

	const edge = findEdge( body );
	if ( edge && ( edgeLag <= 0 || paintsNothing( edge ) ) ) {
		findEdges( body ).forEach( ( el ) => el.remove() );
	}
	if ( paintsNothing( surface ) ) {
		findSurfaces( body ).forEach( ( el ) => el.remove() );
	}
	const painting = findLayers( body );
	if ( painting.length === 0 ) {
		return;
	}

	body.classList.add( REVEALING_BODY_CLASS );

	const finish = (): void => {
		for ( const layer of painting ) {
			running.delete( layer );
			layer.remove();
		}
		body.classList.remove( REVEALING_BODY_CLASS );
	};

	if ( prefersReducedMotion() || typeof surface.animate !== 'function' ) {
		window.setTimeout( finish, delay );
		return;
	}

	const easing = easingValue;
	const pairs = revealLayerPairs( def );

	const play = ( layer: HTMLElement, layerDuration: number ): Animation | null => {
		const pair = pairs[ Number( layer.getAttribute( LAYER_INDEX_ATTR ) ) ];
		if ( ! pair ) {
			layer.remove();
			return null;
		}

		layer.style.willChange = 'clip-path';
		let animation: Animation;
		try {
			animation = layer.animate(
				[ { clipPath: pair.from }, { clipPath: pair.to } ],
				{
					duration: layerDuration,
					easing,
					delay,

					fill: 'both',
				},
			);
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] window reveal "${ def.id }" failed to animate; uncovering:`,
					err,
				);
			}
			layer.remove();
			return null;
		}
		running.set( layer, animation );
		return animation;
	};

	const surfaceAnimations = findSurfaces( body )
		.map( ( el ) => play( el, duration ) )
		.filter( ( a ): a is Animation => a !== null );
	const edgeAnimations = findEdges( body )
		.map( ( el ) => play( el, duration + edgeLag ) )
		.filter( ( a ): a is Animation => a !== null );

	const surfaceAnimation = surfaceAnimations[ 0 ] ?? null;
	const edgeAnimation = edgeAnimations[ 0 ] ?? null;

	if ( ! surfaceAnimation && ! edgeAnimation ) {
		finish();
		return;
	}

	( edgeAnimation ?? surfaceAnimation )?.addEventListener( 'finish', finish );

	const onCancel = (): void => {
		for ( const layer of painting ) {
			running.delete( layer );
		}
		body.classList.remove( REVEALING_BODY_CLASS );
	};
	surfaceAnimation?.addEventListener( 'cancel', onCancel );
	edgeAnimation?.addEventListener( 'cancel', onCancel );
}
