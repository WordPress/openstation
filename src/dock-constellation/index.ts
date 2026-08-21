/**
 * OpenStation — the Constellation.
 *
 * The hover-submenu surface: every dock rail, every layout, every
 * edge.
 *
 * Without it a menu's submenu is thrown away at the dock: the tile
 * opens the landing page and the child pages are only reachable once
 * you are already inside the window, through its tab strip. That is a
 * real navigational cost — "Appearance → Menus" is two screens away
 * from a rail that already knows the link exists. The tab strip stays
 * exactly as it is; this adds the missing shortcut in front of it.
 *
 * The surface belongs to the dock rather than to any one layout: a
 * rail on the left has the same submenus and the same room as one
 * along the bottom, just in another direction, so the direction is
 * read off the rail's own edge (see `sideFor`).
 *
 * Hovering a menu tile fans a flyout out of the rail:
 *
 *   ┌──────────────────────────────┐
 *   │ ◈  Appearance                │   ← head: the tile, restated
 *   ├──────────────────────────────┤
 *   │ 1 OPEN WINDOW                │
 *   │ ● Appearance          Open   │   ← live instances, click to focus
 *   ├──────────────────────────────┤
 *   │ OPEN                         │
 *   │ ◦ Themes                     │   ← the menu's own page, first
 *   │ ◦ Customize                  │
 *   │ ◦ Menus                      │
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
 * 2. **It owns the hover gesture on any tile with a menu.** `dock-peek`
 *    stands down for them, and the dock tooltip is suppressed by CSS
 *    while the flyout is open, because the head already says the
 *    tile's name — louder, and in the right place. That is every menu
 *    tile, plus the system tiles that declared a `submenu` of their
 *    own; every other system tile keeps the peek.
 *
 *    A system tile's menu is a list of ACTIONS rather than admin
 *    pages, but it wears the same three sections. What differs is only
 *    what fills them: no landing page behind the head, so it runs the
 *    first row, and its live windows come from the rows' `windowId`.
 *    See `ConstellationMenu`, which is what the panel builder takes.
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
import type { DockItem, SubmenuItem, SystemDockItem } from '../dock';
import type { Window as OsWindow } from '../window';
import { hashTitleToHue } from '../ui/util/hash-hue';
import { deriveWindowId, sanitizeClassName } from '../utils';
import { applyIconMask } from '../desktop-themes/paint-tinted-icon';
import { CONSTELLATION_FLAG } from './active';
// Leaf module, not `../item-visibility-menu` — that entry is a lazy
// bundle and importing the string from it drags the whole menu into
// `desktop.min.js`.
import { ITEM_MENU_OPENING_EVENT } from '../item-visibility-menu-events';
import {
	openMenuItem,
	openSubmenuItem,
	type ConstellationRouting,
} from './routing';

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
/** Gap between the tile's near edge and the panel's facing edge. */
const BEAM_GAP_PX = 14;
/**
 * How far the beam is held off either end of a side panel. The
 * surface's corner radius plus a little, so the thread never lands on
 * the curve it would have to cross.
 */
const BEAM_INSET_PX = 18;
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

/** Which side of its tile a panel fans out on. */
type ConstellationSide = 'top' | 'left' | 'right';

/**
 * The key identifying a tile's flyout: its menu slug, or the system
 * tile id for an action menu. `''` for a tile with no flyout at all.
 *
 * One key rather than two so the "is this the panel already up?"
 * comparisons stay a single string compare, and so a menu slug can
 * never collide with a system id in that comparison without the two
 * tiles genuinely being the same tile.
 */
const keyOf = ( tile: HTMLElement ): string =>
	tile.dataset.menuSlug ?? tile.dataset.constellationId ?? '';

/**
 * The direction this tile's flyout fans out in.
 *
 * Read off the RAIL, not off the layout. One layout can put two rails
 * on two edges — Split runs core menus down the left and plugins
 * along the bottom — and each of them has room in its own direction,
 * so a per-layout answer would be wrong for one of the two rails on
 * the same screen.
 *
 * The mapping is just "away from the edge the rail is on": a bottom
 * rail fans up, a left rail fans right, a right rail fans left.
 * Anything else (no placement attribute, an unrecognised value, a
 * tile a plugin parked outside a rail) falls back to up, which is the
 * only direction guaranteed to have somewhere to go.
 */
