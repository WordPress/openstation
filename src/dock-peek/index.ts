/**
 * Desktop Mode — Dock Peek.
 *
 * On pointerenter of a multi-capable dock tile that has at least one
 * open window, fan out a stack of "peek cards" anchored to the tile:
 *   - One card per open instance (click → focus that window).
 *   - A trailing "Ghost Card" with a dashed outline + breathing pulse
 *     (click → spawn a fresh instance via `windowManager.openNew()`).
 *
 * The peek replaces the legacy "+" chip on multi-instance dock items.
 * Visible affordance, no keyboard required — the Ghost Card visually
 * announces itself as a slot for "something that doesn't exist yet."
 *
 * Pointer-only: touch devices skip the peek and fall back to plain
 * tap-to-focus / tap-to-open. Hover popovers don't translate to touch
 * cleanly, and Phase 5–6 is where the mobile shell takes over.
 *
 * @since 0.6.2
 */

import { __, sprintf } from '../i18n';
import type { WindowManager } from '../window-manager';
import type { Window as WPWindow } from '../window';
import type { DockOrientation } from '../dock';
import { sanitizeClassName } from '../utils';
import { hashTitleToHue } from '../ui/util/hash-hue';
import { applyFilters, HOOKS } from '../hooks';

/**
 * Detail passed to the {@link HOOKS.DOCK_PEEK_CARD_CONTENT} filter.
 * Plugins receive this alongside the default body element so they
 * can render a custom thumbnail / status / arbitrary HTML in place
 * of (or in addition to) the default ghosted-lines mini-window body.
 */
export interface DockPeekCardContext {
	/** The live window this card represents. */
	window: WPWindow;
	/** The dock item descriptor — id / title / icon / url. */
	item: { id: string; title: string; icon: string; url: string };
}

/** Args needed to attach a peek to one dock tile. */
export interface DockPeekDeps {
	tile: HTMLElement;
	item: {
		id: string;
		title: string;
		icon: string;
		url: string;
	};
	/**
	 * Returns the live windows the peek should render cards for.
	 * Decoupled from any specific lookup rule so the peek works for
	 * both menu-derived multi tiles (where the dock looks up by URL-
	 * derived `baseId`) and system tiles like native windows (where
	 * the lookup is just `getById(item.id)`).
	 */
	getInstances: () => WPWindow[];
	/**
	 * Whether to render the trailing Ghost Card (the "open new"
	 * affordance). Defaults to `true`. Pass `false` for tiles whose
	 * window is a singleton — native windows for OS Settings,
	 * Jorvy, etc. — where spawning a second copy is meaningless.
	 */
	enableGhost?: boolean;
	windowManager: WindowManager;
	getOrientation: () => DockOrientation;
	/**
	 * Spawn a fresh instance for this tile. Owned by the dock so the
	 * peek doesn't have to re-derive `baseId` or reach back into the
	 * Dock's URL helpers. Ignored when `enableGhost` is `false`.
	 */
	openNew: () => void;
	/**
	 * The tile's resolved tooltip element (shared across the dock).
	 * Suppressed while the peek is visible so we don't stack two
	 * hover surfaces.
	 */
	suppressTooltip: ( on: boolean ) => void;
}

/** How long pointerenter must dwell before the peek shows. */
const SHOW_DELAY_MS = 180;
/** How long pointerleave must dwell before the peek hides. */
const HIDE_DELAY_MS = 220;
/** Stagger between cards in the fan-out (ms). */
const STAGGER_MS = 32;

/**
 * Attach hover-peek behavior to a dock tile. Returns a teardown
 * function that detaches every listener and removes the popover.
 */
