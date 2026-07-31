/**
 * Desktop Mode — Window-reveal surface.
 *
 * The DOM half of the reveal feature: create the opaque covering
 * surface, arm it when a window starts loading, and animate it away
 * when the content is ready.
 *
 * ## Where the surface sits
 *
 * Up to two `<div class="desktop-mode-window__reveal">` elements inside
 * `.desktop-mode-window__body`, absolutely positioned over the whole
 * body, `pointer-events: none`. They are SIBLINGS of the `<iframe>`,
 * never wrappers and never inside the framed document:
 *
 *   - the iframe keeps its own compositing layer and hit-testing, so a
 *     reveal cannot swallow clicks or re-rasterize the page it covers;
 *   - `clip-path` is animated on the surface alone, so no stacking
 *     context is introduced around the content;
 *   - native windows get exactly the same treatment as iframe windows,
 *     because the surface never touches the content subtree at all.
 *
 * Both stack BELOW the `<wpd-spinner>` loading overlay, which is why
 * the spinner stays readable for the whole load and the surface only
 * becomes visible once the spinner has faded.
 *
 * ## The two layers
 *
 * - **Surface** — painted in `--desktop-mode-window-reveal-surface`
 *   (white by default). This is the layer that hides the content, so
 *   it has to be opaque or there is nothing to reveal from.
 * - **Edge** — painted in `--desktop-mode-window-reveal-edge`
 *   (`transparent` by default, i.e. off), sitting behind the surface
 *   and running the SAME keyframes over a slightly longer duration.
 *   Always a little less far along, it peeks out past the surface as a
 *   band hugging the clip boundary.
 *
 * Either layer whose paint resolves to nothing is dropped rather than
 * animated, which is what makes `transparent` a working "turn this
 * layer off" value for a theme — and what keeps the off-by-default
 * edge from costing an animation on every window load.
 *
 * Deriving the edge from a time lag rather than from a dilated shape is
 * what makes it universal: a plugin describes one `from` / `to` pair
 * and gets a correctly-shaped edge for free — six thin lines on
 * `blinds`, an opening ring on `iris`, a rotating spoke on `radar` —
 * without ever computing an outline. There is no geometry that a lag
 * cannot follow.
 *
 * The edge runs LONGER, not shorter, so it is also the layer that
 * finishes last; teardown hangs off it whenever it is present.
 *
 * ## The sequence
 *
 * ```
 * content-loading  ─→ surface painted, clip-path = def.from  (fully covering)
 *                     spinner overlay fades IN after 120ms
 * content-loaded   ─→ spinner overlay fades OUT over 250ms
 *                     surface animates from → to
 *                     surface removed
 * ```
 *
 * The reveal ALWAYS plays, including on loads fast enough that the
 * spinner's 120 ms entry delay meant it never painted. What changes is
 * only when the animation starts: after the spinner's fade-out when
 * there was a spinner to fade, immediately when there was not. Gating
 * the reveal on the spinner instead would make the fastest loads — the
 * ones a user repeats most — the only ones with no transition, which
 * reads as an inconsistency rather than as an optimization.
 */

