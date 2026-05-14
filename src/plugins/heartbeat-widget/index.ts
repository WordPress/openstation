/**
 * Desktop Mode — Heartbeat widget (lazy bundle).
 *
 * Built as its own Vite target (`widget-heartbeat`) — both JS and
 * the widget's CSS ship out of the main `desktop.min.js` bundle.
 * PHP registers the widget via `desktop_mode_register_widget()`
 * with the script handle `desktop-mode-heartbeat-widget`; the
 * shell's widgets `server-sync` loads this bundle the first time
 * the picker renders or the widget mounts.
 *
 * The bundle's only side effect is publishing a mount callback on
 * `window.desktopModeWidgets[ 'desktop-mode/heartbeat' ]`.
 *
 * @since 0.18.0
 */

// Side-effect CSS import — Vite emits a separate
// `widget-heartbeat[.min].css` chunk next to the JS. PHP eagerly
// enqueues this stylesheet via `desktop_mode_enqueue_heartbeat_widget_styles`
// so it's in the DOM before the (lazy-loaded) JS runs — avoids
// any flash of unstyled content while the layout is still
// computing flex constraints.
import './styles.css';

import type { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { __ } from '../../i18n';
import { createSharedStore } from '../../shared-store';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

/**
 * Bridge to the main bundle's lazy module loader. Each IIFE
 * bundle has its OWN copy of `src/modules/registry.ts` — the
 * `pixijs` module is registered in the main bundle's copy
 * (see `desktop.ts`), not ours. We can't import the registry
 * directly and have it work; we have to reach for the public
 * `wp.desktop.loadModules()` API that lives on the main bundle.
 */
async function loadPixi(): Promise< void > {
	const wp = ( window as unknown as {
		wp?: { desktop?: { loadModules?: ( ids: string[] ) => Promise< void > } };
	} ).wp;
	const fn = wp?.desktop?.loadModules;
	if ( typeof fn !== 'function' ) {
		throw new Error(
			'wp.desktop.loadModules is not available — main shell may not have booted yet.',
		);
	}
	await fn( [ 'pixijs' ] );
}

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

interface WpHeartbeat {
	interval?: () => number;
	connectNow?: () => void;
	hasFocus?: () => boolean;
}
interface WpGlobal {
	heartbeat?: WpHeartbeat;
}
type JQueryLike = ( target: unknown ) => {
	on: ( event: string, handler: ( ...args: unknown[] ) => void ) => unknown;
	off: ( event: string, handler: ( ...args: unknown[] ) => void ) => unknown;
};

/**
 * Singleton WP-heartbeat tracker. Survives widget mount/unmount —
 * re-adding the widget no longer resets `lastTickAt` to "now"
 * (the bug where the countdown restarted at the full interval).
 *
 * The bus is bootstrapped lazily the first time any heartbeat
 * widget mounts. From then on it owns the jQuery listeners and
 * widgets just subscribe to the store.
 */
interface WpBeatState {
	lastTickAt: number;
	lastSendAt: number;
	intervalSecs: number;
	tickSeq: number;
	booted: boolean;
}

const wpBeatStore = createSharedStore< WpBeatState >(
	'desktop-mode/heartbeat-widget/wp-beats',
	() => ( {
		lastTickAt: 0,
		lastSendAt: 0,
		intervalSecs: 15,
		tickSeq: 0,
		booted: false,
	} ),
);

function bootWpBeatTracker(): void {
	const s = wpBeatStore;
	if ( s.state.booted ) {
		return;
	}
	s.state.booted = true;
	s.state.intervalSecs = wpHeartbeatInterval();

	// Estimate the initial `lastTickAt` so the countdown starts
	// moving immediately rather than displaying "—" until the
	// first real tick arrives. Wrong by up to one interval — the
	// next real `heartbeat-tick` snaps it to the truth and the
	// bar/readout stay accurate from then on.
	s.state.lastTickAt = performance.now();

	// WordPress Core's Heartbeat API publishes its lifecycle as
	// jQuery custom events on `document`:
	//   - `heartbeat-send` — about to fire an AJAX request.
	//   - `heartbeat-tick` — server response received.
	// There is NO native CustomEvent equivalent in Core, so the
	// only way to observe the real ticks is to subscribe through
	// jQuery. The existing `src/heartbeat.ts` framework module
	// works the same way; we mirror its pattern here.
	const jq = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! jq ) {
		return;
	}
	const $doc = jq( document );
	$doc.on( 'heartbeat-send', () => {
		s.state.lastSendAt = performance.now();
	} );
	$doc.on( 'heartbeat-tick', () => {
		s.state.lastTickAt = performance.now();
		s.state.intervalSecs = wpHeartbeatInterval();
		// Bump the sequence — widgets watch this to know "a tick
		// happened, fire the big-beat animation now."
		s.state.tickSeq += 1;
		s.notify();
	} );

	// We don't call `wp.heartbeat.connectNow()`. It would force
	// an immediate round-trip which resyncs `lastTickAt` within
	// a second — but the resync makes the countdown jump
	// backwards from the boot estimate, which feels like the
	// widget is broken. Letting WordPress fire its next tick on
	// its natural schedule produces a smooth, monotonic
	// countdown that resyncs once and then stays correct forever.
}