export function attachDockPeek( deps: DockPeekDeps ): () => void {
	const { tile } = deps;

	let popover: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;
	let inside = false;

	const cancelShow = (): void => {
		if ( showTimer !== null ) {
			window.clearTimeout( showTimer );
			showTimer = null;
		}
	};
	const cancelHide = (): void => {
		if ( hideTimer !== null ) {
			window.clearTimeout( hideTimer );
			hideTimer = null;
		}
	};

	const tearDown = (): void => {
		cancelShow();
		cancelHide();
		if ( popover ) {
			popover.remove();
			popover = null;
		}
		deps.suppressTooltip( false );
	};

	const onPointerEnterTile = ( e: PointerEvent ): void => {
		// Touch / pen → no peek. Mobile shell owns these gestures.
		if ( e.pointerType !== 'mouse' ) {
			return;
		}
		// Re-evaluate on every enter — open windows might have changed
		// since the tile was constructed.
		if ( ! shouldShowPeek( deps ) ) {
			return;
		}
		inside = true;
		cancelHide();
		if ( popover ) {
			return;
		}
		showTimer = window.setTimeout( () => {
			showTimer = null;
			if ( ! inside ) {
				return;
			}
			showPeek();
		}, SHOW_DELAY_MS );
	};

	const onPointerLeaveTile = ( e: PointerEvent ): void => {
		// Treat moves into the popover as still-inside.
		if ( popover && e.relatedTarget instanceof Node && popover.contains( e.relatedTarget ) ) {
			return;
		}
		inside = false;
		cancelShow();
		scheduleHide();
	};

	const scheduleHide = (): void => {
		cancelHide();
		hideTimer = window.setTimeout( () => {
			hideTimer = null;
			if ( inside ) {
				return;
			}
			tearDown();
		}, HIDE_DELAY_MS );
	};

	const showPeek = (): void => {
		deps.suppressTooltip( true );
		popover = buildPopover( deps, () => tearDown() );
		document.body.appendChild( popover );
		// Inherit the user's WP color-scheme variables. The popover is
		// body-attached (outside `.desktop-mode-shell`), so the scheme
		// overrides scoped to the shell — e.g. midnight's
		// `--desktop-mode-titlebar-bg-focused: #1e1e1e` — never cascade
		// here. Copy the resolved values onto the popover root so the
		// card titlebars match the live windows.
		inheritShellSchemeVars( popover );
		positionPopover( popover, tile, deps.getOrientation() );

		// Trigger the fan-out animation on the next frame so the
		// initial frame's `transform` from CSS is the start of the
		// transition (not the end of it).
		requestAnimationFrame( () => {
			popover?.classList.add( 'desktop-mode-dock-peek--open' );
		} );

		popover.addEventListener( 'pointerenter', () => {
			inside = true;
			cancelHide();
		} );
		popover.addEventListener( 'pointerleave', ( e: PointerEvent ) => {
			if ( e.relatedTarget instanceof Node && tile.contains( e.relatedTarget ) ) {
				return;
			}
			inside = false;
			scheduleHide();
		} );
	};

	tile.addEventListener( 'pointerenter', onPointerEnterTile );
	tile.addEventListener( 'pointerleave', onPointerLeaveTile );

	return (): void => {
		tile.removeEventListener( 'pointerenter', onPointerEnterTile );
		tile.removeEventListener( 'pointerleave', onPointerLeaveTile );
		tearDown();
	};
}

/**
 * Whether the peek has anything interesting to offer right now.
 * The peek shows for any tile that has ≥1 open window — gating by
 * "is multi" is the dock's call (multi tiles call `attachDockPeek`,
 * singletons don't), so the peek only needs to verify there's
 * something to peek at.
 */
function shouldShowPeek( deps: DockPeekDeps ): boolean {
	return deps.getInstances().length >= 1;
}

/** Build the popover surface + cards. */
function buildPopover( deps: DockPeekDeps, dismiss: () => void ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'desktop-mode-dock-peek';
	root.setAttribute( 'role', 'menu' );
	root.setAttribute( 'aria-label', sprintf(
		// translators: %s is the dock item's admin-page title (e.g., "Posts")
		__( '%s — open windows' ),
		deps.item.title,
	) );

	const cards = document.createElement( 'div' );
	cards.className = 'desktop-mode-dock-peek__cards';
	root.appendChild( cards );

	const instances = deps.getInstances();
	let cardIndex = 0;
	for ( const win of instances ) {
		const card = buildInstanceCard( win, deps, cardIndex++, dismiss );
		cards.appendChild( card );
	}

	if ( deps.enableGhost !== false ) {
		const ghost = buildGhostCard( deps, cardIndex, dismiss );
		cards.appendChild( ghost );
	}

	return root;
}

