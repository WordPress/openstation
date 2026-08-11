/**
 * OpenStation — the Constellation.
 *
 * The hover-submenu surface that gives the `openstation` desktop
 * layout its reason to exist.
 *
 * Every other layout throws a menu's submenu away at the dock: the
 * tile opens the landing page and the child pages are only reachable
 * once you are already inside the window, through its tab strip. That
 * is a real navigational cost — "Appearance → Menus" is two screens
 * away from a rail that already knows the link exists. The tab strip
 * stays exactly as it is; this adds the missing shortcut in front of
 * it.
 *
 * Hovering a menu tile fans a flyout out of the rail:
 *
 *   ┌──────────────────────────────┐
 *   │ ◈  Appearance                │   ← head: the menu's own page
 *   │    3 pages                   │
 *   ├──────────────────────────────┤
 *   │ OPEN WINDOWS                 │
 *   │ ● Appearance          Open   │   ← live instances, click to focus
 *   ├──────────────────────────────┤
 *   │ OPEN                         │
 *   │ ◦ Themes                     │   ← the submenu, one row per link
 *   │ ◦ Customize                  │
 *   │ ◦ Menus                      │
 *   ├──────────────────────────────┤
 *   │ ＋ New Appearance window      │
 *   └──────────────────────────────┘
 *          ╲ beam ╱
 *           [tile]
 *
 * Three things are worth knowing about the implementation:
 *
 * 1. **It is delegated, not per-tile.** One `pointerover` listener on
 *    `document` serves every tile on the rail, so a live menu refresh
 *    (plugin activated, tiles rebuilt) can't leave a stale listener
 *    behind on a detached node — the failure mode that made the
 *    hover-peek leak popovers before it grew a teardown map.
 * 2. **It owns the hover gesture in this layout.** `dock-peek` stands
 *    down for menu tiles here (see `active.ts`), and the dock tooltip
 *    is suppressed by CSS while the flyout is open, because the head
 *    already says the tile's name — louder, and in the right place.
 * 3. **It routes through the same window ids the dock does** (see
 *    `routing.ts`), so the flyout and the tile address one window
 *    between them rather than two.
 * 4. **A dismissed panel outlives its dismissal, and there can be
 *    more than one on screen.** `panel` is the panel you can still
 *    interact with, not the only one in the document: a dismissed
 *    panel is detached from the module's state immediately but stays
 *    painted, marked `--closing`, until its exit has finished.
 *
 *    That decoupling is the whole reason moving along the rail looks
 *    right. It is TWO panels, each animating at its own tile — the
 *    one you left playing its dismissal above the tile it belongs
 *    to, the one you arrived at rising above its own — rather than
 *    one panel that slides across and swaps its contents. Each is a
 *    menu anchored to a specific tile; turning one into the other
 *    would claim they are the same object, and it would drag a beam
 *    across the rail pointing at a tile its panel has nothing to do
 *    with.
 *
 *    The one dismissal that skips its animation is `cut`, for when
 *    the anchor rect has been invalidated (scroll, resize, layout
 *    switch): a panel gliding away from a tile that has already
 *    moved points at nothing, so the node just goes.
 *
 * Pointer AND keyboard. The tile is a `<button>` the rail already
 * focuses; ArrowUp (or Enter on a tile with children) fans the
 * constellation open and moves focus into it, arrows rove, Escape
 * collapses and hands focus back. Touch is deliberately excluded —
 * hover has no touch equivalent, and a tap that opened a menu instead
 * of the page would break the one gesture every other layout shares.
 */

import { __, _n, sprintf } from '../i18n';
import { applyFilters, doAction, HOOKS } from '../hooks';
import type { DockItem, SubmenuItem } from '../dock';
import type { Window as OsWindow } from '../window';
import { hashTitleToHue } from '../ui/util/hash-hue';
import { deriveWindowId, sanitizeClassName } from '../utils';
import { isConstellationLayoutActive } from './active';
import { ITEM_MENU_OPENING_EVENT } from '../item-visibility-menu';
import {
	openMenuItem,
	openNewMenuItem,
	openSubmenuItem,
	type ConstellationRouting,
} from './routing';

