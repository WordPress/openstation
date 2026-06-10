/**
 * Desktop Mode — Wapuu widget (lazy bundle).
 *
 * A pocket Wapuu that lives on the desktop: he breathes, blinks,
 * follows the cursor with his eyes, twitches his ears, wags his tail,
 * and dozes off when left alone. Click him for a pet (hearts!). Built
 * on PixiJS v8 from the original-art rig.
 *
 * Ships as its own Vite target (`widget-wapuu`) — both the JS and the
 * widget's CSS leave the main `desktop.min.js` bundle. PHP registers
 * the widget via `desktop_mode_register_widget()` with the script
 * handle `desktop-mode-wapuu-widget`; the shell's widgets `server-sync`
 * loads this bundle the first time the picker renders or the widget
 * mounts. The bundle's only side effect is publishing a mount callback
 * on `window.desktopModeWidgets[ 'desktop-mode/wapuu' ]`.
 *
 * @since 0.19.0
 */

// Side-effect CSS import — Vite emits a separate `widget-wapuu[.min].css`
// chunk next to the JS. PHP eagerly enqueues that stylesheet on shell
// pages so the card chrome paints before the (lazy) JS runs.
import './styles.css';

import type { Application } from 'pixi.js';
import { __ } from '../../i18n';
import { buildWapuu } from './rig';
import { startWapuuPet } from './pet';
import type { PetController } from './pet';
import type { BallMode, WapuuChatOptions } from './pet';
import type {
	BalloonType,
	WapuuChatMessage,
	WapuuChatSession,
} from './balloons';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

/** Widget id — must match the PHP `desktop_mode_register_widget()` id. */
const WIDGET_ID = 'desktop-mode/wapuu';

/**
 * The public interface other Desktop Mode components use to send Wapuu
 * a message: `window.wp.desktop.wapuu.say( '…' )`. Published while a
 * Wapuu widget is mounted; callers guard with `wp.desktop.wapuu?.…`.
 */
export interface WapuuPublicApi {
	/** Pop a balloon. `opts.type` defaults to `'speak'`. */
	say( text: string, opts?: { type?: BalloonType; durationMs?: number } ): void;
	/** Shout — a spiky burst balloon. */
	yell( text: string, opts?: { durationMs?: number } ): void;
	/** Think — a cloud balloon. */
	think( text: string, opts?: { durationMs?: number } ): void;
	/**
	 * Ask — a chat-styled balloon: a message thread + a text box.
	 * `opts.messages` (OpenAI chat format — `role`/`content`, assistant
	 * `tool_calls`, `role: 'tool'` results) seeds the thread; `prompt`
	 * is appended as a final assistant message. Resolves with the typed
	 * reply (or `null` if cancelled). Stays open until the user
	 * submits; then lingers `opts.durationMs` (default 1800) and fades.
	 */
	ask(
		prompt: string,
		opts?: {
			durationMs?: number;
			placeholder?: string;
			messages?: WapuuChatMessage[];
		},
	): Promise< string | null >;
	/**
	 * Chat — open a PERSISTENT back-and-forth chat. Returns a session
	 * handle: read each user message via `opts.onSend`, push responses
	 * with `session.append(...)` / `session.setTyping(...)`, and keep it
	 * open until `session.close()`.
	 */
	chat( opts?: WapuuChatOptions ): WapuuChatSession;
	/** Make Wapuu do an in-place jump (squash, arc, land-bounce). */
	jump(): void;
	/** Pet Wapuu — happy squish, tail kick, hearts. */
	pet(): void;
	/** Send Wapuu to sleep (eyes close, slow breath, zZz). */
	sleep(): void;
	/** Wake Wapuu up. */
	wake(): void;
	/** What the ball button shows: the W logo or the "?" . */
	getBallMode(): BallMode;
	/** Swap the ball glyph (`'w'` | `'question'`) with the pop animation. */
	setBallMode( mode: BallMode ): void;
}

/** Balloon styles cycled on body clicks (demo only — to be removed). */
const TEST_STEPS: BalloonType[] = [ 'speak', 'yell', 'think' ];
/** Nice emojis cycled through on each click (the API test). */
const TEST_EMOJIS = [
	'👋', '🎉', '❤️', '✨', '🍕', '🚀', '⭐', '😎',
	'🥳', '💡', '🔥', '🌈', '🍩', '👀', '🌮', '🐶',
];

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