/**
 * A card representing one open window of this dock item — styled
 * like a miniature window: faux titlebar with traffic-light dots +
 * the page icon + the window's live title, and a body tinted by the
 * page's hash-derived hue with ghosted content lines.
 *
 * Not a real screenshot — that would require an html2canvas-grade
 * capture path with the perf cost to match. The mini-window styling
 * gives each card a distinct visual identity (color + title + icon),
 * which is what users actually use to recognize an open window at a
 * glance.
 */
function buildInstanceCard(
	win: WPWindow,
	deps: DockPeekDeps,
	index: number,
	dismiss: () => void,
): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.setAttribute( 'role', 'menuitem' );
	card.className =
		'desktop-mode-dock-peek__card desktop-mode-dock-peek__card--instance';
	card.style.setProperty( '--peek-card-index', String( index ) );
	card.style.setProperty(
		'--peek-card-delay',
		`${ index * STAGGER_MS }ms`,
	);
	const title = win.config.title || deps.item.title;
	card.style.setProperty(
		'--peek-card-hue',
		`${ hashTitleToHue( win.id || title ) }`,
	);

	// View-transition-name: lets the focus click morph the card into
	// the actual window. The name must be unique per card or the API
	// rejects ambiguous pairings. Cleared in `spawnFocusViewTransition`
	// after the click so a subsequent peek doesn't dangle a stale name.
	card.style.setProperty(
		'--peek-card-vt-name',
		`desktop-mode-peek-card-${ win.id }`,
	);

	const titlebar = document.createElement( 'span' );
	titlebar.className = 'desktop-mode-dock-peek__card-titlebar';

	const dots = document.createElement( 'span' );
	dots.className = 'desktop-mode-dock-peek__card-dots';
	dots.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 3; i++ ) {
		dots.appendChild( document.createElement( 'i' ) );
	}
	titlebar.appendChild( dots );

	const iconHost = document.createElement( 'span' );
	iconHost.className = 'desktop-mode-dock-peek__card-icon';
	iconHost.setAttribute( 'aria-hidden', 'true' );
	const iconCls = win.config.icon || deps.item.icon;
	if ( iconCls.startsWith( 'dashicons-' ) ) {
		iconHost.classList.add( 'dashicons', sanitizeClassName( iconCls ) );
	} else {
		iconHost.classList.add( 'dashicons', 'dashicons-admin-generic' );
	}
	titlebar.appendChild( iconHost );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-dock-peek__card-label';
	label.textContent = title;
	titlebar.appendChild( label );

	card.appendChild( titlebar );

	// Body — tinted "page" surface with three ghost content lines.
	// Pure decoration by default; readers can't infer page state.
	// Plugins can swap the body wholesale (or mutate it) by hooking
	// `desktop-mode.dock.peek-card-content` — that's how a window can
	// render a real thumbnail, a status panel, a chart, etc.
	const defaultBody = document.createElement( 'span' );
	defaultBody.className = 'desktop-mode-dock-peek__card-body';
	defaultBody.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 3; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'desktop-mode-dock-peek__card-line';
		defaultBody.appendChild( line );
	}
	const ctx: DockPeekCardContext = { window: win, item: deps.item };
	const body = applyFilters< HTMLElement, [ DockPeekCardContext ] >(
		HOOKS.DOCK_PEEK_CARD_CONTENT,
		defaultBody,
		ctx,
	);
	// Mark plugin-customized bodies so CSS can opt out of the default
	// padding / gradient when a plugin wants pixel control.
	if ( body !== defaultBody ) {
		body.classList.add( 'desktop-mode-dock-peek__card-body--custom' );
	}
	card.appendChild( body );

	card.addEventListener( 'click', () => {
		spawnFocusViewTransition( deps, win, card, dismiss );
	} );

	// Hover-to-raise: bringing the live window forward on pointerenter
	// gives the peek a "scrub through my windows" feel — Mission
	// Control on macOS, Windows 7 Aero Peek. Skip if the target is
	// already focused so a re-enter into the same card doesn't churn
	// the focus stack and re-fire window-focused listeners.
	card.addEventListener( 'pointerenter', () => {
		if ( deps.windowManager.getFocused() === win ) {
			return;
		}
		deps.windowManager.focus( win );
	} );

	// Apply the whole-card filter LAST so plugins can wrap or replace
	// the fully-built node (chrome + body + listeners). Plugins that
	// return a brand-new element are responsible for re-wiring the
	// click handler and preserving the `__card` class — see the
	// HOOKS.DOCK_PEEK_CARD_ELEMENT docblock.
	const finalCard = applyFilters< HTMLElement, [ DockPeekCardContext ] >(
		HOOKS.DOCK_PEEK_CARD_ELEMENT,
		card,
		ctx,
	);

	return finalCard;
}