import {
	LOADING_OVERLAY_FADE_OUT_MS,
	LOADING_OVERLAY_SHOW_DELAY_MS,
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

/**
 * Class shared by BOTH reveal layers. Every CSS rule that needs to
 * treat reveal chrome as "not content" keys off this one class, so
 * adding the edge layer needed no selector churn.
 */
export const REVEAL_SURFACE_CLASS = 'desktop-mode-window__reveal';

/** Modifier marking the trailing edge layer. */
export const REVEAL_EDGE_CLASS = 'desktop-mode-window__reveal--edge';

/**
 * Modifier on a layer whose paint comes from its own DOM rather than
 * from the surface token — a custom `render()`.
 *
 * It suppresses the token background outright. Without it the host is
 * an opaque rectangle UNDER the renderer's own output, so the effect
 * uncovers that rectangle instead of the page, and the real content
 * only appears when the layer is finally removed — a clean animation
 * followed by an abrupt pop.
 */
export const REVEAL_CUSTOM_CLASS = 'desktop-mode-window__reveal--custom';

/**
 * Modifier on the window body while a reveal is playing. Its CSS rule
 * pins the content to full opacity with no transition: the body's
 * normal loaded-edge behaviour is a 250 ms opacity fade, and a reveal
 * that uncovered content mid-fade would show a half-transparent strip
 * along its leading edge.
 */
export const REVEALING_BODY_CLASS = 'desktop-mode-window__body--revealing';

/**
 * Timestamp (ms) when the surface was armed, stamped on the element
 * itself rather than held in a side map — the element is the thing
 * whose lifetime the value tracks, and a window torn down mid-load
 * takes its stamp with it instead of leaking an entry.
 *
 * @internal
 */
const ARMED_AT_ATTR = 'data-desktop-mode-reveal-armed';

/**
 * Id of the reveal that armed this surface. Read back at play time so a
 * user who switches reveals while a window is mid-load still gets a
 * matched `from` / `to` pair — animating from the OLD shape to the NEW
 * one is the non-interpolable case the registry works to prevent.
 *
 * @internal
 */
const REVEAL_ID_ATTR = 'data-desktop-mode-reveal';

/**
 * Which of the def's layers this element draws. A single-layer reveal
 * has one; `obturator` has one per blade. Read back at play time so
 * each element animates its OWN matched pair — the blades of a
 * mechanism are not interchangeable.
 *
 * @internal
 */
const LAYER_INDEX_ATTR = 'data-desktop-mode-reveal-layer';

/** Running animations, so a re-arm can cancel the one it replaces. */
const running = new WeakMap< HTMLElement, Animation >();

/**
 * `play` callbacks of custom-rendered reveals, keyed by the element
 * they belong to. A rendered reveal is armed in one call and played in
 * another, and the closure over its own DOM is what has to survive
 * between them — so it travels with the element rather than in a slot
 * a second window would overwrite.
 *
 * **Shared-store backed, and it has to be.** The two halves run in
 * DIFFERENT BUNDLES: a window's first layers are built by
 * `createWindowElement` in the window-system bundle, while the shell
 * bundle is what plays them. A plain module-level `WeakMap` gives each
 * bundle its own copy, so the arm writes into one and the play reads
 * an empty other — the reveal is silently dropped on every window
 * OPEN, while reload still works because that path arms from the shell
 * side. See AGENTS.md → "Cross-bundle state".
 *
 * @internal
 */
type RenderedPlay = ( ctx: WindowRevealRenderContext ) => Animation[];
const renderedStore = createSharedStore< {
	plays: WeakMap< HTMLElement, RenderedPlay >;
} >( 'desktop-mode/window-reveal-rendered', () => ( { plays: new WeakMap() } ) );
const rendered = renderedStore.state.plays;

/**
 * True when the user has asked for reduced motion. Defensive about
 * `matchMedia` being absent (jsdom without a stub, very old embeds).
 *
 * @internal
 */
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

/**
 * Theme token carrying a reveal duration. **Undeclared by default** —
 * an empty computed value means "the theme has no opinion", which is
 * how a theme opts out simply by not mentioning it.
 *
 * @internal
 */
const DURATION_TOKEN = '--desktop-mode-window-reveal-duration';

/**
 * Theme token carrying the edge band's thickness. **Undeclared by
 * default**, in which case the def's own `edgeLag` decides.
 *
 * Accepts two grammars, and the unit tells them apart:
 *
 *   - `15%` or `0.15` — a fraction of the reveal's TRAVEL. The
 *     natural unit for a thickness: it holds its apparent width at any
 *     duration and on any window size, because the band's width is a
 *     fraction of how far the shape moves.
 *   - `70ms` / `0.07s` — an absolute lag, for a theme that wants the
 *     band tied to time rather than to distance.
 *
 * @internal
 */
const EDGE_THICKNESS_TOKEN = '--desktop-mode-window-reveal-edge-thickness';

/**
 * Parse a CSS time value into ms. Accepts `420ms`, `0.42s`, and a bare
 * `420` (read as ms) so a theme author writing the token by hand is not
 * caught out by the unit. Returns `0` for anything unparseable, which
 * the caller treats as "no opinion".
 *
 * @internal
 */
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

/**
 * Duration a theme asked for on this window, or `0` when it did not.
 *
 * Read per load rather than cached: a theme switch swaps the token
 * under a live shell, and a load is already an expensive-enough moment
 * that one `getComputedStyle` is not worth memoizing around.
 *
 * @internal
 */
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

/**
 * Read a custom property off an element, or `''` when it is
 * undeclared / unreadable.
 *
 * @internal
 */
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

/**
 * Edge thickness a theme asked for on this window, in ms of lag, or
 * `null` when it did not ask. See {@link EDGE_THICKNESS_TOKEN} for the
 * two accepted grammars.
 *
 * @internal
 */
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
	// `parseCssDuration` returns 0 for anything unparseable, and 0 is
	// also a legitimate "no edge please". Distinguish by checking the
	// value actually carried a time unit.
	if ( /^-?\d*\.?\d+\s*(ms|s)$/i.test( raw ) ) {
		return clampRevealEdgeLag( time );
	}
	return null;
}

