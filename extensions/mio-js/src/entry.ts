/**
 * mio-js — Mio as a drop-in `<script>`.
 *
 * One file, no build step for the page that uses it, no WordPress:
 *
 *     <script src="mio.min.js"></script>
 *
 * …and the official Mio is on the page — floating over the article,
 * watching the cursor, draggable, throwable, and bouncing off the
 * edges of the viewport.
 *
 * **This is not a re-implementation.** The simulation, the renderer,
 * the soft body and the silhouettes are imported straight from the
 * shell's own `src/mio/`, so the mascot on a blog is the same object,
 * to the pixel, as the one on an OpenStation desk. What this module
 * adds is only the three things the shell would otherwise have
 * provided:
 *
 *   1. **PixiJS.** The shell lazy-loads it through
 *      `wp.os.loadModules( [ 'pixijs' ] )`; here it is bundled in and
 *      published on `window.PIXI` for the length of the mount.
 *   2. **A layer to live in.** The shell owns `#os-mio` inside its
 *      own chrome and styles it from `desktop.css`. Here it is a fixed
 *      full-viewport element appended to `<body>`, with the two rules
 *      that matter inlined.
 *   3. **Somewhere to remember where it was put.** `localStorage`,
 *      same as the shell's controller.
 *
 * **What Mio does with an empty desk.** In the shell Mio is pulled
 * toward windows and widget cards and settles onto them. A blog has
 * neither, so nothing attracts it and it floats — which is exactly
 * what the shell's Mio does when every window is closed. Throw it and
 * it drifts and bounces off the viewport walls until friction takes
 * the energy out. That is the official behaviour, not a reduction of
 * it.
 *
 * Lifecycle is reported as DOM events on `document` — `mio:mounted`,
 * `mio:grabbed`, `mio:dropped`, `mio:displaced`, `mio:shape-changed`,
 * `mio:unmounted` — see `src/shims/hooks.ts`.
 */

import { Application, BlurFilter, Container, Graphics } from 'pixi.js';
import { MIO_DEFAULTS } from '../../../src/mio/config';
import { mountMio } from '../../../src/mio/mio';
import type { MioConfig, MioHandle } from '../../../src/mio/types';
import { getColliders, setColliders } from './colliders';

/** Id of the layer element this library owns. */
const LAYER_ID = 'mio-layer';

/** Id of the injected stylesheet, so a second load doesn't duplicate it. */
const STYLE_ID = 'mio-layer-style';

/** Where Mio's resting place is remembered. */
const POSITION_KEY = 'mio-js/position';

/**
 * Layer + drag-handle styling, transcribed from the `.os-mio` and
 * `.os-mio__handle` rules in the shell's `assets/css/desktop.css`.
 *
 * Two deliberate differences from the shell's version:
 *
 *   - `position: fixed`, not `absolute`. The shell's layer sits inside
 *     a shell element that already fills the viewport; a blog scrolls,
 *     and a companion that slides off the top of a long article as you
 *     read is a companion you lose.
 *   - An explicit, very high `z-index`. The shell has a z-index scale
 *     (`--os-z-mio`) and knows what it stacks against. This does not
 *     know what page it landed on, so it goes above it.
 *
 * `pointer-events: none` on the layer is not cosmetic and must not be
 * removed: the layer covers the whole viewport, and without it every
 * click on the page would land on Mio instead of the link underneath.
 * Only the small round handle riding on the body takes pointer events.
 */
const LAYER_CSS = `
#${ LAYER_ID } {
	position: fixed;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
	z-index: 2147483000;
}

#${ LAYER_ID } .os-mio__handle {
	/*
	 * PHYSICAL top/left, deliberately: the handle is placed every
	 * frame by a translate3d() carrying canvas coordinates, and
	 * transform is always physical. A logical inset-inline-start would
	 * flip the origin under RTL while the translation kept pushing
	 * rightwards, and the handle would walk off screen.
	 */
	position: absolute;
	top: 0;
	left: 0;
	border-radius: 50%;
	pointer-events: auto;
	cursor: grab;
	will-change: transform;
	touch-action: none;
}

#${ LAYER_ID } .os-mio__handle.is-dragging {
	cursor: grabbing;
}
`;

/**
 * Public surface, published as `window.Mio`.
 *
 * Deliberately small. This library ships one Mio, the official one,
 * and its only settings are "here" and "not here" — anything that
 * looks like a styling knob belongs in the shell's "Make it yours"
 * panel, which is not part of this build.
 *
 * @public
 */