export { isConstellationLayoutActive, CONSTELLATION_LAYOUT } from './active';

/** Dwell before the flyout fans out. Short enough to feel instant. */
const SHOW_DELAY_MS = 130;
/**
 * Grace period after the pointer leaves both surfaces. Generous,
 * because the trip from tile to panel crosses the beam gap and a
 * tight timer turns that into a flicker.
 */
const HIDE_DELAY_MS = 240;
/**
 * How long the exit plays before the node is removed. Must match the
 * longest transition on `.os-constellation--closing` in
 * `openstation-layout.css`.
 *
 * Deliberately less than half the entrance. A panel arriving is an
 * event worth a spring; a panel leaving is the user having already
 * moved on, and anything slower reads as the menu not letting go.
 */
const EXIT_MS = 160;
/** Gap between the tile's top edge and the panel's bottom edge. */
const BEAM_GAP_PX = 14;
/** Keep-out margin from every viewport edge. */
const VIEWPORT_MARGIN_PX = 12;
/**
 * Floor for the vertical cap. Below roughly this, a panel has stopped
 * being a menu and become a scrollbar with a title on it, so on a
 * viewport that short we let it overflow slightly instead.
 */
const MIN_PANEL_HEIGHT_PX = 160;

/**
 * Body class set while a flyout is open. CSS uses it to mute the dock
 * tooltip — two hover surfaces stacked on one tile is one too many,
 * and the flyout's head carries the same label.
 */
const OPEN_BODY_CLASS = 'os-constellation-open';

/**
 * Whether the user has asked for less motion.
 *
 * Read at dismissal rather than cached: the exit is driven from JS
 * (a timer decides when the node leaves the document), so unlike the
 * CSS-side reductions it can't just be overridden by a media query.
 * A user who flips the OS setting mid-session gets the new answer on
 * the next dismissal.
 */
function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches
	);
}

/** Wiring the constellation needs from the shell boot path. */
export interface DockConstellationDeps extends ConstellationRouting {
	/**
	 * The complete admin-menu list, read fresh on every hover. The
	 * layout dispatcher's `getMenuItems()` is the intended source —
	 * reading it late means a plugin activated seconds ago is already
	 * in the flyout without the constellation subscribing to anything.
	 */
	getMenuItems: () => DockItem[];
}

/**
 * Context handed to the {@link HOOKS.CONSTELLATION_PANEL} filter.
 *
 * @public
 */
export interface ConstellationPanelContext {
	/** The menu the flyout was opened for. */
	item: DockItem;
	/** Live windows currently open for this menu. */
	instances: OsWindow[];
	/** The dock tile the flyout is anchored to. */
	tile: HTMLElement;
}

/**
 * Mount the constellation. Returns a teardown that detaches every
 * listener and removes any open flyout.
 */