/**
 * Whether a reveal layer would paint nothing. BOTH colour tokens ship
 * as `transparent`, so this is the default state for both layers — a
 * reveal is a shape, and a site that has not said what colour that
 * shape is gets no paint and no animation.
 *
 * Fails OPEN: anything this cannot confidently read as invisible is
 * treated as visible and animated. A missed skip costs one transparent
 * animation; a false positive would silently drop a layer a theme (or
 * a def's own `surfaceColor`) deliberately configured, which is the
 * worse error.
 *
 * @internal
 */
function paintsNothing( el: HTMLElement ): boolean {
	if ( typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' ) {
		return false;
	}
	try {
		const style = window.getComputedStyle( el );
		// A gradient or image is paint regardless of the colour slot.
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

/**
 * Resolve how long this reveal actually runs, and how far its edge
 * trails, for one window.
 *
 * Precedence, highest first:
 *
 *   1. The user's **OS Settings** override — an explicit choice, and
 *      the one thing a theme must not out-rank. Same principle as the
 *      window corner-radius preset.
 *   2. The **`--desktop-mode-window-reveal-duration` theme token** — a
 *      theme's house pace, applied to every reveal the user might pick.
 *   3. The **def's own `duration`** — the reveal author's tuning, which
 *      is why nothing above is a default rather than an override.
 *
 * The edge lag follows the `--desktop-mode-window-reveal-edge-thickness`
 * token when a theme sets one, and otherwise the def's own `edgeLag`
 * scaled by whatever ratio the duration moved. That scaling is what
 * keeps the band's apparent WIDTH constant: left unscaled, a 70 ms lag
 * against a 1100 ms reveal would collapse to a hairline and against a
 * 200 ms one would blow up into a second surface — the band's width is
 * a fraction of travel, not a span of time.
 *
 * @internal
 */
function resolveTiming(
	el: HTMLElement,
	def: WindowRevealDef,
): { duration: number; edgeLag: number } {
	const base = clampRevealDuration( def.duration );

	const override = getActiveWindowRevealDuration();
	const resolved =
		override !== REVEAL_DURATION_AUTO ? override : themeDuration( el ) || base;

	// A theme's thickness is absolute, not a modifier on the def's lag
	// — it is answering "how thick is an edge in this theme", which the
	// reveal author has no say in.
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

/** Resolve a window element's body, or `null`. @internal */
function findBody( windowEl: HTMLElement ): HTMLElement | null {
	return windowEl.querySelector< HTMLElement >(
		':scope .desktop-mode-window__body',
	);
}

/** Resolve the covering surface inside a body, or `null`. @internal */
function findSurface( body: HTMLElement ): HTMLElement | null {
	return body.querySelector< HTMLElement >(
		`:scope .${ REVEAL_SURFACE_CLASS }:not( .${ REVEAL_EDGE_CLASS } )`,
	);
}

/** Resolve the FIRST trailing edge layer inside a body, or `null`. @internal */
function findEdge( body: HTMLElement ): HTMLElement | null {
	return body.querySelector< HTMLElement >( `:scope .${ REVEAL_EDGE_CLASS }` );
}

/** Every covering surface inside a body — one per def layer. @internal */
function findSurfaces( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >(
			`:scope .${ REVEAL_SURFACE_CLASS }:not( .${ REVEAL_EDGE_CLASS } )`,
		),
	);
}

/** Every trailing edge inside a body — one per def layer. @internal */
function findEdges( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >( `:scope .${ REVEAL_EDGE_CLASS }` ),
	);
}

/** Every reveal layer inside a body, in DOM order. @internal */
function findLayers( body: HTMLElement ): HTMLElement[] {
	return Array.from(
		body.querySelectorAll< HTMLElement >(
			`:scope .${ REVEAL_SURFACE_CLASS }`,
		),
	);
}

/**
 * Build one reveal layer, clipped to the reveal's `from` shape and
 * stamped with the reveal id + arm time.
 *
 * @internal
 */
function createLayer(
	def: WindowRevealDef,
	pair: WindowRevealLayer,
	index: number,
	armedAt: number,
	edge: boolean,
): HTMLElement {
	const layer = document.createElement( 'div' );
	layer.className = edge
		? `${ REVEAL_SURFACE_CLASS } ${ REVEAL_EDGE_CLASS }`
		: REVEAL_SURFACE_CLASS;
	// A def that owns its paint writes it inline, which outranks the
	// stylesheet's token rule. A per-layer colour is more specific
	// still: it is what lets neighbouring parts of one mechanism be
	// told apart, which no single colour can express.
	const paint = edge ? def.edgeColor : pair.color ?? def.surfaceColor;
	if ( typeof paint === 'string' && paint !== '' ) {
		layer.style.background = paint;
	}
	// Purely decorative — the window's `role="dialog"` label and the
	// spinner's own SR label are the loading announcements.
	layer.setAttribute( 'aria-hidden', 'true' );
	layer.setAttribute( REVEAL_ID_ATTR, def.id );
	layer.setAttribute( LAYER_INDEX_ATTR, String( index ) );
	layer.setAttribute( ARMED_AT_ATTR, String( armedAt ) );
	layer.style.clipPath = pair.from;
	return layer;
}

/**
 * Build the layers for the active reveal — the covering surface, plus
 * the trailing edge when the def asks for one.
 *
 * Returns an EMPTY ARRAY when no reveal is active, so "none" costs one
 * registry read and no DOM. Callers append whatever they get back, in
 * order: the edge comes first so it paints behind the surface even
 * before the stylesheet's `z-index` has a say.
 *
 * Called at window construction (`createWindowElement`) as well as on
 * every re-arm, because the construction-time
 * `markWindowContentLoading()` fires before the window element is in
 * the document and the hook subscriber that handles re-arms cannot find
 * it yet.
 *
 * @return The reveal layers, or `[]` when no reveal is active.
 */
export function createRevealLayers(): HTMLElement[] {
	const def = getActiveWindowReveal();
	if ( ! def ) {
		return [];
	}
	// A def that renders its own DOM gets one layer: whatever it built.
	// It carries the reveal's marker classes so every existing rule and
	// lookup — the loading-state selectors, the re-arm sweep, teardown
	// — keeps working without knowing how the layer was made.
	if ( typeof def.render === 'function' ) {
		let built;
		try {
			built = def.render();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[desktop-mode] window reveal "${ def.id }" render threw:`,
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
		// Its own DOM is the paint; the token background would sit
		// underneath as an opaque rectangle and be what the effect
		// uncovers, instead of the page.
		host.classList.add( REVEAL_CUSTOM_CLASS );
		host.setAttribute( 'aria-hidden', 'true' );
		host.setAttribute( REVEAL_ID_ATTR, def.id );
		host.setAttribute( LAYER_INDEX_ATTR, '0' );
		host.setAttribute( ARMED_AT_ATTR, String( Date.now() ) );
		rendered.set( host, built.play );
		return [ host ];
	}

	const pairs = revealLayerPairs( def );
	if ( pairs.length === 0 ) {
		return [];
	}
	const armedAt = Date.now();
	const layers: HTMLElement[] = [];
	// Every edge first, then every surface: the two classes carry their
	// own `z-index`, and keeping the groups contiguous means one
	// layer's shadow can never land on top of a neighbouring layer's
	// face.
	if ( clampRevealEdgeLag( def.edgeLag ) > 0 ) {
		pairs.forEach( ( pair, i ) =>
			layers.push( createLayer( def, pair, i, armedAt, true ) ),
		);
	}
	pairs.forEach( ( pair, i ) =>
		layers.push( createLayer( def, pair, i, armedAt, false ) ),
	);
	return layers;
}

/**
 * (Re-)arm a window's reveal — called when a window enters the loading
 * state after construction: a reload, an in-window navigation, or a tab
 * switch. Replays are intentional; they match the spinner, which
 * re-arms on exactly the same edges.
 *
 * Idempotent: an existing surface is cancelled and replaced, so a
 * double `markContentLoading()` cannot leave two stacked surfaces.
 *
 * @param windowEl The window root element.
 */
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

/**
 * Play a window's reveal — called when the content reports ready.
 *
 * No-ops when nothing was armed (reveal set to `'none'`, or a window
 * built before the user picked one). Falls back to removing the surface
 * outright under `prefers-reduced-motion`, or in environments without
 * the Web Animations API, so the content is never left covered.
 *
 * @param windowEl The window root element.
 */
export function playWindowReveal( windowEl: HTMLElement ): void {
	const body = findBody( windowEl );
	if ( ! body ) {
		return;
	}
	const surface = findSurface( body );
	if ( ! surface ) {
		return;
	}
	// Resolve against the reveal that ARMED this surface, not the one
	// selected right now — see REVEAL_ID_ATTR.
	const def = getWindowReveal( surface.getAttribute( REVEAL_ID_ATTR ) ?? '' );
	if ( ! def ) {
		findLayers( body ).forEach( ( layer ) => layer.remove() );
		return;
	}

	const armedAt = Number( surface.getAttribute( ARMED_AT_ATTR ) );
	const elapsed = Number.isFinite( armedAt ) ? Date.now() - armedAt : 0;
	// The spinner overlay only becomes visible once its entry delay has
	// passed. When it did appear, hold the surface still until its
	// fade-out has settled so the two transitions read as one sequence
	// rather than as a cross-fade.
	const delay =
		elapsed >= LOADING_OVERLAY_SHOW_DELAY_MS ? LOADING_OVERLAY_FADE_OUT_MS : 0;

	const { duration, edgeLag } = resolveTiming( body, def );
	const easingValue = def.easing ?? DEFAULT_REVEAL_EASING;

	// A custom-rendered reveal drives its own animation. It also skips
	// the paint check below: that check reads a layer's background, and
	// a renderer's paint lives inside its own DOM (an `<svg>`, a
	// canvas) where a background colour says nothing about whether
	// anything is drawn.
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
					`[desktop-mode] window reveal "${ def.id }" play threw:`,
					err,
				);
			}
		}
		if ( animations.length === 0 ) {
			finishRendered();
			return;
		}
		// They all share one duration, so any of them answers for when
		// the reveal is done.
		animations[ 0 ].addEventListener( 'finish', finishRendered );
		animations[ 0 ].addEventListener( 'cancel', () => {
			running.delete( surface );
			body.classList.remove( REVEALING_BODY_CLASS );
		} );
		// A re-arm cancels through the same map every other layer uses.
		running.set( surface, animations[ 0 ] );
		return;
	}

	// Drop every layer that would paint nothing — the shipped default,
	// since both colour tokens are `transparent`. This is what keeps a
	// site that never colours a reveal from animating two invisible
	// elements on every window load. When NOTHING would paint there is
	// no reveal to play at all: bail before the `--revealing` class, so
	// the content takes its ordinary fade-in instead of being pinned to
	// full opacity by a transition that is not happening.
	// Colour comes from one token (or one def field) for every layer, so
	// one representative of each group answers for the whole group.
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

	/**
	 * Animate one element with the pair belonging to ITS layer. A
	 * mechanism's parts are not interchangeable — blade 3 has to run
	 * blade 3's path — so the index travels on the element rather than
	 * being inferred from DOM order, which a dropped group would shift.
	 */
	const play = ( layer: HTMLElement, layerDuration: number ): Animation | null => {
		const pair = pairs[ Number( layer.getAttribute( LAYER_INDEX_ATTR ) ) ];
		if ( ! pair ) {
			// The def was re-registered mid-load with fewer layers.
			// Uncover rather than leave a layer that cannot animate.
			layer.remove();
			return null;
		}
		// Hint the compositor for the duration only. Left on permanently
		// it would keep a layer alive for every window in the shell; the
		// element is removed on finish, which retires the hint with it.
		layer.style.willChange = 'clip-path';
		const animation = layer.animate(
			[ { clipPath: pair.from }, { clipPath: pair.to } ],
			{
				duration: layerDuration,
				easing,
				delay,
				// `both` holds the `from` shape through the delay, so the
				// layers stay fully covering while the spinner fades.
				fill: 'both',
			},
		);
		running.set( layer, animation );
		return animation;
	};

	// Only layers that survived the paint check are animated. Every edge
	// runs its own layer's keyframes over a longer span, which is what
	// keeps it permanently a little behind its surface and therefore
	// visible as a band along that layer's boundary — and makes the
	// edges the last to land, so teardown hangs off one of them.
	const surfaceAnimations = findSurfaces( body )
		.map( ( el ) => play( el, duration ) )
		.filter( ( a ): a is Animation => a !== null );
	const edgeAnimations = findEdges( body )
		.map( ( el ) => play( el, duration + edgeLag ) )
		.filter( ( a ): a is Animation => a !== null );

	const surfaceAnimation = surfaceAnimations[ 0 ] ?? null;
	const edgeAnimation = edgeAnimations[ 0 ] ?? null;

	// Events rather than the `finished` promise: cancelling an animation
	// rejects that promise, and a window closed mid-reveal would surface
	// an unhandled rejection in the console for something entirely
	// routine.
	( edgeAnimation ?? surfaceAnimation )?.addEventListener( 'finish', finish );

	// Either layer being cancelled means the reveal is over — a re-arm
	// cancels both, and leaving the body pinned by `--revealing` after
	// that would freeze the content's opacity for good.
	const onCancel = (): void => {
		for ( const layer of painting ) {
			running.delete( layer );
		}
		body.classList.remove( REVEALING_BODY_CLASS );
	};
	surfaceAnimation?.addEventListener( 'cancel', onCancel );
	edgeAnimation?.addEventListener( 'cancel', onCancel );
}
