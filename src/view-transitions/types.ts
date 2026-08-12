/**
 * OpenStation — View-transition types.
 *
 * A "view transition" here is a whole-surface animation played through
 * the browser's **View Transitions API** while the shell mutates its
 * own DOM: flipping to another virtual desktop, maximizing a window,
 * swapping the wallpaper. The browser snapshots the surface before and
 * after the mutation and cross-fades the two; a def says how those two
 * snapshots should move past each other instead.
 *
 * ## Why this is a registry and not a pile of `if`s
 *
 * Every def compiles down to exactly one thing at runtime: a **view
 * transition type** activated for the duration of the run. The engine
 * never writes a keyframe, never reads a def's CSS, and never touches
 * the pseudo-elements. It starts the transition with
 * `{ types: [ 'os-vt-cube' ] }` and the stylesheet does the rest
 * through `:active-view-transition-type()`.
 *
 * That split is the whole design. It means:
 *
 * - A plugin ships a transition as **CSS alone** — register a def with
 *   an id, write `html:active-view-transition-type( os-vt-<id> )` rules
 *   in your own stylesheet, done. No JS animation code, no `Animation`
 *   objects to tear down, no timing to keep in sync with the shell.
 * - Types stack, so a def's own type rides alongside the **context**
 *   types the shell adds (`os-vt-forward`, `os-vt-desktop`, …). A
 *   direction-aware transition reads the context type; one that does
 *   not care simply ignores it and plays the same either way.
 * - Nothing has to be un-done. Types are scoped to the transition's
 *   lifetime by the browser, so a transition that is skipped, aborted,
 *   or interrupted mid-flight leaves no state behind — the failure mode
 *   that class-toggling animation systems spend most of their code on.
 *
 * ## Scope: root vs element
 *
 * A root transition snapshots the whole document, which is right for a
 * desktop switch — everything on screen is changing at once. It is
 * wrong for one window maximizing, because it freezes the entire shell
 * to animate a corner of it.
 *
 * `scope: 'element'` uses **element-scoped view transitions**
 * (`element.startViewTransition()`), which confine the whole mechanism
 * to one subtree: only that element is snapshotted, only its
 * descendants can take part, and the rest of the desktop keeps
 * painting and keeps accepting input. Where the API is missing the
 * engine falls back to a root transition carrying the same types, so a
 * def never has to care which it got.
 */

/**
 * Where the browser draws the snapshot boundary for a transition.
 *
 * - `'root'` — the whole document. Use when the change is the screen.
 * - `'element'` — one subtree, via `element.startViewTransition()`.
 *   Use when the change is one window and the desk around it should
 *   stay live. Degrades to `'root'` on engines without it.
 */
export type ViewTransitionScope = 'root' | 'element';

/**
 * A hint about which way the change is travelling, turned into a
 * context type the CSS can read (`os-vt-forward` / `os-vt-backward`).
 *
 * Direction is deliberately NOT part of a def. The same transition
 * plays both ways round — the caller knows whether the user went to
 * the next desktop or the previous one, and the def only has to say
 * what "forward" looks like and let the stylesheet mirror it.
 */
export type ViewTransitionDirection = 'forward' | 'backward' | 'none';