export function mountDockConstellation(
	deps: DockConstellationDeps,
): () => void {
	let panel: HTMLElement | null = null;
	let anchor: HTMLElement | null = null;
	let anchorSlug = '';
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

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

	/**
	 * Resolve the menu tile an event landed on, or null when the event
	 * has nothing to do with us. Guards on the layout, on the tile
	 * being menu-derived (system tiles keep the hover-peek), and on the
	 * tile living on a rail rather than in some plugin's own markup.
	 */
	const tileFrom = ( target: EventTarget | null ): HTMLElement | null => {
		if ( ! isConstellationLayoutActive() ) {
			return null;
		}
		if ( ! ( target instanceof Element ) ) {
			return null;
		}
		const tile = target.closest< HTMLElement >( '.os-dock__item' );
		if ( ! tile || ! tile.dataset.menuSlug ) {
			return null;
		}
		if ( ! tile.closest( '.os-dock' ) ) {
			return null;
		}
		return tile;
	};

	/**
	 * Panels that have been dismissed and are playing their exit, no
	 * longer reachable through `panel`. Tracked so `teardown()` can
	 * take them with it and so the body flag can stay set until the
	 * last one is actually gone.
	 */
	const closing = new Set< HTMLElement >();

	/**
	 * The dock tooltip stays muted for as long as ANY panel is on
	 * screen, including one mid-exit — otherwise the tooltip pops back
	 * under a panel that is still visibly fading over it.
	 */
	const syncBodyFlag = (): void => {
		document.body.classList.toggle(
			OPEN_BODY_CLASS,
			panel !== null || closing.size > 0,
		);
	};

	/**
	 * How a retiring panel should leave.
	 *
	 * - `exit` — the ordinary dismissal: fall back into the rail.
	 * - `cut` — remove the node now. Used wherever an animation would
	 *   be pointless or wrong rather than merely skippable: the anchor
	 *   rect has been invalidated (scroll, resize, layout switch) and
	 *   a panel gliding away from a tile that already moved points at
	 *   nothing; or a hand-off is under way and the node is about to
	 *   be covered pixel-for-pixel by its replacement, so nothing of
	 *   it would ever be seen uncovered.
	 */
	type RetireMode = 'exit' | 'cut';

	/**
	 * Detach a panel from the module's state and start it leaving.
	 *
	 * The state detach is unconditional and happens first: everything
	 * downstream — including the synchronous re-open in the hand-off
	 * path — has to see "no panel is current" even while a node is
	 * still in the document playing its exit.
	 */
	const retire = (
		mode: RetireMode,
		opts: { restoreFocus?: boolean; handoff?: boolean } = {},
	): void => {
		if ( ! panel ) {
			return;
		}
		const previousAnchor = anchor;
		const dying = panel;
		panel = null;
		anchor = null;
		anchorSlug = '';
		previousAnchor?.removeAttribute( 'data-constellation-open' );

		if ( mode === 'cut' || prefersReducedMotion() ) {
			dying.remove();
		} else {
			dying.classList.remove( 'os-constellation--open' );
			// `--closing` marks every retiring panel — it is what
			// `:not( --closing )` queries key off, ours and plugins'.
			dying.classList.add( 'os-constellation--closing' );
			closing.add( dying );
			window.setTimeout( () => {
				dying.remove();
				closing.delete( dying );
				syncBodyFlag();
			}, EXIT_MS );
		}
		syncBodyFlag();

		if ( opts.restoreFocus && previousAnchor ) {
			previousAnchor
				.querySelector< HTMLElement >( '.os-dock__item-primary' )
				?.focus();
		}
		doAction( HOOKS.CONSTELLATION_CLOSED, {
			menuSlug: previousAnchor?.dataset.menuSlug ?? '',
			// `true` when another tile is already taking over, so a
			// subscriber can tell "the menu closed" from "the menu
			// moved" without diffing against the next opened event.
			handoff: opts.handoff === true,
		} );
	};

	const close = ( restoreFocus = false, immediate = false ): void => {
		cancelShow();
		cancelHide();
		retire( immediate ? 'cut' : 'exit', { restoreFocus } );
	};

	const open = ( tile: HTMLElement, focusFirst = false ): void => {
		// A pending dismissal must not fire onto the panel we are about
		// to put up. `onPointerOver` already cancels, but the keyboard
		// path reaches here directly.
		cancelShow();
		cancelHide();
		const slug = tile.dataset.menuSlug as string;
		if ( panel && anchorSlug === slug ) {
			if ( focusFirst ) {
				focusRow( panel, 0 );
			}
			return;
		}
		const item = deps.getMenuItems().find( ( i ) => i.id === slug );
		if ( ! item ) {
			// Nothing to hand off TO — this is a plain dismissal.
			close();
			return;
		}

		/*
		 * Moving from one menu to the next is TWO panels, each
		 * animating at its own tile: the one you left plays its
		 * dismissal above the tile it belongs to, the one you arrived
		 * at plays its entrance above its own.
		 *
		 * This deliberately is not a morph. A single panel that slid
		 * along the rail and swapped its contents was the other
		 * candidate, and it is wrong for what these are: each panel is
		 * a menu, anchored to a specific tile, and turning one into
		 * another says they are the same object when the whole point
		 * of the rail is that they are not. What the eye needs to see
		 * is Appearance closing and Settings opening — which also
		 * means the beam stays honest, since each panel's thread runs
		 * to the tile it actually belongs to for as long as it exists.
		 *
		 * That is only possible because a retiring panel is decoupled
		 * from `panel` rather than being the same node re-used: the
		 * outgoing one keeps its own anchor and finishes its own exit
		 * while the incoming one is already rising elsewhere.
		 */
		const handingOff = panel !== null;

		retire( 'exit', { handoff: handingOff } );

		const instances =
			deps.windowManager.getAllByBaseIdOnActiveDesktop(
				resolveBaseId( deps, item ),
			);
		panel = buildPanel( deps, item, instances, tile, close );
		// Roving tabindex: the flyout is ONE tab stop, not one per row.
		// Arrow keys move between rows and Tab leaves the menu — the
		// conventional ARIA menu pattern, and the reason it matters
		// here is that a fifteen-child submenu would otherwise put
		// fifteen stops between the dock and whatever follows it.
		//
		// Applied after the panel filter rather than in each builder so
		// rows a plugin appended are covered too; `focus()` still works
		// on a `tabindex="-1"` element, which is all the roving needs.
		for ( const row of rowsOf( panel ) ) {
			row.tabIndex = -1;
		}
		anchor = tile;
		anchorSlug = slug;
		document.body.appendChild( panel );
		syncBodyFlag();
		tile.setAttribute( 'data-constellation-open', '' );
		inheritShellVars( panel );
		position( panel, tile );
		// One frame late so the CSS start state is a real painted
		// frame and the entrance has something to animate FROM.
		requestAnimationFrame( () => {
			panel?.classList.add( 'os-constellation--open' );
			if ( focusFirst && panel ) {
				focusRow( panel, 0 );
			}
		} );
		doAction( HOOKS.CONSTELLATION_OPENED, {
			menuSlug: slug,
			item,
			instances,
			handoff: handingOff,
		} );
	};

	const onPointerOver = ( e: PointerEvent ): void => {
		// Touch and pen never fan the flyout — see the module header.
		if ( e.pointerType && e.pointerType !== 'mouse' ) {
			return;
		}
		if ( panel && e.target instanceof Node && panel.contains( e.target ) ) {
			cancelHide();
			return;
		}
		const tile = tileFrom( e.target );
		if ( ! tile ) {
			return;
		}
		cancelHide();
		if ( panel && anchorSlug === tile.dataset.menuSlug ) {
			return;
		}
		cancelShow();
		showTimer = window.setTimeout( () => {
			showTimer = null;
			open( tile );
		}, panel ? 0 : SHOW_DELAY_MS );
	};

	const onPointerOut = ( e: PointerEvent ): void => {
		const to = e.relatedTarget;
		const stillInside =
			to instanceof Node &&
			( ( panel && panel.contains( to ) ) ||
				( anchor && anchor.contains( to ) ) ||
				!! tileFrom( to ) );
		if ( stillInside ) {
			return;
		}
		cancelShow();
		cancelHide();
		hideTimer = window.setTimeout( () => {
			hideTimer = null;
			close();
		}, HIDE_DELAY_MS );
	};

	const onKeyDown = ( e: KeyboardEvent ): void => {
		// Inside an open flyout: rove, activate, collapse.
		if ( panel && e.target instanceof Node && panel.contains( e.target ) ) {
			const rows = rowsOf( panel );
			const current = rows.indexOf( e.target as HTMLElement );
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				close( true );
			} else if ( e.key === 'ArrowDown' ) {
				e.preventDefault();
				focusRow( panel, current + 1 );
			} else if ( e.key === 'ArrowUp' ) {
				e.preventDefault();
				// Rolling off the top of the list returns to the rail
				// rather than wrapping — the dock is "above" nothing,
				// so wrapping would strand the keyboard in the panel.
				if ( current <= 0 ) {
					close( true );
				} else {
					focusRow( panel, current - 1 );
				}
			} else if ( e.key === 'Home' ) {
				e.preventDefault();
				focusRow( panel, 0 );
			} else if ( e.key === 'End' ) {
				e.preventDefault();
				focusRow( panel, rows.length - 1 );
			} else if ( e.key === 'Tab' ) {
				// Tab means "leave this menu". Collapse it and hand
				// focus back to the tile WITHOUT preventing the
				// default, so the browser then tabs onward from the
				// tile — the rail's own position in the document
				// order. Closing without restoring focus would drop
				// the user on `<body>` and restart their traversal
				// from the top of the page.
				close( true );
			}
			return;
		}
		// On a tile: ArrowUp fans the constellation out (the rail is at
		// the bottom edge, so "up" is where the panel appears).
		const tile = tileFrom( e.target );
		if ( ! tile ) {
			return;
		}
		if ( e.key === 'ArrowUp' ) {
			e.preventDefault();
			open( tile, true );
		} else if ( e.key === 'Escape' ) {
			close();
		}
	};

	/**
	 * Any layout / viewport change invalidates the anchor rect, so the
	 * panel is cut rather than animated out — an exit that glides away
	 * from a tile which has already moved points at nothing.
	 */
	const onInvalidate = (): void => close( false, true );

	document.addEventListener( 'pointerover', onPointerOver );
	document.addEventListener( 'pointerout', onPointerOut );
	document.addEventListener( 'keydown', onKeyDown );
	window.addEventListener( 'resize', onInvalidate );
	window.addEventListener( 'blur', onInvalidate );
	document.addEventListener( 'os-layout-changed', onInvalidate );
	// A tile menu is opening on the same tile this panel is anchored
	// to. Cut rather than animate: an exit gliding back into the rail
	// while a menu paints over the same corner is two surfaces
	// disagreeing about what the user just asked for.
	document.addEventListener( ITEM_MENU_OPENING_EVENT, onInvalidate );
	// Capture: a scroll inside the dock's own overflow container never
	// bubbles to `window`, and that is exactly the scroll that moves
	// the tile out from under the panel.
	document.addEventListener( 'scroll', onInvalidate, true );

	return (): void => {
		close( false, true );
		// Take any in-flight exits with us. Their removal timers would
		// otherwise fire against a module nobody is listening to any
		// more, leaving an inert panel painted over the shell.
		for ( const ghost of closing ) {
			ghost.remove();
		}
		closing.clear();
		syncBodyFlag();
		document.removeEventListener( ITEM_MENU_OPENING_EVENT, onInvalidate );
		document.removeEventListener( 'pointerover', onPointerOver );
		document.removeEventListener( 'pointerout', onPointerOut );
		document.removeEventListener( 'keydown', onKeyDown );
		window.removeEventListener( 'resize', onInvalidate );
		window.removeEventListener( 'blur', onInvalidate );
		document.removeEventListener( 'os-layout-changed', onInvalidate );
		document.removeEventListener( 'scroll', onInvalidate, true );
	};
}