// Heart palette — bottom-to-top gradient stack approximates a soft
// 3D inflation. Outer rim is darkest, body warmest, inner glow is
// the lightest.
const HEART_PALETTE = {
	rim: 0x6a0f25,
	deep: 0x991f3a,
	body: 0xd4264f,
	bright: 0xff4d6d,
	hi: 0xffa5b8,
} as const;
const HEART_COLOR_REST = HEART_PALETTE.bright;
const HEART_COLOR_BEAT = HEART_PALETTE.hi;
const HEART_SIZE = 52;

/**
 * Mount callback. The framework's widget `server-sync` reads this
 * from `window.desktopModeWidgets` after the bundle loads and
 * pairs it with the server-supplied metadata from
 * `desktop_mode_register_widget()`. Sizing constraints
 * (310 × 230, non-resizable) live on the PHP side now.
 */
const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {
	try {
		await loadPixi();
	} catch ( e ) {
		renderFallback( container, ( e as Error ).message );
		return () => undefined;
	}
	return mountWithPixi( container, ctx );
};

// `__()` is here for the i18n string-extractor — translations
// the runtime widget surfaces. Without a real reference TypeScript
// would mark it as unused.
void __;

function logoUrl( ctx: WidgetContext ): string {
	const base = ( ctx?.pluginUrl ?? '' ).replace( /\/+$/, '' );
	return `${ base }/assets/images/wp-logo.png`;
}

function renderFallback( container: HTMLElement, message: string ): void {
	container.classList.add( 'desktop-mode-widget-heartbeat' );
	container.classList.add( 'desktop-mode-widget-heartbeat--fallback' );
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-widget-heartbeat__fallback';
	wrap.textContent = message || 'Could not load animation engine.';
	container.appendChild( wrap );
}

/**
 * Heights applied to the widget frame (`.desktop-mode-widgets__card`)
 * when the user toggles the heart visibility from the right-click
 * menu. Width stays locked at 310 in both modes.
 */
const FRAME_HEIGHT_WITH_HEART = 230;
// Compact mode is just `title bar + label/time + progress bar` —
// no stage, no heart. The actual content adds up to:
//
//   chrome           32
// + card-body pad    16   (8 + 8, this widget's override)
// + meta row         16
// + 8-px gap          8
// + bar              10
// ─────────────────────
//   ≈ 82 px
//
// 88 leaves a couple of pixels of breathing room without the
// large empty band the old 130-px frame produced (the user-
// reported "strange gap at the top"). The meta row keeps its
// `margin-top: auto` so any remaining slack settles between the
// title bar and the label, NOT below the progress bar — the bar
// should always hug the card's bottom edge as a status footer.
const FRAME_HEIGHT_NO_HEART = 88;

