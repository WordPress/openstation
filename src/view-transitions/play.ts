/**
 * OpenStation — View-transition player.
 *
 * The one function that actually talks to the View Transitions API.
 * Everything else in this folder describes transitions; this decides
 * whether one can run, starts it, publishes the values its CSS reads,
 * and cleans up after.
 *
 * ## The four capability tiers
 *
 * Support for this API arrived in pieces, and a shell that only worked
 * on the newest tier would animate for almost nobody. So the player
 * probes four things independently and degrades one step at a time:
 *
 * 1. **Same-document transitions** (`document.startViewTransition`) —
 *    without it nothing animates and `update()` just runs. Every caller
 *    is written so that this is a correct outcome, not a broken one.
 * 2. **View-transition types** (`{ update, types }` +
 *    `:active-view-transition-type()`) — the mechanism the whole
 *    registry is built on. Without it the player falls back to a
 *    `data-os-vt` attribute on the document element carrying the same
 *    id, and the stylesheet matches on either. That fallback is why the
 *    built-ins work on engines a year older than types are.
 * 3. **Element-scoped transitions** (`element.startViewTransition`) —
 *    without it a `scope: 'element'` def runs at the root instead,
 *    carrying identical types, so it still plays.
 * 4. **`document.activeViewTransition`** — without it the player cannot
 *    see a transition already in flight and simply starts anyway; the
 *    browser skips the older one itself, which is the same outcome one
 *    frame later.
 *
 * ## What the player publishes
 *
 * A def is CSS, so everything the CSS needs has to be a custom property
 * by the time the first frame renders. The player sets them on the
 * document element BEFORE calling `startViewTransition` — the browser
 * reads style for the pseudo-elements after the update callback, but
 * setting them early means an author never has to reason about which
 * side of the snapshot a property landed on:
 *
 * | Property           | What it carries                              |
 * | ------------------ | -------------------------------------------- |
 * | `--os-vt-duration` | resolved duration, e.g. `420ms`              |
 * | `--os-vt-easing`   | resolved easing                              |
 * | `--os-vt-x` / `-y` | pointer origin in px, for the shaped wipes   |
 *
 * They are removed when the transition settles. A transition that is
 * skipped or throws still settles, so there is no path that leaks them.
 */

import {
	clampVtDuration,
	DEFAULT_VT_EASING,
	getViewTransition,
	VIEW_TRANSITION_NONE,
	viewTransitionTypeFor,
} from './registry';
import type {
	PlayViewTransitionOptions,
	ViewTransitionResult,
} from './types';

/**
 * The slice of the View Transitions API this module uses, typed
 * structurally because the DOM lib in the repo's TS version predates
 * types, element-scoped transitions, and `activeViewTransition`.
 */
interface ViewTransitionLike {
	finished?: Promise< unknown >;
	ready?: Promise< unknown >;
	updateCallbackDone?: Promise< unknown >;
	skipTransition?: () => void;
	types?: Set< string >;
}

type StartFn = (
	arg: ( () => void | Promise< void > ) | Record< string, unknown >,
) => ViewTransitionLike;

/**
 * The extras, reached by cast rather than by `extends Document`.
 *
 * The repo's DOM lib already declares `startViewTransition` with the
 * older, narrower signature (no `types`, returns a fully-typed
 * `ViewTransition`), so an interface extending `Document` cannot
 * redeclare it — TS rejects the widening outright. Casting sideways to
 * a structural type keeps this module honest about what it actually
 * probes for at runtime, which is the point: every one of these is
 * optional because every one of them is genuinely missing somewhere.
 */
interface VtDocumentExtras {
	startViewTransition?: StartFn;
	activeViewTransition?: ViewTransitionLike | null;
}

interface VtElementExtras {
	startViewTransition?: StartFn;
}

function docVt(): VtDocumentExtras {
	return document as unknown as VtDocumentExtras;
}

/** Attribute mirroring the active transition id for engines without types. */
export const VT_FALLBACK_ATTR = 'data-os-vt';

/**
 * Palette values the transition pseudo-tree needs, and the `--os-vt-*`
 * name each is republished under.
 *
 * The pseudo-tree inherits from the ROOT element, and the station's
 * palette is deliberately scoped to `body.os-active` so it can never
 * repaint a real `wp-admin` page inside a window (AGENTS.md → "The
 * palette lives in variables.css"). Those two facts mean a transition
 * cannot read a brand token, however correctly it is declared.
 *
 * Copying the RESOLVED values up to the root is the fix that keeps both
 * halves true: `variables.css` remains the one owner of the palette,
 * desktop themes still re-point these names and still win, and nothing
 * new is declared at `:root` for a chromeless document to inherit. The
 * dock-peek popover solves the same inheritance problem the same way
 * (`inheritShellSchemeVars`).
 *
 * Read fresh on every run rather than cached at boot, so a theme change
 * or an accent change is reflected by the very next transition.
 */