/**
 * Window-manager key for a menu tile. Mirrors `Dock.resolveItemBaseId`
 * closely enough for the instance lookup: an explicit `windowId` wins,
 * otherwise the URL-derived id.
 */
function resolveBaseId(
	deps: DockConstellationDeps,
	item: DockItem,
): string {
	if ( item.windowId ) {
		return item.windowId;
	}
	return deriveWindowId( item.url, deps.adminUrl );
}

/* -------------------------------------------------------------------
 * Panel construction
 * ---------------------------------------------------------------- */

function buildPanel(
	deps: DockConstellationDeps,
	item: DockItem,
	instances: OsWindow[],
	tile: HTMLElement,
	dismiss: () => void,
): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-constellation';
	root.setAttribute( 'role', 'menu' );
	root.setAttribute(
		'aria-label',
		sprintf(
			// translators: %s is an admin menu title (e.g. "Appearance").
			__( '%s menu' ),
			item.title,
		),
	);
	// Every hue in the panel — orbit dots, the head's halo, the beam —
	// derives from the menu's own title, so "Appearance" is the same
	// colour every session on every site. Free identity, zero art.
	root.style.setProperty( '--os-cn-hue', String( hashTitleToHue( item.title ) ) );

	const surface = document.createElement( 'div' );
	surface.className = 'os-constellation__surface';
	root.appendChild( surface );

	surface.appendChild( buildHead( deps, item, dismiss ) );

	let rowIndex = 0;
	const nextIndex = (): number => rowIndex++;

	if ( instances.length > 0 ) {
		surface.appendChild(
			buildInstancesGroup( deps, item, instances, dismiss, nextIndex ),
		);
	}

	if ( item.submenu.length > 0 ) {
		surface.appendChild(
			buildSubmenuGroup( deps, item, dismiss, nextIndex ),
		);
	}

	surface.appendChild( buildFooter( deps, item, dismiss, nextIndex() ) );

	// Cursor spotlight — the surface paints a soft radial highlight at
	// `--os-cn-x` / `--os-cn-y`, so the panel lights up under the
	// pointer instead of sitting inert.
	surface.addEventListener( 'pointermove', ( e: PointerEvent ) => {
		const rect = surface.getBoundingClientRect();
		if ( ! rect.width || ! rect.height ) {
			return;
		}
		surface.style.setProperty(
			'--os-cn-x',
			`${ ( ( e.clientX - rect.left ) / rect.width ) * 100 }%`,
		);
		surface.style.setProperty(
			'--os-cn-y',
			`${ ( ( e.clientY - rect.top ) / rect.height ) * 100 }%`,
		);
	} );

	// Sheen and beam hang off the ROOT, not the surface. The surface's
	// two pseudo-elements are already spent (`::before` spotlight,
	// `::after` edge mask), and a root-level overlay is what lets the
	// sheen sweep OVER the rows rather than under them.
	const sheen = document.createElement( 'span' );
	sheen.className = 'os-constellation__sheen';
	sheen.setAttribute( 'aria-hidden', 'true' );
	root.appendChild( sheen );

	const beam = document.createElement( 'span' );
	beam.className = 'os-constellation__beam';
	beam.setAttribute( 'aria-hidden', 'true' );
	root.appendChild( beam );

	const ctx: ConstellationPanelContext = { item, instances, tile };
	return applyFilters< HTMLElement, [ ConstellationPanelContext ] >(
		HOOKS.CONSTELLATION_PANEL,
		root,
		ctx,
	);
}