/**
 * Bridge to the main bundle's lazy module loader. Each IIFE bundle has
 * its OWN copy of `src/modules/registry.ts` — the `pixijs` module is
 * registered in the main bundle's copy (see `desktop.ts`), not ours.
 * We reach the public `wp.desktop.loadModules()` API that lives on the
 * main bundle. Mirrors the heartbeat widget's `loadPixi`.
 */
async function loadPixi(): Promise< void > {
	const wp = (
		window as unknown as {
			wp?: { desktop?: { loadModules?: ( ids: string[] ) => Promise< void > } };
		}
	).wp;
	const fn = wp?.desktop?.loadModules;
	if ( typeof fn !== 'function' ) {
		throw new Error(
			'wp.desktop.loadModules is not available — main shell may not have booted yet.',
		);
	}
	await fn( [ 'pixijs' ] );
}

function renderFallback( container: HTMLElement, message: string ): void {
	container.classList.add( 'desktop-mode-widget-wapuu' );
	container.classList.add( 'desktop-mode-widget-wapuu--fallback' );
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-widget-wapuu__fallback';
	wrap.textContent = message || __( 'Wapuu could not wake up.' );
	container.appendChild( wrap );
}

/**
 * Mount callback. The framework's widget `server-sync` reads this from
 * `window.desktopModeWidgets` after the bundle loads and pairs it with
 * the server-supplied metadata from `desktop_mode_register_widget()`.
 * Sizing constraints live on the PHP side.
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

async function mountWithPixi(
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		renderFallback( container, __( 'Wapuu could not wake up.' ) );
		return () => undefined;
	}

	container.classList.add( 'desktop-mode-widget-wapuu' );
	// Strip the card frame down to nothing — "just the pet". The class
	// lives on the card wrapper, not the body, so the stylesheet can
	// drop the glass background / border / shadow for this widget only.
	const card = container.closest< HTMLElement >( '.desktop-mode-widgets__card' );
	card?.classList.add( 'desktop-mode-widgets__card--wapuu' );
	// The card's height is owned by CSS now: a `min-height` floor on the
	// docked card keeps it from collapsing (its only flow content is an
	// absolutely-positioned stage), and it survives the framework's
	// `redock()` clearing inline geometry. Floating uses the registered
	// default size.

	const stage = document.createElement( 'div' );
	stage.className = 'desktop-mode-widget-wapuu__stage';
	container.appendChild( stage );

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );

	let controller: PetController | null = null;
	try {
		const { root, parts } = await buildWapuu( pixi );
		controller = startWapuuPet( { app, parts, root, pixi, stage, card } );
	} catch ( e ) {
		// Rig build failed (rare — denied 2D context, bad raster). Park
		// the half-built app's render loop, detach it, undo the
		// frame-stripping classes so the fallback reads on a normal
		// card, then show the message.
		stopAndDetach( app );
		stage.remove();
		container.classList.remove( 'desktop-mode-widget-wapuu' );
		card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
		renderFallback( container, ( e as Error ).message );
		return () => {
			container.classList.remove( 'desktop-mode-widget-wapuu' );
			container.classList.remove( 'desktop-mode-widget-wapuu--fallback' );
			card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
		};
	}

	// Public interface: any Desktop Mode component can send Wapuu a
	// message via `wp.desktop.wapuu`. Published while this widget is
	// mounted (callers guard with `?.`), removed on unmount.
	const api: WapuuPublicApi = {
		say: ( text, opts ) =>
			controller?.say( text, opts?.type ?? 'speak', opts?.durationMs ),
		yell: ( text, opts ) => controller?.say( text, 'yell', opts?.durationMs ),
		think: ( text, opts ) => controller?.say( text, 'think', opts?.durationMs ),
		ask: ( prompt, opts ) =>
			controller?.ask( prompt, opts ) ?? Promise.resolve( null ),
		chat: ( opts ) => {
			if ( controller ) {
				return controller.chat( opts );
			}
			// No live Wapuu — a no-op session so callers don't crash.
			const noop: WapuuChatSession = {
				append: () => undefined,
				appendMany: () => undefined,
				setTyping: () => undefined,
				clear: () => undefined,
				close: () => undefined,
			};
			return noop;
		},
		jump: () => controller?.jump(),
		pet: () => controller?.pet(),
		sleep: () => controller?.sleep(),
		wake: () => controller?.wake(),
		getBallMode: () => controller?.getBallMode() ?? 'w',
		setBallMode: ( mode ) => controller?.setBallMode( mode ),
	};
	// Publish through the framework's registerNamespace when available
	// (reserved-name guard + the documented mechanism), falling back to
	// a plain write. Capture whatever was there before: teardown RESTORES
	// it instead of blind-deleting, so a stale slow mount that resolves
	// after a newer one can't strip the live widget's API (the
	// remove-while-loading → re-add race).
	const wpDesktop = (
		window as unknown as {
			wp?: {
				desktop?: Record< string, unknown > & {
					registerNamespace?: ( name: string, value: unknown ) => void;
				};
			};
		}
	).wp?.desktop;
	const prevWapuu = wpDesktop ? wpDesktop.wapuu : undefined;
	if ( wpDesktop ) {
		if ( typeof wpDesktop.registerNamespace === 'function' ) {
			wpDesktop.registerNamespace( 'wapuu', api );
		} else {
			wpDesktop.wapuu = api;
		}
	}
	let testStep = 0;

	// Pointer wiring. The framework already attaches the whole-widget
	// drag to the chrome; for Wapuu the stylesheet stretches that chrome
	// over the ENTIRE card (a transparent overlay above the canvas), so
	// dragging anywhere on Wapuu moves the widget. A drag past the
	// framework's threshold moves the card; a press that doesn't move is
	// a pet — so the two never fight.
	const chrome =
		card?.querySelector< HTMLElement >( '.desktop-mode-widgets__chrome' ) ?? null;
	// Tap-vs-drag uses MAX displacement during the press (tracked on
	// pointermove), matching frame.ts's drag-commit threshold — a drag
	// that loops back near its origin must NOT also count as a tap.
	// frame.ts commits a drag at squared distance >= 25.
	const TAP_SLOP_SQ = 25;
	let pressing = false;
	let downX = 0;
	let downY = 0;
	let pressMaxSq = 0;
	const onChromeDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return; // primary button only — right/middle are not taps
		}
		pressing = true;
		downX = e.clientX;
		downY = e.clientY;
		pressMaxSq = 0;
	};
	const onChromeUp = ( e: PointerEvent ): void => {
		if ( e.button !== 0 || ! pressing ) {
			return;
		}
		pressing = false;
		const target = e.target as HTMLElement | null;
		// Buttons (close / re-dock) are their own controls — never a pet.
		if (
			target?.closest(
				'.desktop-mode-widgets__card-close, .desktop-mode-widgets__card-redock',
			)
		) {
			return;
		}
		const dx = e.clientX - downX;
		const dy = e.clientY - downY;
		pressMaxSq = Math.max( pressMaxSq, dx * dx + dy * dy );
		if ( pressMaxSq >= TAP_SLOP_SQ || ! controller ) {
			return; // it was (also) a drag — never a tap
		}
		const hit = controller.getClickTarget( e.clientX, e.clientY );
		if ( hit === 'ball' ) {
			// The WordPress ball is the HELP BUTTON — the core entry.
			// One tap: the W flips to "?" and the chat opens; tapping the
			// "?" (or Escape / backdrop) closes it and restores the W.
			handleBallTap();
		} else if ( hit === 'body' ) {
			// Body tap: pet. The balloon-style demo cycle is SKIPPED
			// while a chat is open — say() replaces the active balloon,
			// which would silently destroy the conversation.
			controller.pet();
			if ( ! ballChat ) {
				const step = TEST_STEPS[ testStep % TEST_STEPS.length ];
				const emoji = TEST_EMOJIS[ testStep % TEST_EMOJIS.length ];
				testStep += 1;
				api.say( emoji, { type: step } );
			}
		}
	};

	// Live chat opened from the ball — one at a time. ONE click does it
	// all: the W flips to "?" (the "help is active" state) AND the chat
	// opens immediately — no second tap needed. Tapping the "?" (or
	// Escape) closes the chat and restores the W.
	let ballChat: WapuuChatSession | null = null;
	const handleBallTap = (): void => {
		if ( ! controller ) {
			return;
		}
		if ( ballChat ) {
			ballChat.close(); // onClose restores the W
			return;
		}
		controller.setBallMode( 'question' );
		const session = api.chat( {
			placeholder: __( 'Ask Wapuu anything…' ),
			messages: [
				{ role: 'assistant', content: __( 'Hi! 👋 How can I help?' ) },
			],
			onSend: ( text ) => {
				// Demo responder — echoes after a "typing…" beat. The real
				// integration will route this to the AI copilot.
				session.setTyping( true );
				window.setTimeout( () => {
					session.setTyping( false );
					session.append( {
						role: 'assistant',
						content: `You said: "${ text }" 🐶`,
					} );
				}, 900 );
			},
			onClose: () => {
				ballChat = null;
				controller?.setBallMode( 'w' );
			},
		} );
		ballChat = session;
	};
	// Hover cue: over the ball the cursor flips to a pointer and the
	// W/? scales up slightly — the ball reads as a clickable button.
	// While pressed, this same stream tracks the press's MAX displacement
	// for the tap-vs-drag decision in onChromeUp.
	const onChromeHover = ( e: PointerEvent ): void => {
		if ( pressing ) {
			const dx = e.clientX - downX;
			const dy = e.clientY - downY;
			pressMaxSq = Math.max( pressMaxSq, dx * dx + dy * dy );
		}
		const overBall =
			controller?.getClickTarget( e.clientX, e.clientY ) === 'ball';
		controller?.setBallHover( overBall );
		if ( chrome ) {
			chrome.style.cursor = overBall ? 'pointer' : '';
		}
	};
	const onChromeLeave = (): void => {
		controller?.setBallHover( false );
		if ( chrome ) {
			chrome.style.cursor = '';
		}
	};
	if ( chrome ) {
		chrome.addEventListener( 'pointerdown', onChromeDown );
		chrome.addEventListener( 'pointerup', onChromeUp );
		chrome.addEventListener( 'pointermove', onChromeHover );
		chrome.addEventListener( 'pointerleave', onChromeLeave );
	}

	// Eye-look tracks the cursor ANYWHERE on screen (like the original
	// full-screen pet), so we listen on the document, not just over the
	// card. `setPointer` also wakes Wapuu, so he only dozes off once the
	// mouse goes still — "leave him be" — not the instant it leaves the
	// widget.
	const onDocPointerMove = ( e: PointerEvent ): void =>
		controller?.setPointer( e.clientX, e.clientY );
	document.addEventListener( 'pointermove', onDocPointerMove, { passive: true } );

	// First-run hint: once per user (persisted via the widget storage),
	// Wapuu pops a little speak balloon pointing out the ball button.
	let hintHandle: number | undefined;
	if ( ! ctx.storage.get< boolean >( 'ballHintShown' ) ) {
		ctx.storage.set( 'ballHintShown', true );
		hintHandle = window.setTimeout( () => {
			api.say( __( 'Click my ball to chat! 💬' ), { durationMs: 4500 } );
		}, 1400 );
	}

	return () => {
		window.clearTimeout( hintHandle );
		document.removeEventListener( 'pointermove', onDocPointerMove );
		if ( chrome ) {
			chrome.removeEventListener( 'pointerdown', onChromeDown );
			chrome.removeEventListener( 'pointerup', onChromeUp );
			chrome.removeEventListener( 'pointermove', onChromeHover );
			chrome.removeEventListener( 'pointerleave', onChromeLeave );
			chrome.style.cursor = '';
		}
		// Withdraw the public interface — only if it's still ours, and by
		// RESTORING the previous value: if a newer mount published its API
		// while this (stale) one was still loading, the newer API is the
		// previous value and survives this teardown.
		if ( wpDesktop && wpDesktop.wapuu === api ) {
			if ( prevWapuu !== undefined ) {
				wpDesktop.wapuu = prevWapuu;
			} else {
				delete wpDesktop.wapuu;
			}
		}
		controller?.destroy();
		stopAndDetach( app );
		container.classList.remove( 'desktop-mode-widget-wapuu' );
		card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
	};
}

/**
 * Park a PixiJS Application and detach its canvas WITHOUT calling
 * `app.destroy()`. We avoid `destroy()` because it triggers a known
 * Pixi v8 multi-Application batcher race that corrupts any other live
 * app on the page (Content Graph, the heartbeat widget, …). But the
 * Application's auto-started render ticker keeps re-rendering the
 * detached scene every frame unless we stop it first — so we
 * `ticker.stop()` (parking the render loop), then remove the canvas
 * and let GC reclaim once references drop. Matches the teardown in
 * `posts-window/categories-mindmap.ts` and `tags-cloud.ts`.
 */
function stopAndDetach( app: Application ): void {
	try {
		app.ticker?.stop();
	} catch {
		// Best-effort.
	}
	try {
		( app as unknown as { canvas?: { remove(): void } } ).canvas?.remove();
	} catch {
		// Best-effort.
	}
}

// Side-effect: publish on the framework's well-known global so
// `widgets/server-sync.ts` pairs us with the PHP-side def.
const w = window as unknown as {
	desktopModeWidgets?: Record<
		string,
		(
			container: HTMLElement,
			ctx: WidgetContext,
		) => WidgetTeardown | Promise< WidgetTeardown >
	>;
};
w.desktopModeWidgets = w.desktopModeWidgets || {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