const BRIDGED_TOKENS: ReadonlyArray< readonly [ string, string ] > = [
	[ '--os-mesh-holo', '--os-vt-mesh' ],
	[ '--os-ui-accent-dim', '--os-vt-accent' ],
	[ '--os-ui-surface', '--os-vt-surface' ],
];

/**
 * Republish the palette values the stylesheet reads onto the document
 * element. Returns the names written, so cleanup removes exactly those.
 *
 * @param root Document element.
 * @return     Custom-property names that were set.
 */
function bridgePaletteTokens( root: HTMLElement ): string[] {
	const source = document.body;
	if ( ! source ) {
		return [];
	}
	const computed = window.getComputedStyle( source );
	const written: string[] = [];
	for ( const [ from, to ] of BRIDGED_TOKENS ) {
		const value = computed.getPropertyValue( from ).trim();
		if ( value ) {
			root.style.setProperty( to, value );
			written.push( to );
		}
	}
	return written;
}

/**
 * Last pointer position seen, in viewport px. Seeded to the viewport
 * centre so a keyboard-driven transition still has a sane origin — the
 * shaped wipes look wrong, not absent, when handed `0,0`.
 */
let lastPointer: { x: number; y: number } | null = null;

/**
 * The element under the last pointer press.
 *
 * This is what lets a window appear to grow out of the icon that
 * launched it WITHOUT a single call site passing an element down. Every
 * launcher in the shell — a dock tile, a wallpaper icon, a taskbar
 * entry, a command-palette result, a file tile, a plugin's own button —
 * ends up here for free, because all of them are things the user
 * pressed. Threading a source element through `open()` instead would
 * mean touching every caller and would still miss the ones a plugin
 * adds later.
 */
let lastPointerEl: Element | null = null;

let pointerTracked = false;

/** Counter behind the unique `view-transition-name` a morph pair shares. */
let morphSeq = 0;

/**
 * Start recording pointer position and target for the shaped and
 * morphing transitions. Idempotent; called from the engine's boot.
 *
 * `pointerdown` rather than `pointermove`: the origin that reads as
 * causal is where the user COMMITTED, not where the cursor happened to
 * drift afterwards. A dock click followed by the cursor sliding two
 * tiles over should still ripple from the tile that was clicked.
 *
 * Capture phase, so a launcher that calls `stopPropagation()` on its
 * own handler is still recorded.
 */
export function trackViewTransitionOrigin(): void {
	if ( pointerTracked || typeof document === 'undefined' ) {
		return;
	}
	pointerTracked = true;
	document.addEventListener(
		'pointerdown',
		( e: PointerEvent ) => {
			lastPointer = { x: e.clientX, y: e.clientY };
			lastPointerEl =
				e.target instanceof Element ? e.target : null;
		},
		{ capture: true, passive: true },
	);
}

/**
 * The element the user last pressed, if it is still in the document.
 *
 * The connectivity check is the whole value of this accessor: a tile
 * that was clicked and then re-rendered (which the dock does on almost
 * every state change) is a detached node, and pairing a transition to a
 * detached node produces a morph that starts from nowhere.
 */
export function getLastPointerElement(): Element | null {
	return lastPointerEl?.isConnected ? lastPointerEl : null;
}

/** The origin a shaped transition should use when the caller gave none. */
function resolveOrigin(
	explicit: { x: number; y: number } | null | undefined,
): { x: number; y: number } {
	if (
		explicit &&
		Number.isFinite( explicit.x ) &&
		Number.isFinite( explicit.y )
	) {
		return explicit;
	}
	if ( lastPointer ) {
		return lastPointer;
	}
	return {
		x: ( window.innerWidth || 0 ) / 2,
		y: ( window.innerHeight || 0 ) / 2,
	};
}

/** Does this engine have same-document view transitions at all? */
export function supportsViewTransitions(): boolean {
	return (
		typeof document !== 'undefined' &&
		typeof docVt().startViewTransition === 'function'
	);
}