/** The head row — icon, title, and the menu's own page behind it. */
function buildHead(
	deps: DockConstellationDeps,
	item: DockItem,
	dismiss: () => void,
): HTMLElement {
	const head = document.createElement( 'button' );
	head.type = 'button';
	head.className = 'os-constellation__head os-constellation__row';
	head.setAttribute( 'role', 'menuitem' );

	const iconHost = document.createElement( 'span' );
	iconHost.className = 'os-constellation__head-icon';
	iconHost.setAttribute( 'aria-hidden', 'true' );
	iconHost.appendChild( glyph( item.icon ) );
	head.appendChild( iconHost );

	const text = document.createElement( 'span' );
	text.className = 'os-constellation__head-text';
	const title = document.createElement( 'span' );
	title.className = 'os-constellation__head-title';
	title.textContent = item.title;
	text.appendChild( title );
	const hint = document.createElement( 'span' );
	hint.className = 'os-constellation__head-hint';
	if ( item.submenu.length > 0 ) {
		hint.textContent = sprintf(
			// translators: %d is the number of pages inside an admin menu.
			_n( '%d page', '%d pages', item.submenu.length ),
			item.submenu.length,
		);
	} else {
		hint.textContent = __( 'Open' );
	}
	text.appendChild( hint );
	head.appendChild( text );

	// No trailing chevron. It read as "there is another level behind
	// me" — the one thing the head does NOT do. It opens a window,
	// same as clicking the tile; the row's own hover state is the
	// affordance, and a directional glyph on top of it was a promise
	// the panel could not keep.

	head.addEventListener( 'click', () => {
		dismiss();
		openMenuItem( deps, item );
	} );

	return head;
}