const sideFor = ( tile: HTMLElement ): ConstellationSide => {
	const placement = tile
		.closest< HTMLElement >( '.os-dock' )
		?.getAttribute( 'data-os-dock-placement' );
	if ( placement === 'left' ) {
		return 'right';
	}
	if ( placement === 'right' ) {
		return 'left';
	}
	return 'top';
};

/**
 * The arrow that fans the flyout open from a focused tile: the one
 * pointing at where the panel will appear. On a vertical rail Up and
 * Down are already spoken for — they walk the rail — so opening on Up
 * there would fight the rail's own roving.
 */
const OPEN_KEY: Readonly< Record< ConstellationSide, string > > = {
	top: 'ArrowUp',
	right: 'ArrowRight',
	left: 'ArrowLeft',
};

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
	/**
	 * Look up a registered system tile, read fresh on every hover for
	 * the same reason. Only the ones carrying a `submenu` ever reach
	 * the flyout; the rest keep the hover-peek. Optional, so a rail
	 * mounted without system tiles needs no stub.
	 */
	getSystemItem?: ( id: string ) => SystemDockItem | null;
}

/**
 * A menu the flyout can paint, from either of the two tile families.
 *
 * The panel is mostly the same either way — a hue, a group of rows,
 * the sheen and the beam. What differs is everything that assumes a
 * WordPress admin page behind the tile: `menuItem` is that page when
 * there is one, and `null` for a system tile's action menu, which has
 * no landing page to head the panel with, no windows to list under it
 * and nothing to open another of.
 */
export interface ConstellationMenu {
	/** Menu slug, or the system tile id for an action menu. */
	id: string;
	title: string;
	icon: string;
	submenu: SubmenuItem[];
	menuItem: DockItem | null;
}

/**
 * Context handed to the {@link HOOKS.CONSTELLATION_PANEL} filter.
 *
 * @public
 */