export interface ViewTransitionDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/` — lower-case alphanum plus
	 * hyphen, underscore, and slash so plugins can namespace
	 * `vendor/sub-id`, the same convention every other JS registry in
	 * the shell uses (`registerCommand`, `registerWindowReveal`, …).
	 *
	 * The id becomes the view-transition **type** the engine activates,
	 * prefixed and slash-flattened: `acme/warp` → `os-vt-acme-warp`.
	 * Use {@link viewTransitionTypeFor} rather than composing that
	 * string by hand.
	 */
	id: string;
	/** Human-readable label shown in the OpenStation Preferences selector. */
	label: string;
	/** Optional one-line description shown under the selector. */
	description?: string;
	/**
	 * Preferred snapshot boundary. Defaults to `'root'`.
	 *
	 * A def declares its preference; the CALLER declares what it is
	 * animating. When a caller passes an element and the def asks for
	 * `'element'`, the transition is scoped to that element — otherwise
	 * it runs at the root. A def that only makes sense across the whole
	 * screen (a cube rotation) should leave this at `'root'` so it is
	 * never confined to a single window.
	 */
	scope?: ViewTransitionScope;
	/**
	 * How long the transition runs, in ms. Surfaced to CSS as
	 * `--os-vt-duration` on the document element for the duration of
	 * the run, so a def's stylesheet can size its keyframes off it
	 * rather than hard-coding a number that the user's speed override
	 * would then contradict.
	 *
	 * Defaults to `DEFAULT_VT_DURATION_MS`. Clamped to 80–4000 ms:
	 * below that it is a flicker, above it the user is waiting for an
	 * animation rather than using their desktop.
	 */
	duration?: number;
	/**
	 * CSS easing, surfaced as `--os-vt-easing`. Defaults to
	 * `DEFAULT_VT_EASING`.
	 */
	easing?: string;
	/**
	 * Extra view-transition types to activate alongside the def's own.
	 *
	 * The escape hatch for a family of transitions that share a chunk
	 * of CSS: give each variant its own id and have them all declare a
	 * common type, then write the shared rules once against that.
	 * `cube` and `fold` both declare `os-vt-3d`, which is where the
	 * perspective and `transform-style` live.
	 */
	types?: string[];
	/**
	 * Whether the def wants the pointer position published as
	 * `--os-vt-x` / `--os-vt-y` (in px, relative to the viewport) for
	 * the run.
	 *
	 * Only the transitions that grow or collapse around a point need
	 * it — `ripple` and `iris` originate at whatever the user just
	 * clicked, which is the entire reason they feel causal rather than
	 * decorative. The engine falls back to the viewport centre when no
	 * pointer position is known.
	 */
	usesPointer?: boolean;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * transition. Set this when plugin deactivation should
	 * live-unregister it (mirrors commands / settings tabs / unfocus
	 * effects). Transitions without an owner survive until the next
	 * reload.
	 */
	owner?: string;
}

/** What the shell hands the engine to play one transition. */
export interface PlayViewTransitionOptions {
	/**
	 * The DOM mutation to animate. May be async — the browser holds
	 * the "old" snapshot on screen until it settles, so an update that
	 * awaits a fetch shows a frozen surface rather than a half-built
	 * one. Keep it short for exactly that reason.
	 */
	update: () => void | Promise< void >;
	/**
	 * Which of the user's two selections to use — `'root'` for a
	 * whole-screen change, `'element'` for a change to one window.
	 * Defaults to `'root'`.
	 *
	 * This is the CALLER describing what it is animating, which is a
	 * different thing from a def's own `scope` (what a transition is
	 * capable of animating). They have to agree for anything to play.
	 */
	family?: ViewTransitionScope;
	/**
	 * Transition id to play. Defaults to the user's active selection
	 * for {@link family}. Pass an explicit id for a preview, or for a
	 * surface that always wants a particular motion regardless of
	 * preference.
	 */
	id?: string;
	/**
	 * Context types added on top of the def's own — the caller's
	 * description of WHAT changed (`os-vt-desktop`, `os-vt-window`).
	 * A def's CSS can key off these to behave differently per surface
	 * without the caller knowing anything about the def.
	 */
	types?: string[];
	/** Direction hint, published as a context type. Default `'none'`. */
	direction?: ViewTransitionDirection;
	/**
	 * Subtree to confine the transition to. Only honoured when the
	 * resolved def asks for `scope: 'element'` AND the engine supports
	 * element-scoped transitions; otherwise the transition runs at the
	 * root and this is ignored.
	 */
	scopeElement?: Element | null;
	/**
	 * Pointer position the transition should originate from, in
	 * viewport px. Defaults to the last pointer position the engine
	 * saw, and to the viewport centre before the user has moved a
	 * pointer at all (keyboard-driven runs).
	 */
	origin?: { x: number; y: number } | null;
	/**
	 * Pair two elements so the browser animates one INTO the other.
	 *
	 * This is the mechanism behind "the icon becomes the window". Give
	 * the source element and the destination element the same
	 * `view-transition-name` across the mutation and the browser stops
	 * treating them as two things that appeared and disappeared: it
	 * treats them as ONE thing that moved, and interpolates position,
	 * size and corner radius between them. No path to compute, no
	 * `getBoundingClientRect()` maths, no ghost element following the
	 * pointer.
	 *
	 * The two sides are supplied differently on purpose. `from` is an
	 * element that exists NOW, before the mutation. `to` is a
	 * *callback*, because the destination usually does not exist yet —
	 * the window this is morphing into is created by the very update
	 * this option decorates.
	 *
	 * The engine also has to REMOVE the name from `from` as part of the
	 * update, not merely add it to `to`: a dock tile does not disappear
	 * when you open its window, and two live elements sharing one
	 * `view-transition-name` is an error the browser resolves by
	 * skipping the transition outright.
	 */
	morph?: {
		/** Element the transition should appear to start from. */
		from?: Element | null;
		/**
		 * Resolves the destination, called right after `update` — so
		 * it can return an element that update itself created. Return
		 * `null` to abandon the pairing (the transition still plays,
		 * just without a morph).
		 */
		to?: () => Element | null | undefined;
	};
	/**
	 * What to do when a transition is ALREADY running.
	 *
	 * - `'skip'` (default) — finish the running one immediately, then
	 *   start this one. Right for user-driven changes: holding the
	 *   desktop-switch shortcut should track the key repeat, not queue
	 *   up a second of animation per press.
	 * - `'drop'` — run `update()` with no animation at all. Right for
	 *   background changes that must land but must not fight for the
	 *   screen.
	 */
	whenBusy?: 'skip' | 'drop';
}

/** What a play call reports back. */
export interface ViewTransitionResult {
	/** Whether a real view transition was started. */
	animated: boolean;
	/**
	 * Why it was not, when `animated` is false — feature detection,
	 * reduced motion, `'none'` selected, or a busy transition under
	 * `whenBusy: 'drop'`. `null` when it did animate.
	 */
	reason:
		| 'unsupported'
		| 'reduced-motion'
		| 'none-selected'
		| 'busy'
		| 'failed'
		| null;
}