/** Live windows for this menu, newest chrome first. */
function buildInstancesGroup(
	deps: DockConstellationDeps,
	item: DockItem,
	instances: OsWindow[],
	dismiss: () => void,
	nextIndex: () => number,
): HTMLElement {
	const group = document.createElement( 'div' );
	group.className =
		'os-constellation__group os-constellation__group--live';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-label', __( 'Open windows' ) );
	group.appendChild(
		legend(
			sprintf(
				// translators: %d is a count of currently-open windows.
				_n( '%d open window', '%d open windows', instances.length ),
				instances.length,
			),
		),
	);

	for ( const win of instances ) {
		const row = document.createElement( 'button' );
		row.type = 'button';
		row.className =
			'os-constellation__row os-constellation__row--live';
		row.setAttribute( 'role', 'menuitem' );
		row.style.setProperty( '--os-cn-row', String( nextIndex() ) );
		if ( win.state === 'minimized' ) {
			row.dataset.state = 'minimized';
		}

		const pip = document.createElement( 'span' );
		pip.className = 'os-constellation__pip';
		pip.setAttribute( 'aria-hidden', 'true' );
		row.appendChild( pip );

		const label = document.createElement( 'span' );
		label.className = 'os-constellation__row-label';
		label.textContent = win.config.title || item.title;
		row.appendChild( label );

		const state = document.createElement( 'span' );
		state.className = 'os-constellation__row-meta';
		state.textContent =
			win.state === 'minimized' ? __( 'Minimized' ) : __( 'Open' );
		row.appendChild( state );

		row.addEventListener( 'click', () => {
			dismiss();
			if ( win.state === 'minimized' ) {
				win.restore();
			}
			deps.windowManager.focus( win );
		} );

		group.appendChild( row );
	}
	return group;
}