/**
 * Focus the target window inside `document.startViewTransition()`
 * when supported. Tagging both the source card and the destination
 * window with a matching `view-transition-name` lets the browser
 * morph one into the other — a card-to-window flight that makes
 * "click to focus" feel spatial. Falls back to a plain `focus()`
 * call where the API isn't available.
 */
function spawnFocusViewTransition(
	deps: DockPeekDeps,
	win: WPWindow,
	card: HTMLElement,
	dismiss: () => void,
): void {
	const doc = document as Document & {
		startViewTransition?: ( cb: () => void ) => unknown;
	};
	const vtName = `desktop-mode-peek-card-${ win.id }`;
	const focus = (): void => {
		dismiss();
		deps.windowManager.focus( win );
	};
	if ( typeof doc.startViewTransition !== 'function' ) {
		focus();
		return;
	}
	// Tag the destination window element so the API has a pair of
	// matching names to morph between. The name is removed after the
	// transition settles, so a subsequent click on the same window
	// doesn't carry over a stale tag.
	const targetEl = win.element;
	card.style.setProperty( 'view-transition-name', vtName );
	targetEl.style.setProperty( 'view-transition-name', vtName );
	const transition = doc.startViewTransition( focus );
	const cleanup = (): void => {
		card.style.removeProperty( 'view-transition-name' );
		targetEl.style.removeProperty( 'view-transition-name' );
	};
	const t = transition as { finished?: Promise< void > };
	if ( t.finished && typeof t.finished.then === 'function' ) {
		t.finished.then( cleanup, cleanup );
	} else {
		// Older / stubbed implementations: fall back to a microtask.
		Promise.resolve().then( cleanup );
	}
}

/** The trailing "spawn" card with dashed outline + breathing pulse. */
function buildGhostCard(
	deps: DockPeekDeps,
	index: number,
	dismiss: () => void,
): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.setAttribute( 'role', 'menuitem' );
	card.className =
		'desktop-mode-dock-peek__card desktop-mode-dock-peek__card--ghost';
	card.style.setProperty( '--peek-card-index', String( index ) );
	card.style.setProperty(
		'--peek-card-delay',
		`${ index * STAGGER_MS }ms`,
	);

	// Ghost label uses a phrase, not a glyph. The "+" sits beside it
	// at quarter opacity — decoration, not the affordance itself.
	const plus = document.createElement( 'span' );
	plus.className = 'desktop-mode-dock-peek__card-plus';
	plus.setAttribute( 'aria-hidden', 'true' );
	plus.textContent = '+';
	card.appendChild( plus );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-dock-peek__card-label';
	label.textContent = sprintf(
		// translators: %s is the admin-page title (e.g., "Posts")
		__( 'New %s' ),
		deps.item.title,
	);
	card.appendChild( label );

	card.addEventListener( 'click', () => {
		spawnWithViewTransition( deps, dismiss );
	} );

	return card;
}

/**
 * Spawn a new window through the View Transitions API when supported,
 * so the Ghost Card appears to morph into the new window. Fallback:
 * call openNew directly — the existing CSS `--open` keyframe still
 * gives the new window a soft entrance.
 */
function spawnWithViewTransition(
	deps: DockPeekDeps,
	dismiss: () => void,
): void {
	const doc = document as Document & {
		startViewTransition?: ( cb: () => void ) => unknown;
	};
	const spawn = (): void => {
		dismiss();
		deps.openNew();
	};
	if ( typeof doc.startViewTransition === 'function' ) {
		doc.startViewTransition( spawn );
		return;
	}
	spawn();
}

/** Distance from each viewport edge that the popover must respect. */
const VIEWPORT_MARGIN_PX = 12;