export interface ConstellationPanelContext {
	/**
	 * The menu the flyout was opened for. `item.menuItem` is the
	 * `DockItem` behind it, or `null` when the tile is a system tile
	 * whose submenu is a list of actions rather than admin pages.
	 */
	item: ConstellationMenu;
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
	 * Resolve the tile an event landed on, or null when the event has
	 * nothing to do with us. Guards on the tile having a menu to fan
	 * out — a menu slug, or a system tile that declared a submenu;
	 * every other system tile keeps the hover-peek — and on the tile
	 * living on a rail rather than in some plugin's own markup.
	 */
	const tileFrom = ( target: EventTarget | null ): HTMLElement | null => {
		if ( ! ( target instanceof Element ) ) {
			return null;
		}
		const tile = target.closest< HTMLElement >( '.os-dock__item' );
		if ( ! tile || ! keyOf( tile ) ) {
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
			menuSlug: previousAnchor ? keyOf( previousAnchor ) : '',
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
		const slug = keyOf( tile );
		if ( panel && anchorSlug === slug ) {
			if ( focusFirst ) {
				focusRow( panel, 0 );
			}
			return;
		}
		const item = resolveMenu( deps, tile );
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

		const instances = instancesFor( deps, item );
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
		/*
		 * The side goes on BEFORE the panel enters the document, and
		 * that ordering is load-bearing.
		 *
		 * `data-os-cn-side` selects the panel's entire transform. Set
		 * after the append, it changes a transform the element has
		 * already resolved — and `inheritShellVars` below reads
		 * computed style, which makes that resolution a real
		 * before-change style rather than a discardable first one. The
		 * change then TRANSITIONS: the panel spends the whole entrance
		 * sliding diagonally from where a bottom-rail panel would sit
		 * to where its own geometry puts it, on top of the scale it is
		 * supposed to be playing. Set before the append, there is
		 * nothing to transition from and the panel is simply born the
		 * right shape.
		 */
		panel.dataset.osCnSide = sideFor( tile );
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
		if ( panel && anchorSlug === keyOf( tile ) ) {
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
		// On a tile: the arrow pointing at where the panel will appear
		// fans the constellation out. See `OPEN_KEY`.
		const tile = tileFrom( e.target );
		if ( ! tile ) {
			return;
		}
		if ( e.key === OPEN_KEY[ sideFor( tile ) ] ) {
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

	/**
	 * A click on a dock tile dismisses the flyout.
	 *
	 * The panel is built once, on hover, and never repaints — so
	 * anything the click changes leaves it describing a state that has
	 * passed. Clicking the System tile while its own Preferences window
	 * is minimized restores that window, and the panel goes on
	 * reporting it as minimized underneath.
	 *
	 * Rows dismiss themselves before acting; this is the tile, which
	 * the constellation does not otherwise hear about. Clicks INSIDE
	 * the panel are left alone, so a plugin's own row keeps whatever
	 * behaviour it wired.
	 */
	const onClick = ( e: MouseEvent ): void => {
		if ( ! panel || ! ( e.target instanceof Element ) ) {
			return;
		}
		if ( panel.contains( e.target ) ) {
			return;
		}
		if ( e.target.closest( '.os-dock__item' ) ) {
			close();
		}
	};

	// Tells `dock-peek` there is a flyout to stand down for. See
	// `active.ts` — the flag is the mount, not the layout.
	document.body.setAttribute( CONSTELLATION_FLAG, '' );
	document.addEventListener( 'pointerover', onPointerOver );
	document.addEventListener( 'pointerout', onPointerOut );
	document.addEventListener( 'click', onClick );
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
		document.body.removeAttribute( CONSTELLATION_FLAG );
		document.removeEventListener( ITEM_MENU_OPENING_EVENT, onInvalidate );
		document.removeEventListener( 'pointerover', onPointerOver );
		document.removeEventListener( 'pointerout', onPointerOut );
		document.removeEventListener( 'click', onClick );
		document.removeEventListener( 'keydown', onKeyDown );
		window.removeEventListener( 'resize', onInvalidate );
		window.removeEventListener( 'blur', onInvalidate );
		document.removeEventListener( 'os-layout-changed', onInvalidate );
		document.removeEventListener( 'scroll', onInvalidate, true );
	};
}

/**
 * The menu a tile fans out, from whichever family it belongs to.
 *
 * Menu tiles win the lookup: a system tile is only consulted when the
 * tile carries no `data-menu-slug` at all, so a plugin that somehow
 * sets both still gets the admin-menu reading it would have had.
 */
function resolveMenu(
	deps: DockConstellationDeps,
	tile: HTMLElement,
): ConstellationMenu | null {
	const slug = tile.dataset.menuSlug;
	if ( slug ) {
		const item = deps.getMenuItems().find( ( i ) => i.id === slug );
		if ( ! item ) {
			return null;
		}
		// The menu's own page comes first — "All Posts" ahead of the
		// rest of the Posts submenu, exactly as wp-admin lists it. The
		// payload strips that entry out of `submenu` (see
		// `DockItem.selfLabel`) because the tab strip and the
		// right-click popover need that list to be child links only, so
		// it is put back here rather than there. A list of a menu's
		// pages that omits its main page reads as a bug.
		const submenu = item.selfLabel
			? [ { title: item.selfLabel, url: item.url }, ...item.submenu ]
			: item.submenu;
		return {
			id: item.id,
			title: item.title,
			icon: item.icon,
			submenu,
			menuItem: item,
		};
	}

	const id = tile.dataset.constellationId;
	if ( ! id ) {
		return null;
	}
	const sys = deps.getSystemItem?.( id );
	if ( ! sys?.submenu?.length ) {
		// The tile declared a flyout when it was built and the item has
		// since lost it (a live re-register with a shorter menu). No
		// panel rather than an empty one.
		return null;
	}
	return {
		id: sys.id,
		title: sys.title,
		icon: sys.icon,
		submenu: sys.submenu,
		menuItem: null,
	};
}

/**
 * The live windows a menu currently has open, on the active desktop.
 *
 * An admin menu has one key and possibly several windows under it. An
 * action menu has no key of its own — it is not a page — so it asks
 * its ROWS instead: each row that opens a window declares which one
 * (`SubmenuItem.windowId`), and the menu's instances are the union.
 * That is what lets the System tile show its open Preferences window
 * in the same place, and read the same way, as Appearance does.
 *
 * Deduped by window, because two rows may legitimately point at one
 * (a menu offering both "Settings" and "Settings → Appearance").
 */
function instancesFor(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
): OsWindow[] {
	const seen = new Set< OsWindow >();

	if ( item.menuItem ) {
		const baseId = resolveBaseId( deps, item.menuItem );
		for ( const win of deps.windowManager.getAllByBaseIdOnActiveDesktop(
			baseId,
		) ) {
			seen.add( win );
		}
		// Plus the windows opened FROM this menu — a post editor is
		// keyed on `post-new.php`, never on the Posts menu's own
		// `edit.php`, so the base-id lookup alone reports "no open
		// windows" while the editor the user just opened from this very
		// flyout sits on screen. `parentUrl` is what ties it back.
		const parentKey = deriveWindowId( item.menuItem.url, deps.adminUrl );
		if ( parentKey ) {
			const activeDesktop = deps.windowManager.getActiveDesktopId();
			for ( const win of deps.windowManager.getAll() ) {
				if (
					( win.config.desktopId || activeDesktop ) !== activeDesktop
				) {
					continue;
				}
				if (
					win.config.parentUrl &&
					deriveWindowId( win.config.parentUrl, deps.adminUrl ) ===
						parentKey
				) {
					seen.add( win );
				}
			}
		}
		return Array.from( seen );
	}

	for ( const sub of item.submenu ) {
		if ( ! sub.windowId ) {
			continue;
		}
		for ( const win of deps.windowManager.getAllByBaseIdOnActiveDesktop(
			sub.windowId,
		) ) {
			seen.add( win );
		}
	}
	return Array.from( seen );
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
	item: ConstellationMenu,
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

	// One shape for both families of menu: the tile it belongs to, the
	// windows it already has open, and the things it can open. What
	// differs between an admin menu and a system tile's action menu is
	// only what fills those sections, never which sections exist.
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
	item: ConstellationMenu,
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
	head.appendChild( text );

	// No page count under the title, and no chevron beside it. The
	// count was a number the reader had no use for — the rows are
	// right there and countable — and the chevron read as "there is
	// another level behind me", the one thing the head does NOT do.
	// The row's own hover state is the whole affordance.

	head.addEventListener( 'click', () => {
		dismiss();
		if ( item.menuItem ) {
			openMenuItem( deps, item.menuItem );
			return;
		}
		// An action menu has no landing page, so the head does what
		// its first row does — the same thing the tile's own click
		// does, and the reason a keyboard user is never stranded.
		runRow( deps, item, item.submenu[ 0 ] );
	} );

	return head;
}

/**
 * Activate one row: its callback, its window route, or its URL.
 *
 * Shared by the rows themselves and by an action menu's head, which
 * stands in for its first row.
 */
function runRow(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	sub: SubmenuItem | undefined,
): void {
	if ( ! sub ) {
		return;
	}
	if ( sub.onSelect ) {
		sub.onSelect();
		return;
	}
	if ( item.menuItem ) {
		openSubmenuItem( deps, item.menuItem, sub );
		return;
	}
	if ( sub.url ) {
		// An action menu has no window routing behind it, so a row
		// that is only a URL is a link out — which is exactly what
		// the row that needs this ("View site") means by it.
		window.open( sub.url, '_blank', 'noopener,noreferrer' );
	}
}

/** Live windows for this menu, newest chrome first. */
function buildInstancesGroup(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
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
	item: ConstellationMenu,
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
	item: ConstellationMenu,
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

	// An off-site row can't become a window — clicking it hands the URL
	// to the browser. Say so before the click, not after it.
	if ( sub.external ) {
		const mark = document.createElement( 'span' );
		mark.className = 'dashicons dashicons-external os-constellation__row-external';
		mark.setAttribute( 'aria-hidden', 'true' );
		row.appendChild( mark );
		row.setAttribute(
			'aria-label',
			// translators: %s is the submenu entry's label (e.g. "Documentation")
			sprintf( __( '%s (opens in a new tab)' ), sub.title ),
		);
	}

	row.addEventListener( 'click', () => {
		dismiss();
		runRow( deps, item, sub );
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
	// Data URIs and URLs are painted as a mask filled with
	// `currentColor`, the same way the dock paints them — the head has
	// to wear the art its TILE wears. Falling through to the dashicon
	// branch instead put a generic cog on every tile whose icon is
	// drawn rather than named, which is all of the shell's own.
	if ( ! icon.startsWith( 'dashicons-' ) ) {
		const masked = document.createElement( 'span' );
		masked.className = 'os-constellation__head-art';
		if ( applyIconMask( masked, icon, 'currentColor' ) ) {
			return masked;
		}
	}

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
 * Anchor the panel beside its tile, on whichever side the rail leaves
 * free, then cap it to the room there and nudge it back inside the
 * viewport along the one axis it can move on.
 *
 * The two axes are never symmetrical, and which is which depends on
 * the side.
 *
 * **The free axis is the one running ALONG the rail.** Sliding the
 * panel that way costs nothing: it still sits beside its tile, and
 * the beam compensates by the same amount (`--os-cn-beam-x` above a
 * bottom rail, `--os-cn-beam-y` beside a vertical one) so the thread
 * stays pointed at the tile whatever the clamp did.
 *
 * **The axis facing the rail cannot be nudged at all.** Moving the
 * panel that way would push it over the rail and under the pointer,
 * which is worse than the overflow. So the size is capped instead:
 * `--os-cn-max-h` is the room the panel actually has, and the surface
 * reads it as a `max-height`. A menu too tall for the space shrinks
 * to fit and its submenu group takes the scroll — which is why the
 * group is the flex item that shrinks, not the head or the
 * new-window row.
 *
 * Above a bottom rail those are the same statement as before: free
 * horizontally, capped by the distance up to the top of the viewport.
 *
 * **Beside a vertical rail the panel is top-aligned with its tile,
 * not centred on it**, and that is the whole difference between a
 * flyout and a panel that has come loose. A rail is as tall as the
 * screen and a menu can be 400px of it: centring the FIRST tile's
 * panel on a tile 24px down the rail puts most of it above the top of
 * the viewport, and the clamp then has to shove it back down by
 * hundreds of pixels, landing it beside the fifth tile with a beam
 * pointing off its own edge. Top-aligned, the common case needs no
 * clamp at all, and the beam meets the panel where the tile actually
 * is.
 *
 * The beam is what carries the anchoring here, so it is positioned
 * from the TILE (`--os-cn-beam-y`, the tile's centre measured from
 * the panel's top edge) rather than pinned to the panel's middle,
 * and it is where the entrance grows from. Clamped to stay a corner
 * radius clear of both ends so it never draws on the rounded corner
 * it would have to cross.
 */
function position( panel: HTMLElement, tile: HTMLElement ): void {
	const rect = tile.getBoundingClientRect();
	// Already on the panel — `open()` stamps it before the append, and
	// the note there says why it cannot wait until here.
	const side = sideFor( tile );

	// `MIN_PANEL_HEIGHT_PX` is a floor rather than a hard truth: on a
	// viewport so short that even that doesn't fit, a panel that
	// overflows slightly beats one collapsed to a sliver.
	const available =
		side === 'top'
			? rect.top - BEAM_GAP_PX - VIEWPORT_MARGIN_PX
			: window.innerHeight - VIEWPORT_MARGIN_PX * 2;
	panel.style.setProperty(
		'--os-cn-max-h',
		`${ Math.max( MIN_PANEL_HEIGHT_PX, available ) }px`,
	);

	if ( side !== 'top' ) {
		panel.style.left =
			side === 'right'
				? `${ rect.right + BEAM_GAP_PX }px`
				: `${ rect.left - BEAM_GAP_PX }px`;

		/*
		 * Measured now rather than in a frame's time, and with
		 * `offsetHeight` rather than a rect: layout is available the
		 * moment the panel is in the document, and offset sizes ignore
		 * the entrance transform, which a rect does not. Clamping
		 * against a rect measured mid-scale would answer a question
		 * about a box the user never sees.
		 */
		const height = panel.offsetHeight;
		const vh = window.innerHeight;
		const top = Math.max(
			VIEWPORT_MARGIN_PX,
			Math.min( rect.top, vh - VIEWPORT_MARGIN_PX - height ),
		);
		panel.style.top = `${ top }px`;
		// The beam meets the panel level with the tile's centre, held
		// clear of both rounded ends.
		const beamY = Math.max(
			BEAM_INSET_PX,
			Math.min(
				rect.top + rect.height / 2 - top,
				height - BEAM_INSET_PX,
			),
		);
		panel.style.setProperty( '--os-cn-beam-y', `${ beamY }px` );
		return;
	}

	panel.style.left = `${ rect.left + rect.width / 2 }px`;
	panel.style.top = `${ rect.top - BEAM_GAP_PX }px`;

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