/** The submenu proper — the whole point of the layout. */
function buildSubmenuGroup(
	deps: DockConstellationDeps,
	item: DockItem,
	dismiss: () => void,
	nextIndex: () => number,
): HTMLElement {
	const group = document.createElement( 'div' );
	group.className = 'os-constellation__group';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-label', item.title );
	group.appendChild( legend( __( 'Open' ) ) );

	for ( const sub of item.submenu ) {
		group.appendChild(
			buildSubmenuRow( deps, item, sub, dismiss, nextIndex() ),
		);
	}
	return group;
}

function buildSubmenuRow(
	deps: DockConstellationDeps,
	item: DockItem,
	sub: SubmenuItem,
	dismiss: () => void,
	index: number,
): HTMLElement {
	const row = document.createElement( 'button' );
	row.type = 'button';
	row.className = 'os-constellation__row os-constellation__row--sub';
	row.setAttribute( 'role', 'menuitem' );
	row.style.setProperty( '--os-cn-row', String( index ) );
	// Per-row hue, so a long submenu reads as a spectrum rather than
	// fifteen identical grey bullets.
	row.style.setProperty(
		'--os-cn-row-hue',
		String( hashTitleToHue( sub.title ) ),
	);

	const orbit = document.createElement( 'span' );
	orbit.className = 'os-constellation__orbit';
	orbit.setAttribute( 'aria-hidden', 'true' );
	row.appendChild( orbit );

	const label = document.createElement( 'span' );
	label.className = 'os-constellation__row-label';
	label.textContent = sub.title;
	row.appendChild( label );

	row.addEventListener( 'click', () => {
		dismiss();
		openSubmenuItem( deps, item, sub );
	} );

	return row;
}

/** The trailing "open another" affordance. */
function buildFooter(
	deps: DockConstellationDeps,
	item: DockItem,
	dismiss: () => void,
	index: number,
): HTMLElement {
	const row = document.createElement( 'button' );
	row.type = 'button';
	row.className = 'os-constellation__row os-constellation__row--new';
	row.setAttribute( 'role', 'menuitem' );
	row.style.setProperty( '--os-cn-row', String( index ) );

	const plus = document.createElement( 'span' );
	plus.className = 'os-constellation__plus';
	plus.setAttribute( 'aria-hidden', 'true' );
	plus.textContent = '+';
	row.appendChild( plus );

	const label = document.createElement( 'span' );
	label.className = 'os-constellation__row-label';
	label.textContent = sprintf(
		// translators: %s is an admin menu title (e.g. "Posts").
		__( 'New %s window' ),
		item.title,
	);
	row.appendChild( label );

	row.addEventListener( 'click', () => {
		dismiss();
		openNewMenuItem( deps, item );
	} );

	return row;
}

function legend( text: string ): HTMLElement {
	const el = document.createElement( 'span' );
	el.className = 'os-constellation__legend';
	el.textContent = text;
	return el;
}

/** Dashicon span, falling back to the generic cog for anything else. */
function glyph( icon: string ): HTMLElement {
	const el = document.createElement( 'span' );
	el.className = 'dashicons';
	el.classList.add(
		icon.startsWith( 'dashicons-' )
			? sanitizeClassName( icon )
			: 'dashicons-admin-generic',
	);
	return el;
}