export interface MioStandalone {
	/** Put Mio on the page. Resolves once it is rendering. Idempotent. */
	start: () => Promise< void >;
	/** Take Mio off the page and release its WebGL context. */
	stop: () => void;
	/** Whether Mio is currently on the page. */
	isRunning: () => boolean;
	/** Body centre in viewport coordinates, or `null` when stopped. */
	getPosition: () => { x: number; y: number } | null;
	/** Move Mio. No-op when stopped. */
	setPosition: ( x: number, y: number ) => void;
	/**
	 * Make the elements matching a CSS selector solid, so Mio bumps
	 * into them, is drawn toward them, and comes to rest on them.
	 * `null` clears it and leaves Mio in an empty room.
	 *
	 * Collision uses each element's **content box** — no margin, no
	 * padding — and is re-read as the page scrolls. See
	 * `src/colliders.ts`.
	 */
	setColliders: ( selector: string | null ) => void;
	/** The collision selector in force, or `null`. */
	getColliders: () => string | null;
	/** The configuration Mio is running with — the reference design. */
	config: MioConfig;
}

declare global {
	interface Window {
		/** The library's own API. */
		Mio?: MioStandalone;
		/**
		 * Set to `false` before this script loads to keep Mio off the
		 * page until something calls `Mio.start()`.
		 */
		MIO_AUTO_BOOT?: boolean;
	}
}

let handle: MioHandle | null = null;
let layer: HTMLElement | null = null;
/** In-flight `start()`, so two calls in a row don't mount two Mios. */
let starting: Promise< void > | null = null;

/** Inject the layer stylesheet once. */
function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = LAYER_CSS;
	document.head.appendChild( style );
}

/** Create (or recover) the full-viewport layer Mio lives in. */
function ensureLayer(): HTMLElement {
	const existing = document.getElementById( LAYER_ID );
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'div' );
	el.id = LAYER_ID;
	// Decorative: Mio carries no information a screen reader needs,
	// and its drag handle is not a control.
	el.setAttribute( 'aria-hidden', 'true' );
	document.body.appendChild( el );
	return el;
}