/**
 * Does this engine understand view-transition **types**?
 *
 * Probed through the selector rather than by feature-sniffing the
 * `startViewTransition` signature, because the object form is accepted
 * by engines that then ignore `types` — and a silently ignored type is
 * indistinguishable at runtime from a stylesheet that forgot to match
 * it. If the selector parses, the types reached the cascade.
 */
export function supportsViewTransitionTypes(): boolean {
	return (
		typeof CSS !== 'undefined' &&
		typeof CSS.supports === 'function' &&
		CSS.supports( 'selector(:active-view-transition-type(os-vt-probe))' )
	);
}

/** Does this engine have element-scoped view transitions? */
export function supportsElementViewTransitions(): boolean {
	return (
		typeof Element !== 'undefined' &&
		'startViewTransition' in Element.prototype
	);
}

/** The transition currently in flight, where the engine exposes it. */
export function getActiveViewTransition(): ViewTransitionLike | null {
	if ( typeof document === 'undefined' ) {
		return null;
	}
	return docVt().activeViewTransition ?? null;
}

/** Whether the user has asked for reduced motion. */
function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches
	);
}

/**
 * Run `update()` with no animation and report why.
 *
 * @param update Caller's mutation.
 * @param reason What stopped the animation.
 * @return       A settled result.
 */
async function runBare(
	update: () => void | Promise< void >,
	reason: ViewTransitionResult[ 'reason' ],
): Promise< ViewTransitionResult > {
	await update();
	return { animated: false, reason };
}

/**
 * Play a view transition around a DOM mutation.
 *
 * Always runs `update()` exactly once, animated or not — a caller
 * never has to branch on support, and a state change never goes
 * missing because a browser was old or the user asked for less motion.
 *
 * @param opts          What to change, and how it should look.
 * @param activeId      The user's current selection, used when
 *                      `opts.id` is omitted.
 * @param speedOverride Global speed override in ms, or `0` for
 *                      per-transition timing.
 * @return            Whether it animated, and why not if it did not.
 */