/* -------------------------------------------------------------------
 * Focus + geometry
 * ---------------------------------------------------------------- */

function rowsOf( panel: HTMLElement ): HTMLElement[] {
	return Array.from(
		panel.querySelectorAll< HTMLElement >( '.os-constellation__row' ),
	);
}

function focusRow( panel: HTMLElement, index: number ): void {
	const rows = rowsOf( panel );
	if ( rows.length === 0 ) {
		return;
	}
	const clamped = Math.max( 0, Math.min( rows.length - 1, index ) );
	rows[ clamped ].focus();
}

/**
 * CSS custom properties whose RESOLVED value has to be copied from the
 * shell onto the body-attached panel.
 *
 * The palette is declared on `body.os-active` and per-scheme overrides
 * are scoped to `.os-shell`, so a panel appended to `document.body`
 * inherits the former but not the latter. Copying these by hand keeps
 * the flyout's chrome matched to the live windows under the user's
 * selected admin colour scheme — the same problem, and the same fix,
 * as the hover-peek's `inheritShellSchemeVars`.
 */
const SHELL_VARS = [
	'--wp-admin-theme-color',
	'--os-titlebar-bg-focused',
	'--os-titlebar-color-focused',
] as const;

function inheritShellVars( panel: HTMLElement ): void {
	const shell = document.querySelector< HTMLElement >( '.os-shell' );
	if ( ! shell ) {
		return;
	}
	const computed = window.getComputedStyle( shell );
	for ( const name of SHELL_VARS ) {
		const value = computed.getPropertyValue( name ).trim();
		if ( value ) {
			panel.style.setProperty( name, value );
		}
	}
}

/**
 * Anchor the panel above the tile, cap it to the room actually
 * available there, then pull it back inside the viewport horizontally
 * and slide the beam to stay pointed at the tile's centre.
 *
 * The two axes are clamped differently on purpose.
 *
 * **Horizontally** the panel is nudged, because sliding it sideways
 * costs nothing — it still points at its tile, and the beam tracks
 * the anchor independently via `--os-cn-beam-x` so the thread stays
 * honest.
 *
 * **Vertically it cannot be nudged at all.** The panel hangs off the
 * top of the dock; moving it down to fit would push it over the rail
 * and under the pointer, which is worse than the overflow. So the
 * height is capped instead: `--os-cn-max-h` is the distance from the
 * panel's bottom edge to the top of the viewport, and the surface
 * reads it as a `max-height`. A menu too tall for the space shrinks
 * to fit and its submenu group takes the scroll — which is why the
 * group is the flex item that shrinks, not the head or the
 * new-window row.
 */
function position( panel: HTMLElement, tile: HTMLElement ): void {
	const rect = tile.getBoundingClientRect();
	const centre = rect.left + rect.width / 2;
	panel.style.left = `${ centre }px`;
	panel.style.top = `${ rect.top - BEAM_GAP_PX }px`;

	// `MIN_PANEL_HEIGHT_PX` is a floor rather than a hard truth: on a
	// viewport so short that even that doesn't fit, a panel that
	// overflows slightly beats one collapsed to a sliver.
	const available = rect.top - BEAM_GAP_PX - VIEWPORT_MARGIN_PX;
	panel.style.setProperty(
		'--os-cn-max-h',
		`${ Math.max( MIN_PANEL_HEIGHT_PX, available ) }px`,
	);

	requestAnimationFrame( () => {
		const panelRect = panel.getBoundingClientRect();
		const vw = window.innerWidth;
		let dx = 0;
		if ( panelRect.left < VIEWPORT_MARGIN_PX ) {
			dx = VIEWPORT_MARGIN_PX - panelRect.left;
		} else if ( panelRect.right > vw - VIEWPORT_MARGIN_PX ) {
			dx = vw - VIEWPORT_MARGIN_PX - panelRect.right;
		}
		if ( dx !== 0 ) {
			panel.style.setProperty( '--os-cn-shift', `${ dx }px` );
			panel.style.setProperty( '--os-cn-beam-x', `${ -dx }px` );
		}
	} );
}