/**
 * CSS custom properties whose resolved value must be copied from the
 * `.desktop-mode-shell` element onto the body-attached peek popover.
 *
 * The desktop shell scopes per-color-scheme overrides to itself
 * (`.desktop-mode-shell[data-desktop-mode-scheme=…] { --x: … }`) — so a
 * popover appended to `document.body` gets the `:root` defaults
 * instead of the user's selected scheme. Inheriting these by hand
 * keeps the card chrome a faithful shrink of the real window
 * titlebar regardless of which profile color scheme is active.
 */
const SHELL_SCHEME_VARS = [
	'--wp-admin-theme-color',
	'--desktop-mode-titlebar-bg',
	'--desktop-mode-titlebar-bg-focused',
	'--desktop-mode-titlebar-color',
	'--desktop-mode-titlebar-color-focused',
] as const;

function inheritShellSchemeVars( popover: HTMLElement ): void {
	const shell = document.querySelector< HTMLElement >( '.desktop-mode-shell' );
	if ( ! shell ) {
		return;
	}
	const computed = window.getComputedStyle( shell );
	for ( const name of SHELL_SCHEME_VARS ) {
		const value = computed.getPropertyValue( name ).trim();
		if ( value ) {
			popover.style.setProperty( name, value );
		}
	}
}

/**
 * Position the popover next to the tile, flipping per dock
 * orientation, then clamp to the viewport so a tall stack of cards
 * never lands off-screen. The CSS sets a max-height + internal
 * scroll, so once the available vertical space is constrained by
 * `clampToViewport()` the cards container starts scrolling instead
 * of growing.
 */
function positionPopover(
	popover: HTMLElement,
	tile: HTMLElement,
	orientation: DockOrientation,
): void {
	const rect = tile.getBoundingClientRect();
	popover.dataset.orientation = orientation;
	if ( orientation === 'bottom' ) {
		popover.style.left = `${ rect.left + rect.width / 2 }px`;
		popover.style.top = `${ rect.top - 12 }px`;
	} else if ( orientation === 'right' ) {
		popover.style.top = `${ rect.top + rect.height / 2 }px`;
		popover.style.left = `${ rect.left - 12 }px`;
	} else {
		// Left dock (default).
		popover.style.top = `${ rect.top + rect.height / 2 }px`;
		popover.style.left = `${ rect.right + 12 }px`;
	}

	// Wait one frame so the popover has been laid out before we read
	// its measured height — `clampToViewport` translates it inward
	// against `window.innerHeight`. Without this the popover briefly
	// renders off-screen on a stack of 6+ instance cards.
	requestAnimationFrame( () => clampToViewport( popover, orientation ) );
}

/**
 * Translate the popover so it stays inside the viewport. The CSS
 * `max-height: min(80vh, 480px)` already caps growth; this handles
 * the residual case where the anchor point sits near the top or
 * bottom edge and the popover would still overflow.
 */
function clampToViewport(
	popover: HTMLElement,
	orientation: DockOrientation,
): void {
	const rect = popover.getBoundingClientRect();
	const vh = window.innerHeight;
	const vw = window.innerWidth;
	const min = VIEWPORT_MARGIN_PX;

	let dy = 0;
	let dx = 0;

	if ( rect.top < min ) {
		dy = min - rect.top;
	} else if ( rect.bottom > vh - min ) {
		dy = vh - min - rect.bottom;
	}
	if ( rect.left < min ) {
		dx = min - rect.left;
	} else if ( rect.right > vw - min ) {
		dx = vw - min - rect.right;
	}

	if ( dx === 0 && dy === 0 ) {
		return;
	}

	// Append a clamp translation onto the orientation-specific
	// transform set in CSS. We can't just overwrite `transform`
	// (that would lose the orientation translate), so we set a
	// custom property the CSS reads inside `translate(...)`.
	popover.style.setProperty( '--peek-clamp-x', `${ dx }px` );
	popover.style.setProperty( '--peek-clamp-y', `${ dy }px` );
	popover.classList.add( 'desktop-mode-dock-peek--clamped' );
	// Suppress orientation/clamp variables for `bottom`'s horizontal
	// case on left/right docks — handled in CSS via the data attribute.
	void orientation;
}