async function mountWithPixi(
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		renderFallback( container, 'PIXI not available.' );
		return () => undefined;
	}

	container.classList.add( 'desktop-mode-widget-heartbeat' );

	// User preference (per-widget instance, persisted in
	// `localStorage` via the framework's namespaced storage).
	let showHeart = ctx.storage.get< boolean >( 'showHeart' ) ?? true;
	if ( ! showHeart ) {
		container.classList.add( 'desktop-mode-widget-heartbeat--no-heart' );
	}

	const stage = document.createElement( 'div' );
	stage.className = 'desktop-mode-widget-heartbeat__stage';
	container.appendChild( stage );

	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-widget-heartbeat__meta';
	const label = document.createElement( 'div' );
	label.className = 'desktop-mode-widget-heartbeat__label';
	label.textContent = 'Next beat in';
	meta.appendChild( label );
	const remaining = document.createElement( 'div' );
	remaining.className = 'desktop-mode-widget-heartbeat__remaining';
	remaining.textContent = '—';
	meta.appendChild( remaining );
	container.appendChild( meta );

	const bar = document.createElement( 'div' );
	bar.className = 'desktop-mode-widget-heartbeat__bar';
	const fill = document.createElement( 'div' );
	fill.className = 'desktop-mode-widget-heartbeat__bar-fill';
	bar.appendChild( fill );
	container.appendChild( bar );

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );

	// Soft halo behind the heart (pulses with glow), the heart
	// itself in the middle, and a centred WP logo sprite on top.
	const halo: Graphics = buildHalo( pixi );
	const heart: Container = buildHeart( pixi );
	const logo: Sprite = buildLogoSprite( pixi, logoUrl( ctx ) );
	app.stage.addChild( halo );
	app.stage.addChild( heart );
	heart.addChild( logo );

	const centre = (): void => {
		halo.x = app.screen.width / 2;
		halo.y = app.screen.height / 2;
		heart.x = app.screen.width / 2;
		heart.y = app.screen.height / 2;
	};
	centre();
	const ro = new ResizeObserver( () => centre() );
	ro.observe( stage );

	// Boot the singleton WP-heartbeat tracker. Idempotent — if
	// another instance of this widget is already mounted, this is
	// a no-op.
	bootWpBeatTracker();

	// Per-widget animation state.
	let pulseAccum = 0;
	let bigBeatT = 0; // 0 → 1 envelope when a big beat is firing.
	let glow = 0; // 0 → 1 halo intensity, decays.
	let lastSeenSeq = wpBeatStore.state.tickSeq;

	// Subscribe to the shared store; when the sequence advances
	// a real WP tick happened, so trigger the big-beat animation.
	const unsubscribe = wpBeatStore.subscribe( ( s ) => {
		if ( s.tickSeq !== lastSeenSeq ) {
			lastSeenSeq = s.tickSeq;
			bigBeatT = 1;
			glow = 1;
		}
	} );

	// On the jQuery-less fallback path (rare — stripped-down
	// pages), simulate ticks at the heartbeat interval.
	const jq = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	let simHandle: ReturnType< typeof setInterval > | null = null;
	if ( ! jq ) {
		simHandle = setInterval( () => {
			wpBeatStore.state.lastTickAt = performance.now();
			wpBeatStore.state.tickSeq += 1;
			wpBeatStore.notify();
		}, wpBeatStore.state.intervalSecs * 1000 );
	}
	const detach = (): void => {
		unsubscribe();
		if ( simHandle !== null ) {
			clearInterval( simHandle );
		}
	};

	// Ticker — one update path computes the resting pulse, the
	// big-beat envelope, the halo, and the progress bar each frame.
	const tick = (): void => {
		const dt = app.ticker.deltaMS / 1000;
		pulseAccum += dt;

		// Resting breath — single soft sine cycle every 4 seconds.
		// Amplitude is ±0.8% of scale: just enough to confirm the
		// widget is alive without drawing the eye. The user's
		// attention should land on the BIG beat that fires when WP
		// actually ticks; this is just the idle hum.
		const restPhase = ( pulseAccum / 4.0 ) * Math.PI * 2;
		const restingScaleBase = 1 + 0.008 * Math.sin( restPhase );
		let restingScale = restingScaleBase;

		// Big beat envelope — dramatic contraction with squish +
		// overshoot. Decays over ~900 ms.
		//
		// Timeline (t = 0 at fire, 1 when done):
		//   0.00 → 0.10  rapid swell to peak (+55 % scale)
		//   0.10 → 0.28  brief dip below resting (+5 %) — feels
		//                like a heart momentarily relaxing
		//   0.28 → 0.55  bounce-back overshoot (+15 %)
		//   0.55 → 1.00  damped return to resting
		// During 0.00 → 0.20 we also squish horizontally a touch
		// (wider, slightly shorter) like a real contracting muscle.
		let squishX = 0;
		let squishY = 0;
		if ( bigBeatT > 0 ) {
			bigBeatT = Math.max( 0, bigBeatT - dt / 0.9 );
			const t = 1 - bigBeatT;
			let env: number;
			if ( t < 0.10 ) {
				env = 0.55 * ( t / 0.10 );
			} else if ( t < 0.28 ) {
				env = 0.55 - 0.50 * ( ( t - 0.10 ) / 0.18 );
			} else if ( t < 0.55 ) {
				env = 0.05 + 0.10 * Math.sin( ( ( t - 0.28 ) / 0.27 ) * Math.PI );
			} else {
				const k = ( t - 0.55 ) / 0.45;
				env = 0.05 * ( 1 - k ) * Math.exp( -2.5 * k );
			}
			restingScale += env;

			// Squish — strongest at peak contraction, fades by t=0.28.
			if ( t < 0.20 ) {
				const sP = Math.sin( ( t / 0.20 ) * Math.PI );
				squishX = 0.10 * sP;
				squishY = -0.05 * sP;
			}
		}

		heart.scale.x = restingScale * ( 1 + squishX );
		heart.scale.y = restingScale * ( 1 + squishY );

		// Halo: dim, large, follows glow level with easing. Peak
		// scale ×1.15 — tuned (alongside the radii in `buildHalo`)
		// so the outer ring stays inside the 140 px stage at the
		// big-beat peak. A larger multiplier blew the halo past
		// the stage edges and made the glow look chopped.
		glow = Math.max( 0, glow - dt / 1.2 );
		halo.alpha = 0.10 + glow * 0.55;
		const haloScale = 1 + glow * 0.15;
		halo.scale.set( haloScale );

		// Color tint: blend toward the lighter "beating" hue with
		// the big-beat envelope so the colour and the scale move
		// together.
		( heart as unknown as { tint: number } ).tint = lerpColor(
			HEART_COLOR_REST,
			HEART_COLOR_BEAT,
			Math.min( 1, glow * 0.6 + bigBeatT * 0.4 ),
		);

		// Progress bar — reads from the SHARED store so re-adding
		// the widget keeps the countdown accurate across mount/
		// unmount cycles. Until the first real `heartbeat-tick`
		// arrives, `lastTickAt` is an estimate from boot; after
		// that it's the truth from the server.
		const elapsed = ( performance.now() - wpBeatStore.state.lastTickAt ) / 1000;
		const intervalSecs = wpBeatStore.state.intervalSecs;
		const progress = clamp( elapsed / Math.max( intervalSecs, 1 ), 0, 1 );
		fill.style.width = `${ ( progress * 100 ).toFixed( 1 ) }%`;
		const remainSecs = Math.max( 0, intervalSecs - elapsed );
		remaining.textContent = `${ remainSecs.toFixed( 1 ) }s`;
	};
	app.ticker.add( tick );

	// When the heart is shown — either at mount, or via the
	// right-click toggle — PIXI may have initialized with a
	// 0×0 stage (compact mode hides the stage with `display:
	// none`). `resizeTo: stage` only sees a real size AFTER the
	// stage gains its 170 px height; force a re-measure on the
	// next frame so the canvas + heart paint at full scale.
	const resyncCanvasToStage = (): void => {
		requestAnimationFrame( () => {
			try {
				( app as unknown as { resize?: () => void } ).resize?.();
			} catch ( _e ) {
				// Defensive — older PIXI versions exposed
				// `renderer.resize(w, h)` instead. Fall back to
				// reading the live stage dimensions.
				try {
					const sw = stage.clientWidth;
					const sh = stage.clientHeight;
					if ( sw > 0 && sh > 0 ) {
						( app.renderer as unknown as { resize: ( w: number, h: number ) => void } ).resize( sw, sh );
					}
				} catch ( _err ) {
					// Last-resort: nothing to do, the resting tick
					// will rerun layout next frame anyway.
				}
			}
			centre();
		} );
	};

	// Right-click — open a tiny context menu with the
	// "Show heart" toggle. Resize the widget frame on toggle.
	const onContextMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		e.stopPropagation();
		openHeartbeatMenu( e, showHeart, ( next ) => {
			showHeart = next;
			ctx.storage.set( 'showHeart', next );
			applyHeartVisibility( container, next );
			if ( next ) {
				resyncCanvasToStage();
			}
		} );
	};
	container.addEventListener( 'contextmenu', onContextMenu );

	// Apply the initial frame size — synchronously after mount so
	// there's no flash of full-height when the user previously
	// turned the heart off.
	applyHeartVisibility( container, showHeart );
	if ( showHeart ) {
		// Even on a fresh mount with `showHeart=true`, the stage
		// can be measured at 0×0 if the widget body hasn't been
		// laid out yet (the framework appends the body and only
		// then runs flex sizing). Schedule a resync so the heart
		// always paints at the correct size on first frame.
		resyncCanvasToStage();
	}

	return () => {
		container.removeEventListener( 'contextmenu', onContextMenu );
		detach();
		ro.disconnect();
		app.ticker.remove( tick );
		app.destroy( { removeView: true }, { children: true, texture: true } );
		container.classList.remove( 'desktop-mode-widget-heartbeat' );
		container.classList.remove( 'desktop-mode-widget-heartbeat--no-heart' );
	};
}