/** Read the saved position, or `null` on a first visit. */
function readPosition(): { x: number; y: number } | null {
	try {
		const raw = window.localStorage.getItem( POSITION_KEY );
		if ( ! raw ) {
			return null;
		}
		const parsed = JSON.parse( raw ) as { x?: unknown; y?: unknown };
		if (
			typeof parsed?.x !== 'number' ||
			typeof parsed?.y !== 'number' ||
			! Number.isFinite( parsed.x ) ||
			! Number.isFinite( parsed.y )
		) {
			return null;
		}
		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

/** Remember where Mio was put down. */
function writePosition( pos: { x: number; y: number } ): void {
	try {
		window.localStorage.setItem( POSITION_KEY, JSON.stringify( pos ) );
	} catch {
		/* Private mode / quota — Mio just recentres on the next load. */
	}
}

/**
 * The PixiJS surface Mio uses — all of it.
 *
 * `src/mio/mio.ts` names exactly four Pixi symbols, and this object is
 * what it receives as `window.PIXI`. Naming them individually rather
 * than re-exporting the module (`import * as PIXI`) is not tidiness:
 * a namespace import forces every export of Pixi's barrel to be
 * retained, because the namespace object must be complete. It defeats
 * tree-shaking wholesale — a namespace import alone put ~400 kB of
 * renderer, text and sprite code into this bundle that nothing
 * referenced.
 *
 * If a future `src/mio/*` reaches for a fifth symbol it will fail
 * loudly at mount (`pixi.X is not a constructor`) rather than
 * silently, and the fix is to add it here.
 */
const PIXI = { Application, BlurFilter, Container, Graphics };

/**
 * Run `fn` with our bundled PixiJS visible as `window.PIXI`, then put
 * the global back exactly as it was.
 *
 * `mountMio()` reads `window.PIXI` because in the shell PixiJS arrives
 * as a separate vendor script. Here it is bundled, so the global is
 * how we hand it over — but only for the duration of the mount. A blog
 * that already uses PixiJS for something else of its own (possibly a
 * different major version) must not find its global quietly replaced
 * by ours, and `mio.ts` captures the reference it is given in a
 * closure, so it never needs the global again after mount.
 */
async function withPixiGlobal< T >( fn: () => Promise< T > ): Promise< T > {
	const had = Object.prototype.hasOwnProperty.call( window, 'PIXI' );
	const previous = window.PIXI;
	window.PIXI = PIXI as unknown as typeof window.PIXI;
	try {
		return await fn();
	} finally {
		if ( had ) {
			window.PIXI = previous;
		} else {
			delete window.PIXI;
		}
	}
}

/** Put Mio on the page. */
async function start(): Promise< void > {
	if ( handle ) {
		return;
	}
	if ( starting ) {
		return starting;
	}
	starting = ( async () => {
		ensureStyle();
		const host = ensureLayer();
		layer = host;
		/*
		 * A mascot must never take the page down with it.
		 *
		 * `mountMio()` returns null for the failure it expects — no
		 * WebGL — but this bundle is a trimmed PixiJS (see PIXI_UNUSED
		 * in `vite.config.js`), and the failure mode of a trim that
		 * went too far is a throw from deep inside Pixi's boot. On an
		 * OpenStation desk that surfaces to someone who can fix it; on
		 * a stranger's blog it would be an unhandled rejection in the
		 * console of a page that has nothing to do with us. So it is
		 * caught, named, and the layer is cleaned up.
		 */
		let mounted;
		try {
			mounted = await withPixiGlobal( () =>
				mountMio( {
					host,
					config: MIO_DEFAULTS,
					position: readPosition(),
					savePosition: writePosition,
				} ),
			);
		} catch ( err ) {
			console.warn( '[mio-js] Mio failed to start.', err );
			mounted = null;
		}
		if ( ! mounted ) {
			// Pixi refused to start (no WebGL, a blocked context).
			// Drop the empty layer rather than leaving a dead element
			// on someone's page.
			host.remove();
			layer = null;
			return;
		}
		handle = mounted;
	} )().finally( () => {
		starting = null;
	} );
	return starting;
}

/**
 * Take Mio off the page.
 *
 * Unlike the shell — which *parks* a stopped Mio because releasing a
 * WebGL context makes the compositor re-rasterise the whole desk —
 * this really does destroy it. A blog that calls `stop()` is not
 * toggling a setting it will toggle back a second later; it is done
 * with the mascot, and holding a GPU context open on someone else's
 * page for the rest of its life to save a hypothetical restart is the
 * wrong trade.
 */
function stop(): void {
	const live = handle;
	handle = null;
	if ( live ) {
		// Read the position while the layer is still laid out: a hidden
		// or detached host reports zero size, and every position derived
		// from one of those is the top-left corner.
		const resting = live.getPosition();
		if ( resting ) {
			writePosition( resting );
		}
		live.destroy();
	}
	layer?.remove();
	layer = null;
}

const api: MioStandalone = {
	start,
	stop,
	isRunning: () => handle !== null,
	getPosition: () => handle?.getPosition() ?? null,
	setPosition: ( x: number, y: number ) => handle?.setPosition( x, y ),
	setColliders,
	getColliders,
	config: MIO_DEFAULTS,
};

window.Mio = api;

/**
 * Should this script mount Mio by itself?
 *
 * Dropping a `<script>` in and getting a mascot is the whole premise,
 * so the answer is yes unless the page says otherwise — either by
 * setting `window.MIO_AUTO_BOOT = false` before the tag, or by putting
 * `data-mio-auto="false"` on the tag itself, which is the only opt-out
 * available to a page that cannot add a second inline script (a
 * hosted blog's "custom HTML" box, say).
 */
const tag = document.currentScript as HTMLScriptElement | null;

function wantsAutoBoot(): boolean {
	if ( window.MIO_AUTO_BOOT === false ) {
		return false;
	}
	return tag?.dataset?.mioAuto !== 'false';
}

// `<script src="mio.min.js" data-mio-colliders="h1, h2">` — the same
// one-tag integration for pages that want Mio to have something to sit
// on. `Mio.setColliders()` is the equivalent from script.
if ( tag?.dataset?.mioColliders ) {
	setColliders( tag.dataset.mioColliders );
}

if ( wantsAutoBoot() ) {
	// `document.body` has to exist before the layer can be appended,
	// and a `<script>` in the `<head>` runs before it does.
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', () => void start(), {
			once: true,
		} );
	} else {
		void start();
	}
}

export default api;