export async function playViewTransition(
	opts: PlayViewTransitionOptions,
	activeId: string,
	speedOverride = 0,
): Promise< ViewTransitionResult > {
	const { update } = opts;
	const id = opts.id ?? activeId;

	if ( ! id || id === VIEW_TRANSITION_NONE ) {
		return runBare( update, 'none-selected' );
	}
	if ( ! supportsViewTransitions() ) {
		return runBare( update, 'unsupported' );
	}
	if ( prefersReducedMotion() ) {
		// Deliberately total: unlike a window reveal — which is one
		// element wiping away and can be shortened into a fade — a view
		// transition moves the ENTIRE surface the user is reading. There
		// is no reduced version of that which is still the transition.
		return runBare( update, 'reduced-motion' );
	}

	const def = getViewTransition( id );
	if ( ! def ) {
		// An unknown id degrades to "no transition" rather than to a
		// built-in: silently substituting a different animation would be
		// a stranger outcome than none at all. Happens whenever a
		// plugin's transition is still named in user meta after the
		// plugin is gone.
		return runBare( update, 'none-selected' );
	}

	// A transition already in flight. Skipping it lands it on its final
	// frame immediately, which is what a user holding a shortcut key
	// wants; queueing would make the desktop lag a keypress behind.
	const active = getActiveViewTransition();
	if ( active ) {
		if ( opts.whenBusy === 'drop' ) {
			return runBare( update, 'busy' );
		}
		active.skipTransition?.();
	}

	const root = document.documentElement;
	const duration =
		speedOverride > 0 ? speedOverride : clampVtDuration( def.duration );
	const easing = def.easing ?? DEFAULT_VT_EASING;

	root.style.setProperty( '--os-vt-duration', `${ duration }ms` );
	root.style.setProperty( '--os-vt-easing', easing );
	const bridged = bridgePaletteTokens( root );
	if ( def.usesPointer ) {
		const origin = resolveOrigin( opts.origin );
		root.style.setProperty( '--os-vt-x', `${ origin.x }px` );
		root.style.setProperty( '--os-vt-y', `${ origin.y }px` );
	}

	// `os-vt-on` rides along on every run. The stylesheet needs ONE
	// selector for the setup every transition shares — resetting the UA
	// crossfade, taking the pseudo-elements off `plus-lighter`, binding
	// the duration — and without a universal type that setup would have
	// to list all two dozen ids and grow a line per plugin transition,
	// which no plugin author could add to.
	const types = [
		'os-vt-on',
		viewTransitionTypeFor( def.id ),
		...( def.types ?? [] ),
		...( opts.types ?? [] ),
	];
	if ( opts.direction === 'forward' ) {
		types.push( 'os-vt-forward' );
	} else if ( opts.direction === 'backward' ) {
		types.push( 'os-vt-backward' );
	}

	const hasTypes = supportsViewTransitionTypes();
	if ( ! hasTypes ) {
		// Types are how a def's CSS finds its own transition. Without
		// them, mirror the id onto the document element so the
		// stylesheet's parallel `[data-os-vt="…"]` selectors match
		// instead. Context types (direction, surface) are lost in this
		// mode — a direction-aware transition plays its forward form
		// both ways, which is a smaller loss than not playing.
		root.setAttribute( VT_FALLBACK_ATTR, def.id );
	}

	// Element pairing. The name has to be on `from` before the browser
	// takes its "old" snapshot and on `to` before it takes the "new"
	// one, with NEITHER carrying it at the same moment — so the handover
	// happens inside the update callback, between the two captures.
	const morphName = `os-vt-morph-${ ++morphSeq }`;
	const morphFrom =
		opts.morph?.from instanceof HTMLElement ? opts.morph.from : null;
	let morphTo: HTMLElement | null = null;
	// Both sides also get `view-transition-class: os-vt-morph`, which is
	// how the stylesheet says "the thing this transition is ABOUT".
	// Without it a window-family rule would have to target
	// `.os-vt-card` — the class every open window carries — and could
	// not tell the one that is opening from the eight that are merely
	// on screen while it does.
	const tag = ( el: HTMLElement ): void => {
		el.style.setProperty( 'view-transition-name', morphName );
		el.style.setProperty( 'view-transition-class', 'os-vt-morph' );
	};
	const untag = ( el: HTMLElement ): void => {
		el.style.removeProperty( 'view-transition-name' );
		el.style.removeProperty( 'view-transition-class' );
	};
	if ( morphFrom ) {
		tag( morphFrom );
	}
	const wrappedUpdate = async (): Promise< void > => {
		await update();
		// The handover has to be a swap, not an add: a dock tile does
		// not disappear when you open its window, and two live elements
		// sharing one `view-transition-name` makes the browser skip the
		// transition outright.
		if ( morphFrom ) {
			untag( morphFrom );
		}
		const target = opts.morph?.to?.();
		if ( target instanceof HTMLElement ) {
			morphTo = target;
			tag( morphTo );
		}
	};

	const cleanup = (): void => {
		root.style.removeProperty( '--os-vt-duration' );
		root.style.removeProperty( '--os-vt-easing' );
		root.style.removeProperty( '--os-vt-x' );
		root.style.removeProperty( '--os-vt-y' );
		bridged.forEach( ( name ) => root.style.removeProperty( name ) );
		// Both sides, unconditionally. The `from` tag is normally
		// dropped in the update above, but a transition that fails
		// before the callback ever runs would otherwise strand it — and
		// a stranded `view-transition-name` silently breaks the NEXT
		// transition, which is the worst kind of leak to debug.
		if ( morphFrom ) {
			untag( morphFrom );
		}
		if ( morphTo ) {
			untag( morphTo );
		}
		if ( ! hasTypes ) {
			root.removeAttribute( VT_FALLBACK_ATTR );
		}
	};

	// Element-scoped when the def asks for it, the caller supplied a
	// subtree, and the engine has it. Any one missing and we run at the
	// root with the same types — the def still plays, it just freezes
	// more of the screen than it needed to.
	const scopeEl =
		def.scope === 'element' &&
		opts.scopeElement &&
		supportsElementViewTransitions()
			? ( opts.scopeElement as unknown as VtElementExtras )
			: null;
	const start: StartFn | undefined = scopeEl
		? scopeEl.startViewTransition?.bind( scopeEl )
		: docVt().startViewTransition?.bind( document );

	if ( ! start ) {
		cleanup();
		return runBare( update, 'unsupported' );
	}

	let transition: ViewTransitionLike;
	try {
		transition = hasTypes
			? start( { update: wrappedUpdate, types } )
			: start( wrappedUpdate );
	} catch {
		// An engine that rejects the object form outright, or a scoped
		// call on a detached element. Neither is worth losing the state
		// change over.
		cleanup();
		return runBare( update, 'failed' );
	}

	try {
		await transition.finished;
	} catch {
		// `finished` rejects when the update callback threw. The
		// callback is the caller's own code and its error is theirs to
		// see; swallowing it here would only hide it behind an
		// unhandled rejection from an animation helper.
	} finally {
		cleanup();
	}

	return { animated: true, reason: null };
}