function applyHeartVisibility( container: HTMLElement, showHeart: boolean ): void {
	container.classList.toggle( 'desktop-mode-widget-heartbeat--no-heart', ! showHeart );
	const card = container.closest< HTMLElement >( '.desktop-mode-widgets__card' );
	if ( card ) {
		// Class on the card lets a stylesheet (see desktop.css)
		// flip the card into `display: flex; flex-direction:
		// column; overflow: hidden`. The card-body inside then
		// becomes a flex item that fills available space and
		// stays bounded by the card's height — without this the
		// body grew with content and the progress bar escaped
		// the card frame on compact mode.
		card.classList.add( 'desktop-mode-widgets__card--heartbeat' );
		const h = showHeart ? FRAME_HEIGHT_WITH_HEART : FRAME_HEIGHT_NO_HEART;
		card.style.height = `${ h }px`;
	}
}

function openHeartbeatMenu(
	e: MouseEvent,
	showHeart: boolean,
	onToggle: ( next: boolean ) => void,
): void {
	// Drop any stale menus this widget left behind on a previous
	// open — guards against quick repeated right-clicks.
	document
		.querySelectorAll( '.desktop-mode-widget-heartbeat__menu' )
		.forEach( ( el ) => el.remove() );

	const menu = document.createElement( 'wpd-context-menu' );
	menu.className = 'desktop-mode-widget-heartbeat__menu';
	menu.setAttribute( 'open', '' );
	menu.style.position = 'fixed';
	menu.style.left = `${ e.clientX }px`;
	menu.style.top = `${ e.clientY }px`;
	menu.style.zIndex = '10500';

	const opt = document.createElement( 'wpd-context-menu-option' );
	opt.setAttribute( 'value', 'show-heart' );
	if ( showHeart ) {
		opt.setAttribute( 'checked', '' );
	}
	opt.textContent = 'Show heart';
	menu.appendChild( opt );

	const close = (): void => {
		menu.remove();
		document.removeEventListener( 'pointerdown', onOutside, true );
		document.removeEventListener( 'keydown', onKey, true );
	};
	const onOutside = ( ev: Event ): void => {
		if ( ! menu.contains( ev.target as Node ) ) {
			close();
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			close();
		}
	};

	menu.addEventListener( 'wpd-context-menu-pick', () => {
		onToggle( ! showHeart );
		close();
	} );

	document.body.appendChild( menu );
	// Clamp menu to viewport.
	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 4, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max( 4, window.innerHeight - rect.height - 8 ) }px`;
	}

	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
}

function buildHalo( pixi: typeof import( 'pixi.js' ) ): Graphics {
	const g = new pixi.Graphics();
	// Soft radial gradient by stacking translucent circles. PIXI v8
	// has filters/shaders for real gradients but a stack of fills
	// is cheap and visually identical at this scale.
	//
	// Radii are sized so the OUTER ring, at peak scale (×1.15 — see
	// the ticker), is roughly 144 px wide — just under the 140 px
	// stage with a touch of clip on the very faint outermost edge.
	// Previous values (1.8 / 1.4 / 1.0) projected a 262 px halo at
	// peak which clipped massively on a 140 px stage, so the rings
	// looked truncated.
	const radii = [ HEART_SIZE * 1.20, HEART_SIZE * 1.05, HEART_SIZE * 0.85 ];
	const alphas = [ 0.12, 0.18, 0.28 ];
	radii.forEach( ( r, i ) => {
		g.circle( 0, 0, r );
		g.fill( { color: HEART_COLOR_BEAT, alpha: alphas[ i ] } );
	} );
	g.alpha = 0.1;
	return g;
}

/**
 * Parametric heart curve. Bounding box for the unscaled formula:
 *   x ∈ [-16, 16]   →   width  = 32
 *   y ∈ [-15, 9]    →   height = 24
 * That's already a slightly wider-than-tall heart (4:3). We add a
 * small x-axis stretch (× 1.08) so the silhouette reads
 * unambiguously wider — closer to a Hallmark heart than a
 * mathematically pure one. Y is left alone; per-layer Y offsets
 * are gone (they were stretching the silhouette in the old
 * stacked-fills approach).
 */
function heartPath( scaleMul = 1 ): number[] {
	const samples = 240;
	const pts: number[] = [];
	const s = ( HEART_SIZE / 17 ) * scaleMul;
	for ( let i = 0; i <= samples; i++ ) {
		const t = ( i / samples ) * Math.PI * 2;
		const x = 16 * 1.08 * Math.sin( t ) ** 3;
		const y = -(
			13 * Math.cos( t ) -
				5 * Math.cos( 2 * t ) -
				2 * Math.cos( 3 * t ) -
				Math.cos( 4 * t )
		);
		pts.push( x * s, y * s );
	}
	return pts;
}

function buildHeart( pixi: typeof import( 'pixi.js' ) ): Container {
	const wrap = new pixi.Container();
	const bounds = heartBoundingY();

	// Drop shadow — large, soft, centred under the heart.
	const shadow = new pixi.Graphics();
	shadow.poly( heartPath( 1.05 ) );
	shadow.fill( { color: 0x000000, alpha: 0.55 } );
	shadow.y = 5;
	shadow.alpha = 0.55;
	wrap.addChild( shadow );

	// REAL gradient. We render a vertical CSS-style linear
	// gradient onto a 2 × 512 canvas, wrap it in a PIXI Texture,
	// stretch it across the heart's bounding box as a Sprite, and
	// mask the sprite with the heart polygon. This sidesteps any
	// PIXI v8 FillGradient quirks (which were silently falling
	// back to a solid fill on the user's build) and gives us a
	// truly continuous gradient — no banding, no stacked layers.
	const gradientCanvas = makeGradientCanvas();
	const gradientTexture: Texture = pixi.Texture.from( gradientCanvas );
	const gradientSprite = new pixi.Sprite( gradientTexture );
	const heartHeight = bounds.maxY - bounds.minY;
	const overscan = HEART_SIZE * 2.5; // give the sprite room laterally
	gradientSprite.width = overscan;
	gradientSprite.height = heartHeight;
	gradientSprite.x = -overscan / 2;
	gradientSprite.y = bounds.minY;

	const mask = new pixi.Graphics();
	mask.poly( heartPath( 1.0 ) );
	mask.fill( { color: 0xffffff, alpha: 1 } );

	gradientSprite.mask = mask;
	wrap.addChild( mask );
	wrap.addChild( gradientSprite );

	// Specular highlight on the left lobe — small, restrained.
	// Backed off from the previous alpha 0.65 so the underlying
	// gradient is the dominant lighting cue, not this overlay.
	const hi1 = new pixi.Graphics();
	hi1.ellipse(
		-HEART_SIZE * 0.32,
		-HEART_SIZE * 0.50,
		HEART_SIZE * 0.18,
		HEART_SIZE * 0.10,
	);
	hi1.fill( { color: 0xffffff, alpha: 0.45 } );
	hi1.rotation = -0.5;
	wrap.addChild( hi1 );

	// Tiny secondary highlight on the right lobe.
	const hi2 = new pixi.Graphics();
	hi2.ellipse(
		HEART_SIZE * 0.20,
		-HEART_SIZE * 0.38,
		HEART_SIZE * 0.09,
		HEART_SIZE * 0.05,
	);
	hi2.fill( { color: 0xffffff, alpha: 0.22 } );
	hi2.rotation = 0.4;
	wrap.addChild( hi2 );

	// Silhouette outline.
	const outline = new pixi.Graphics();
	outline.poly( heartPath( 1.0 ) );
	outline.stroke( { color: 0xffffff, alpha: 0.18, width: 1 } );
	wrap.addChild( outline );

	return wrap;
}

/**
 * Vertical span of the heart path in local pixels — used to size
 * the gradient sprite exactly.
 */
function heartBoundingY(): { minY: number; maxY: number } {
	const s = HEART_SIZE / 17;
	return {
		minY: -15 * s,
		maxY: 9 * s,
	};
}

/**
 * Build a 2 × 512 canvas painted with the heart's vertical
 * gradient. 2 px wide instead of 1 because some browsers refuse
 * to upload 1-px-wide textures cleanly. 512 px tall gives enough
 * resolution that the gradient is smooth at any heart size.
 */
function makeGradientCanvas(): HTMLCanvasElement {
	const c = document.createElement( 'canvas' );
	c.width = 2;
	c.height = 512;
	const ctx = c.getContext( '2d' );
	if ( ! ctx ) {
		return c;
	}
	const grad = ctx.createLinearGradient( 0, 0, 0, 512 );
	grad.addColorStop( 0.00, '#ffd6e3' );
	grad.addColorStop( 0.18, '#ff8ba3' );
	grad.addColorStop( 0.42, '#ff4d6d' );
	grad.addColorStop( 0.72, '#9a1f3d' );
	grad.addColorStop( 1.00, '#3d061a' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, 2, 512 );
	return c;
}

function buildLogoSprite(
	pixi: typeof import( 'pixi.js' ),
	url: string,
): Sprite {
	const sprite = new pixi.Sprite();
	sprite.anchor.set( 0.5 );
	sprite.alpha = 0.95;
	// Visual centre — pulled a touch BELOW the heart's geometric
	// midline so the W mark sits in the meaty mid-body of the
	// heart rather than floating between the upper lobes. The
	// optical centre of a heart shape is below its geometric one
	// because the lobes are visually heavier than the V-cleft.
	sprite.y = HEART_SIZE * 0.08;

	const targetWidth = HEART_SIZE * 0.92;
	pixi.Assets
		.load( url )
		.then( ( texture: Texture ) => {
			sprite.texture = texture;
			const scale = targetWidth / Math.max( 1, texture.width );
			sprite.scale.set( scale );
		} )
		.catch( () => {
			// PNG missing or CSP block — heart still looks fine
			// without the logo.
		} );

	return sprite;
}

function wpHeartbeatInterval(): number {
	const wp = ( window as unknown as { wp?: WpGlobal } ).wp;
	try {
		const fn = wp?.heartbeat?.interval;
		if ( typeof fn === 'function' ) {
			const v = Number( fn() );
			if ( Number.isFinite( v ) && v > 0 ) {
				return v;
			}
		}
	} catch ( e ) {
		// Heartbeat API may be initializing — fall through to default.
	}
	return 15;
}

function lerpColor( a: number, b: number, t: number ): number {
	// Decompose 24-bit RGB without bitwise ops (the codebase forbids
	// bitwise via lint). Math.floor/Math.trunc on the integer-divided
	// channel gives the same byte values as `>>` shifts.
	const ar = Math.trunc( a / 65536 ) % 256;
	const ag = Math.trunc( a / 256 ) % 256;
	const ab = a % 256;
	const br = Math.trunc( b / 65536 ) % 256;
	const bg = Math.trunc( b / 256 ) % 256;
	const bb = b % 256;
	const r = Math.round( ar + ( br - ar ) * t );
	const g = Math.round( ag + ( bg - ag ) * t );
	const bv = Math.round( ab + ( bb - ab ) * t );
	return r * 65536 + g * 256 + bv;
}

function clamp( v: number, lo: number, hi: number ): number {
	if ( v < lo ) {
		return lo;
	}
	if ( v > hi ) {
		return hi;
	}
	return v;
}

// Side-effect: publish on the framework's well-known global so
// `widgets/server-sync.ts` pairs us with the PHP-side def.
const w = window as unknown as {
	desktopModeWidgets?: Record<
		string,
		( container: HTMLElement, ctx: WidgetContext ) => WidgetTeardown | Promise< WidgetTeardown >
	>;
};
w.desktopModeWidgets = w.desktopModeWidgets || {};
w.desktopModeWidgets[ 'desktop-mode/heartbeat' ] = mount;
