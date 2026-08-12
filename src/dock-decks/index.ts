/**
 * OpenStation — dock decks.
 *
 * The bottom dock is a single horizontal pill, and a pill has a width.
 * A site with a dozen plugins overruns it, and the rail's answer used
 * to be a hidden horizontal scroll: tiles existed, but only if you
 * knew to swipe for them. Two faint dividers were the only hint that
 * the row had structure at all.
 *
 * A deck is one of those clusters, promoted from "a gap between tiles"
 * to "the thing the rail is currently showing". Exactly one deck is on
 * screen at a time; a strip of tabs at the leading edge of the pill
 * names it and offers the others. Three ship:
 *
 *   - **WordPress** — core admin menus (`isCore !== false`).
 *   - **Apps** — plugin-contributed menus (`isCore === false`).
 *   - **OpenStation** — every JS-registered system tile: OS Settings,
 *     the recycle bin, plugin-owned native windows, Exit OpenStation.
 *
 * Those three are exactly the three clusters the un-decked rail already
 * drew separators between, so nothing moves — the groups the user could
 * already see are simply the groups they can now switch between.
 *
 * **Decks are a bottom-rail affordance only.** A left or right rail
 * is a column with the shell's full height to spend and scrolls
 * honestly; folding it into decks would hide tiles that already fit.
 * `Dock` constructs this collaborator when its orientation is
 * `'bottom'` and destroys it on any flip away.
 *
 * **The rail degrades to its old self.** With fewer than two non-empty
 * decks there is nothing to switch between, so the tab strip is
 * removed and `data-os-deck-active` is cleared — a clean install with
 * no plugin menus paints exactly as it did before this module existed.
 *
 * Hiding a deck must not hide what it was trying to tell you, so a
 * tab carries the state of the tiles behind it: an accent dot when the
 * deck holds an open window, and the sum of its tiles' badges as a
 * number. See {@link DockDecks.refreshIndicators}.
 *
 * Public surface: the `os.dock.decks` filter (add, rename, reorder, or
 * drop a deck) and the `os.dock.deck-changed` action. Both documented
 * in `docs/dock-customization.md`.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import type {
	DockHookContextBase,
	DockItem,
	SystemDockItem,
} from '../dock';

/**
 * Where the active deck is remembered, per rail. The value is a JSON
 * object keyed by rail discriminator (`taskbar`, `dock`) so the two
 * rails a Classic layout puts on screen never fight over one slot.
 *
 * `desktop-mode-*` rather than `openstation-*`: web-storage keys are
 * frozen data — see the table in `AGENTS.md`.
 */
export const DOCK_DECK_STORAGE_KEY = 'desktop-mode-dock-deck';

/**
 * A deck: one named cluster of dock tiles, and the predicates that
 * decide which tiles belong to it.
 *
 * A deck with neither predicate matches nothing and is dropped as
 * empty — which is the sane reading of "a group with no membership
 * rule", not something worth an error.
 *
 * @public
 */
export interface DockDeck {
	/** Stable id. Persisted, and written to `data-os-deck`. */
	id: string;
	/** Tab label. Also the tab's accessible name. */
	label: string;
	/**
	 * Tab glyph — a dashicons class (`dashicons-admin-plugins`), or a
	 * URL / `data:` URI painted as a mask so it takes the tab's ink
	 * colour like every other dock glyph does.
	 */
	icon: string;
	/** Sort order along the strip. Lower is closer to the leading edge. */
	order: number;
	/** True when this menu tile belongs to this deck. */
	matchItem?: ( item: DockItem ) => boolean;
	/** True when this system tile belongs to this deck. */
	matchSystem?: ( item: SystemDockItem ) => boolean;
}

/**
 * Payload of the `os.dock.deck-changed` action.
 *
 * @public
 */
export interface DockDeckChangeContext extends DockHookContextBase {
	/** The deck now on screen. */
	deckId: string;
	/** The deck that just left, or `null` on the first paint. */
	previousDeckId: string | null;
	/**
	 * How the change was triggered. `'restore'` is the boot-time
	 * read of the persisted pick; `'auto'` is the follow-focus
	 * setting moving the rail on the user's behalf.
	 */
	reason: 'click' | 'keyboard' | 'wheel' | 'swipe' | 'restore' | 'auto';
}

/** What {@link DockDecks.sync} needs to see to partition the rail. */
export interface DockDeckSyncInput {
	items: DockItem[];
	tiles: ReadonlyMap< string, HTMLElement >;
	systemItems: SystemDockItem[];
	systemTiles: ReadonlyMap< string, HTMLElement >;
}

/** Wiring {@link DockDecks} takes from its host `Dock`. */
export interface DockDecksDeps {
	/** The dock element. Carries `data-os-deck-active`. */
	container: HTMLElement;
	/** `.os-dock__scroll` — where menu tiles live. */
	itemHost: HTMLElement;
	/** `.os-dock__pinned` — where system tiles live. */
	systemHost: HTMLElement;
	/** Rail discriminator, used as the persistence slot. */
	rail: string;
	/** Base for the hook payloads this module fires. */
	hookContext: () => DockHookContextBase;
	/**
	 * Anchor the rail's shared tooltip over an element. The strip
	 * borrows the dock's own tooltip rather than a native `title`:
	 * the tabs sit in the same row as the tiles, and one hover
	 * surface answering in two different visual languages an inch
	 * apart is the tell that a control was bolted on.
	 */
	showTooltip: ( el: HTMLElement, text: string ) => void;
	hideTooltip: () => void;
}

/** Read the live OS-settings snapshot, or `null` before boot finishes. */
function osSettings(): { dockFavorites?: string[] } | null {
	const w = window as unknown as {
		wp?: { os?: { getOsSettings?: () => { dockFavorites?: string[] } } };
	};
	try {
		return w.wp?.os?.getOsSettings?.() ?? null;
	} catch {
		return null;
	}
}

/**
 * The decks the shell ships. Built fresh on every call because the
 * labels are translated AND because Favorites reads live state — a
 * module-level constant would freeze both whatever locale happened to
 * load first and whatever the starred set was at boot.
 */
function builtInDecks(): DockDeck[] {
	// A Set, because this is consulted once per tile per partition
	// pass and the starred list can hold a few hundred ids.
	const favorites = new Set( osSettings()?.dockFavorites ?? [] );
	return [
		{
			id: 'favorites',
			label: __( 'Favorites' ),
			icon: 'dashicons-star-filled',
			// First on the strip, and first claim on every tile: a
			// starred tile is starred *instead of* living with its
			// provenance group, which is the entire point of starring
			// it. Empty until the user stars something, and a deck
			// matching nothing is dropped — so this costs a `Set`
			// lookup per tile and no pixels.
			order: 5,
			matchItem: ( item ) => favorites.has( item.id ),
			matchSystem: ( item ) => favorites.has( item.id ),
		},
		{
			id: 'wordpress',
			label: __( 'WordPress' ),
			icon: 'dashicons-wordpress-alt',
			order: 10,
			// `!== false`, not `=== true`: an item that never got the
			// server-side classification is core by default, which is
			// the same reading `Dock.render()`'s separator uses.
			matchItem: ( item ) => item.isCore !== false,
		},
		{
			id: 'apps',
			// "Plugins", not "Apps" — the id stays `apps` because it
			// is what the user's remembered deck is stored under and
			// what `os.dock.decks` subscribers match on. The label is
			// the part anyone reads, and next to WordPress, Favorites
			// and OpenStation it wants a word of comparable length;
			// "Apps" sat short enough in that row to read as a
			// different kind of thing.
			label: __( 'Plugins' ),
			icon: 'dashicons-admin-plugins',
			order: 20,
			matchItem: ( item ) => item.isCore === false,
		},
		{
			id: 'station',
			label: __( 'OpenStation' ),
			icon: 'dashicons-screenoptions',
			order: 30,
			matchSystem: () => true,
		},
	];
}

/** Read the whole persisted map, tolerating anything malformed. */
function readStore(): Record< string, string > {
	try {
		const raw = window.localStorage.getItem( DOCK_DECK_STORAGE_KEY );
		if ( ! raw ) {
			return {};
		}
		const parsed: unknown = JSON.parse( raw );
		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
			return {};
		}
		const out: Record< string, string > = {};
		for ( const [ key, value ] of Object.entries(
			parsed as Record< string, unknown >,
		) ) {
			if ( typeof value === 'string' ) {
				out[ key ] = value;
			}
		}
		return out;
	} catch {
		// Private-browsing quota errors and hand-edited values both
		// land here; an unremembered deck is a fine outcome for both.
		return {};
	}
}

function writeStore( rail: string, deckId: string ): void {
	try {
		const store = readStore();
		store[ rail ] = deckId;
		window.localStorage.setItem(
			DOCK_DECK_STORAGE_KEY,
			JSON.stringify( store ),
		);
	} catch {
		// Non-fatal — the deck simply won't survive a reload.
	}
}

/**
 * Whether the user has opted the rail into decks.
 *
 * Off by default: decking trades "every tile is on screen" for "the
 * rail fits", which is a good trade once you have the tiles to feel
 * the crowding and a bad one before then. The toggle lives in
 * OpenStation Preferences → Appearance → Dock groups and reaches here
 * as an attribute written by `OsSettings.apply()`, so a flip lands on
 * the live rail through the dispatcher's refresh without a rebuild.
 *
 * Absent attribute reads as off, which is also what the shell looks
 * like for the frame before the first `apply()` runs.
 */
function decksEnabled(): boolean {
	return (
		document.getElementById( 'os-shell' )?.getAttribute( 'data-os-decks' ) ===
		'1'
	);
}

/**
 * Whether the rail should move itself to the deck holding a newly
 * focused window.
 *
 * Off unless the user turned it on in OpenStation Preferences →
 * Appearance. The framework is a transport, not a UX policy maker
 * (see `docs/event-driven-framework.md`); a rail that reshuffles under
 * the pointer because a window took focus is exactly the kind of
 * heuristic that rule exists to keep out of the default. The setting
 * writes the attribute from `OsSettings.apply()`, so boot, every save
 * and the rollback after a failed save all land here.
 */
function followFocusEnabled(): boolean {
	return (
		document
			.getElementById( 'os-shell' )
			?.getAttribute( 'data-os-deck-follow-focus' ) === '1'
	);
}

/**
 * Paint a deck tab's glyph. Mirrors the tile-icon contract in a
 * deliberately small way: a `dashicons-*` class becomes a dashicon
 * span, anything else is treated as an image and painted as a mask so
 * it inherits the tab's `color` — which is what lets one tab go from
 * muted to Void-on-mesh when it becomes the active one.
 */
function buildDeckGlyph( icon: string ): HTMLElement {
	if ( icon.startsWith( 'dashicons-' ) ) {
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ icon }`;
		span.setAttribute( 'aria-hidden', 'true' );
		return span;
	}
	const span = document.createElement( 'span' );
	span.className = 'os-dock__deck-mask';
	span.setAttribute( 'aria-hidden', 'true' );
	span.style.setProperty( '--os-deck-mask', `url("${ icon }")` );
	return span;
}

/**
 * The deck controller for one bottom rail.
 *
 * Owns the tab strip and the `data-os-deck` stamps; owns nothing
 * about the tiles themselves. `Dock` keeps building tiles exactly as
 * it always did and calls {@link sync} afterwards — which is what
 * keeps the hover-peek, the constellation flyout, drag-reorder and
 * every decoration hook working untouched. Visibility is CSS, driven
 * by one attribute on the dock.
 */
export class DockDecks {
	private deps: DockDecksDeps;
	private strip: HTMLElement | null = null;
	/** Tab elements by deck id, for indicator updates without a re-query. */
	private tabs: Map< string, HTMLElement > = new Map();
	/** Decks that currently hold at least one tile, in strip order. */
	private live: DockDeck[] = [];
	private activeId: string | null = null;
	/** Set once the starting state has been painted — see `applyVisibility`. */
	private ready = false;
	/**
	 * Reentrancy guard. `setActive` repaints the tabs, repainting the
	 * tabs refreshes the indicators, and refreshing the indicators can
	 * trigger follow-focus — which calls `setActive`. The cycle does
	 * terminate on its own (the second pass finds the deck already
	 * active), but it runs the whole indicator sweep twice per switch
	 * for nothing.
	 */
	private inFollowFocus = false;
	/**
	 * Each tab's width WITH its label open, keyed by deck id. The
	 * plate is sized from this rather than from a live read, so a
	 * switch costs one write instead of a per-frame chase. Refreshed
	 * by {@link measureTabWidths} on every partition pass.
	 */
	private expanded: Map< string, number > = new Map();
	private detachers: Array< () => void > = [];

	constructor( deps: DockDecksDeps ) {
		this.deps = deps;
		this.bindGestures();
	}

	/** The deck currently on screen, or `null` while the rail is un-decked. */
	public getActive(): string | null {
		return this.activeId;
	}

	/**
	 * Re-partition the rail.
	 *
	 * Called after every path that can change what is on the rail:
	 * the constructor's first render, a live menu refresh
	 * (`replaceItems`), and system tiles arriving or leaving. Cheap
	 * enough to call unconditionally — the work is a walk of the tile
	 * list plus, when the set of non-empty decks actually changed, a
	 * rebuild of a three-button strip.
	 */
	public sync( input: DockDeckSyncInput ): void {
		// Opted out. Drop everything this module has put on the rail
		// and leave — including the stamps, or two thirds of the tiles
		// stay hidden behind a feature that is no longer on.
		if ( ! decksEnabled() ) {
			this.teardownStrip();
			this.activeId = null;
			delete this.deps.container.dataset.osDeckActive;
			this.stampNone( input );
			this.applyVisibility();
			return;
		}

		const ctx = this.deps.hookContext();
		const decks = applyFilters< DockDeck[] >(
			HOOKS.DOCK_DECKS,
			builtInDecks(),
			ctx,
		)
			.filter( ( deck ) => !! deck && typeof deck.id === 'string' )
			.slice()
			.sort( ( a, b ) => ( a.order ?? 0 ) - ( b.order ?? 0 ) );

		// Stamp every tile with the first deck that claims it. First
		// rather than last so a plugin prepending a narrower deck
		// (order 5, "Favourites") wins the tiles it names without
		// having to also rewrite the built-ins' predicates.
		const populated = new Set< string >();

		const stamp = (
			el: HTMLElement | undefined,
			deckId: string | null,
		): void => {
			if ( ! el ) {
				return;
			}
			if ( deckId ) {
				el.dataset.osDeck = deckId;
				populated.add( deckId );
			} else {
				delete el.dataset.osDeck;
			}
		};

		for ( const item of input.items ) {
			const deck = decks.find( ( d ) => d.matchItem?.( item ) === true );
			stamp( input.tiles.get( item.id ), deck ? deck.id : null );
		}
		for ( const item of input.systemItems ) {
			const deck = decks.find( ( d ) => d.matchSystem?.( item ) === true );
			stamp( input.systemTiles.get( item.id ), deck ? deck.id : null );
		}

		this.live = decks.filter( ( d ) => populated.has( d.id ) );

		// Nothing to switch between — take the whole affordance off
		// screen and let the rail be what it was.
		if ( this.live.length < 2 ) {
			this.teardownStrip();
			this.activeId = null;
			delete this.deps.container.dataset.osDeckActive;
			this.applyVisibility();
			return;
		}

		this.buildStrip();
		// Re-read every tab's expanded width. `buildStrip` returns
		// early when the deck set is unchanged, but the tabs may still
		// have been re-laid out under it — a Dock size change, a new
		// locale, a theme's icon set — and the plate is sized from
		// these numbers.
		this.measureTabWidths();

		// Resolve the deck to show: the current one if it survived,
		// else the remembered one, else the leading deck.
		const remembered = readStore()[ this.deps.rail ];
		const next =
			( this.activeId &&
				this.live.some( ( d ) => d.id === this.activeId ) &&
				this.activeId ) ||
			( this.live.some( ( d ) => d.id === remembered ) && remembered ) ||
			this.live[ 0 ].id;

		if ( next !== this.activeId ) {
			// `persist: false` — this is the rail catching up with what
			// is on it (boot, or a deck emptied by a deactivation), not
			// the user picking. Writing here would overwrite their
			// remembered deck with a fallback they never chose.
			//
			// The boot paint doesn't animate either, but that is
			// `applyVisibility`'s job now (it suppresses transitions
			// for the first frame) rather than a flag threaded through
			// here — the tiles collapse and expand through CSS, so
			// there is no imperative entrance left to skip.
			this.setActive( next, 'restore', { persist: false } );
		} else {
			// Same deck, but tiles moved: freshly-rendered ones have
			// no visibility class yet, and the strip may have just
			// been rebuilt without its active state.
			this.applyVisibility();
			this.paintActiveTab();
		}
	}

	/**
	 * Show a deck.
	 *
	 * A no-op when the deck is already on screen or isn't currently
	 * live, so callers (gesture handlers, follow-focus, the settings
	 * round-trip) can fire freely without guarding.
	 */
	public setActive(
		deckId: string,
		reason: DockDeckChangeContext[ 'reason' ] = 'click',
		opts: { persist?: boolean } = {},
	): void {
		if ( deckId === this.activeId ) {
			return;
		}
		if ( ! this.live.some( ( d ) => d.id === deckId ) ) {
			return;
		}
		const previous = this.activeId;

		this.activeId = deckId;
		this.deps.container.dataset.osDeckActive = deckId;
		this.applyVisibility();
		this.paintActiveTab();

		if ( opts.persist !== false ) {
			writeStore( this.deps.rail, deckId );
		}

		doAction( HOOKS.DOCK_DECK_CHANGED, {
			...this.deps.hookContext(),
			deckId,
			previousDeckId: previous,
			reason,
		} as DockDeckChangeContext );
	}

	/**
	 * Move one deck along the strip. Does not wrap: the strip is three
	 * items long and wrapping past either end reads as a glitch rather
	 * than as navigation.
	 */
	public step( direction: 1 | -1, reason: DockDeckChangeContext[ 'reason' ] ): void {
		if ( ! this.activeId ) {
			return;
		}
		const at = this.live.findIndex( ( d ) => d.id === this.activeId );
		const next = at + direction;
		if ( at < 0 || next < 0 || next >= this.live.length ) {
			return;
		}
		this.setActive( this.live[ next ].id, reason );
	}

	/**
	 * Push the state of the hidden tiles onto their tabs.
	 *
	 * Called from `Dock.updateActiveStates()`, so it runs on exactly
	 * the events that can change what a tile is saying: window
	 * lifecycle, desktop switches, and the explicit
	 * `os.dock.refresh-active` escape hatch. Badges set through
	 * `Dock.setBadge()` land here too — that method repaints active
	 * states after mutating the badge node.
	 *
	 * Aggregate badges appear on INACTIVE tabs only. The active deck's
	 * tiles are on screen carrying their own counts, and a tab
	 * repeating their sum two inches away is the same number twice.
	 */
	public refreshIndicators(): void {
		if ( ! this.strip ) {
			return;
		}
		for ( const deck of this.live ) {
			const tab = this.tabs.get( deck.id );
			if ( ! tab ) {
				continue;
			}
			const tiles = this.tilesIn( deck.id );
			const hasOpen = tiles.some( ( t ) =>
				t.classList.contains( 'os-dock__item--active' ),
			);
			const hasFocused = tiles.some( ( t ) =>
				t.classList.contains( 'os-dock__item--focused' ),
			);
			tab.classList.toggle( 'os-dock__deck--has-open', hasOpen );
			tab.classList.toggle( 'os-dock__deck--has-focused', hasFocused );

			const total =
				deck.id === this.activeId
					? 0
					: tiles.reduce( ( sum, tile ) => {
						const badge = tile.querySelector< HTMLElement >(
							'.os-dock__badge',
						);
						const n = Number.parseInt(
							badge?.textContent ?? '',
							10,
						);
						return sum + ( Number.isFinite( n ) ? n : 0 );
					}, 0 );
			this.paintTabBadge( tab, total );
		}

		if ( ! this.inFollowFocus && followFocusEnabled() ) {
			this.inFollowFocus = true;
			try {
				this.followFocus();
			} finally {
				this.inFollowFocus = false;
			}
		}
	}

	/** Detach listeners and remove the strip. Idempotent. */
	public destroy(): void {
		for ( const off of this.detachers ) {
			off();
		}
		this.detachers = [];
		this.teardownStrip();
		this.activeId = null;
		this.live = [];
		// Clear the stamps before dropping the attribute: a rail that
		// flips to a vertical placement keeps its tiles, and a leftover
		// `--deck-off` would hide two thirds of them forever — and
		// leave them `inert`, which is the half that no amount of CSS
		// would put right.
		this.applyVisibility();
		delete this.deps.container.dataset.osDeckActive;
		delete this.deps.container.dataset.osDeckInit;
	}

	// -----------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------

	/**
	 * Strip every deck stamp. The visibility class is keyed off
	 * `activeId` and would already be clear, but `data-os-deck` is
	 * documented surface a plugin may be reading — leaving it behind
	 * on an opted-out rail would advertise a grouping that isn't
	 * happening.
	 */
	private stampNone( input: DockDeckSyncInput ): void {
		for ( const el of [
			...input.tiles.values(),
			...input.systemTiles.values(),
		] ) {
			delete el.dataset.osDeck;
		}
	}

	/**
	 * Put exactly one deck on screen.
	 *
	 * Done in JS rather than in a stylesheet because CSS cannot
	 * compare two attributes — there is no way to say "hide the tiles
	 * whose `data-os-deck` differs from the dock's
	 * `data-os-deck-active`" without writing one rule per deck id,
	 * which would work for the three built-ins and silently fail for
	 * every deck a plugin adds through the `os.dock.decks` filter.
	 *
	 * A tile with no deck stamp is always visible: it belongs to no
	 * group, so no group can be hiding it.
	 */
	private applyVisibility(): void {
		const all = [
			...this.deps.itemHost.querySelectorAll< HTMLElement >(
				'.os-dock__item',
			),
			...this.deps.systemHost.querySelectorAll< HTMLElement >(
				'.os-dock__item',
			),
		];
		for ( const tile of all ) {
			const deck = tile.dataset.osDeck;
			const off = !! this.activeId && !! deck && deck !== this.activeId;
			tile.classList.toggle( 'os-dock__item--deck-off', off );
			// A collapsed tile is zero pixels wide and fully
			// transparent, but its button is still a button — without
			// this, tabbing through the shell walks every tile on
			// every deck. `inert` rather than a CSS
			// `visibility: hidden`, which would have to be delayed
			// until the collapse finished and would tie this rule to
			// the duration token.
			tile.inert = off;
		}

		// The first partition is the rail's starting state, not a
		// switch. Suppressing transitions for one frame is what stops
		// the dock opening on every tile it has and then visibly
		// folding two thirds of them away.
		if ( ! this.ready ) {
			this.ready = true;
			this.deps.container.dataset.osDeckInit = '';
			const clear = (): void => {
				delete this.deps.container.dataset.osDeckInit;
			};
			if ( typeof requestAnimationFrame === 'function' ) {
				requestAnimationFrame( () => requestAnimationFrame( clear ) );
			} else {
				clear();
			}
		}
	}

	/** Every tile currently stamped for a deck, in DOM order. */
	private tilesIn( deckId: string ): HTMLElement[] {
		const selector = `.os-dock__item[data-os-deck="${ deckId }"]`;
		return [
			...this.deps.itemHost.querySelectorAll< HTMLElement >( selector ),
			...this.deps.systemHost.querySelectorAll< HTMLElement >( selector ),
		];
	}

	/**
	 * Build (or rebuild) the tab strip.
	 *
	 * Rebuilt wholesale rather than reconciled: it is at most a handful
	 * of buttons, it only changes when the set of non-empty decks
	 * changes, and a full rebuild is the version that cannot leave a
	 * stale tab behind after a plugin deactivation empties a deck.
	 */
	private buildStrip(): void {
		const signature = this.live.map( ( d ) => `${ d.id }:${ d.label }` ).join( '|' );
		if ( this.strip && this.strip.dataset.signature === signature ) {
			return;
		}
		this.teardownStrip();

		const strip = document.createElement( 'div' );
		strip.className = 'os-dock__decks';
		strip.dataset.signature = signature;
		strip.setAttribute( 'role', 'tablist' );
		strip.setAttribute( 'aria-orientation', 'horizontal' );
		strip.setAttribute( 'aria-label', __( 'Dock groups' ) );

		// The travelling selection. First child so it paints under the
		// tabs; `aria-hidden` because the selection it draws is
		// already stated by `aria-selected` on the tab it is under.
		const plate = document.createElement( 'div' );
		plate.className = 'os-dock__deck-plate';
		plate.setAttribute( 'aria-hidden', 'true' );
		strip.appendChild( plate );

		for ( const deck of this.live ) {
			const tab = document.createElement( 'button' );
			tab.type = 'button';
			tab.className = 'os-dock__deck';
			tab.dataset.deck = deck.id;
			tab.setAttribute( 'role', 'tab' );
			tab.setAttribute( 'aria-selected', 'false' );
			tab.tabIndex = -1;
			// The label is visible on the active tab and clipped to
			// zero width on the others, so it cannot be the accessible
			// name on its own — a collapsed label still needs to
			// announce. `aria-label` states it unconditionally and
			// `aria-hidden` on the visual span stops the duplicate.
			tab.setAttribute( 'aria-label', deck.label );
			// Which region of the rail this tab reveals. Menu decks
			// paint into the scroll wrapper, system decks into the
			// pinned one.
			// `matchItem` first: a deck that claims both cohorts
			// (Favorites does) paints most of itself into the menu
			// wrapper, so that is the region the tab reveals.
			const host = deck.matchItem
				? this.deps.itemHost
				: this.deps.systemHost;
			if ( host.id ) {
				tab.setAttribute( 'aria-controls', host.id );
			}

			tab.appendChild( buildDeckGlyph( deck.icon ) );
			const label = document.createElement( 'span' );
			label.className = 'os-dock__deck-label';
			label.textContent = deck.label;
			label.setAttribute( 'aria-hidden', 'true' );
			tab.appendChild( label );

			tab.addEventListener( 'click', () => {
				this.setActive( deck.id, 'click' );
				this.deps.hideTooltip();
				tab.focus();
			} );

			// Naming a collapsed tab. The nicer answer — reveal the
			// label under the pointer — is the one thing this strip
			// cannot do: the label is what makes the active tab wide,
			// so animating one open on hover would shove the whole
			// rail sideways under a pointer that is mid-click. The
			// active tab is already named and stays silent.
			tab.addEventListener( 'pointerenter', () => {
				if ( ! tab.classList.contains( 'os-dock__deck--active' ) ) {
					this.deps.showTooltip( tab, deck.label );
				}
			} );
			tab.addEventListener( 'pointerleave', () =>
				this.deps.hideTooltip(),
			);

			strip.appendChild( tab );
			this.tabs.set( deck.id, tab );
		}

		strip.addEventListener( 'keydown', ( e ) => this.onStripKeydown( e ) );

		const separator = document.createElement( 'div' );
		separator.className = 'os-dock__separator os-dock__separator--decks';
		separator.setAttribute( 'aria-hidden', 'true' );

		this.deps.container.insertBefore(
			separator,
			this.deps.container.firstChild,
		);
		this.deps.container.insertBefore( strip, separator );
		this.strip = strip;

		this.paintActiveTab();
	}

	private teardownStrip(): void {
		this.expanded.clear();
		this.strip?.remove();
		this.strip = null;
		this.tabs.clear();
		this.deps.container
			.querySelectorAll( ':scope > .os-dock__separator--decks' )
			.forEach( ( el ) => el.remove() );
	}

	/**
	 * Reflect the active deck onto the strip: `aria-selected`, the
	 * `--active` class the mesh hangs off, and the roving tabindex
	 * that keeps the strip a single stop on the way through the shell.
	 */
	private paintActiveTab(): void {
		// Where every tab sits right now, read before anything changes.
		// The slide below is measured against this.
		const before = new Map< HTMLElement, number >();
		const animate = this.strip?.dataset.platePlaced !== undefined;
		if ( animate ) {
			for ( const tab of this.tabs.values() ) {
				before.set( tab, tab.offsetLeft );
			}
		}

		for ( const [ id, tab ] of this.tabs ) {
			const on = id === this.activeId;
			tab.classList.toggle( 'os-dock__deck--active', on );
			tab.setAttribute( 'aria-selected', on ? 'true' : 'false' );
			tab.tabIndex = on ? 0 : -1;
			// The selected tab is ALWAYS the last one on the strip,
			// which is what puts it directly against the divider and
			// the row of icons it names. `order` rather than a DOM
			// move: the tabs stay in the document in their registered
			// sequence, so `aria-owns`-free tablist semantics, the
			// roving tabindex and every `querySelectorAll` on the
			// strip keep reading the canonical order. Only the paint
			// is rearranged.
			tab.style.order = on ? '1' : '0';
		}

		if ( animate ) {
			this.slideTabs( before );
		}
		this.syncPlate();
		this.refreshIndicators();
	}

	/**
	 * Slide the tabs to their new places.
	 *
	 * Standard FLIP: each tab is put back where it was with an inline
	 * transform and no transition, then released a frame later so the
	 * stylesheet's transition carries it home.
	 *
	 * The part worth knowing is that this stays correct even though
	 * the flow it is animating against is ITSELF still moving — the
	 * outgoing tab's label is collapsing and the incoming one's is
	 * unfurling for the whole `--os-dock-deck-slide`. A transform is
	 * relative to wherever flow puts the element, so the painted
	 * position is `flow(t) + Δ·(1 − ease(t))`: exactly the old spot at
	 * t=0, exactly the flow position at the end, and a blend of two
	 * smooth curves in between. Nothing has to be re-measured, and no
	 * layout is pinned.
	 *
	 * Skipped on the strip's first paint (the caller checks
	 * `data-plate-placed`), where there is no "before" worth sliding
	 * from and every tab would fly in from its unordered position.
	 */
	private slideTabs( before: ReadonlyMap< HTMLElement, number > ): void {
		const moved: Array< [ HTMLElement, number ] > = [];
		for ( const tab of this.tabs.values() ) {
			const dx = ( before.get( tab ) ?? tab.offsetLeft ) - tab.offsetLeft;
			if ( dx ) {
				moved.push( [ tab, dx ] );
			}
		}
		if ( moved.length === 0 ) {
			return;
		}
		for ( const [ tab, dx ] of moved ) {
			tab.style.transition = 'none';
			tab.style.transform = `translateX( ${ dx }px )`;
		}
		// One forced reflow for the whole set, not one per tab.
		void this.strip?.offsetWidth;
		for ( const [ tab ] of moved ) {
			// Clearing both inline values hands the tab back to the
			// stylesheet, which is where its transition lives.
			tab.style.transition = '';
			tab.style.transform = '';
		}
	}

	/**
	 * Measure what each tab is *going* to be, once, so that nothing
	 * has to chase it later.
	 *
	 * Every tab has two widths — collapsed, and expanded with its
	 * label — and only the expanded one matters to the plate. Reading
	 * it here, with the label reveal suppressed and before anything is
	 * moving, is what lets the plate be handed a single target per
	 * switch instead of a fresh one every frame.
	 *
	 * Cheap enough to redo on every partition pass, which is also the
	 * only way it stays right: the Dock size preference resizes every
	 * glyph, a locale change relabels every tab, a desktop theme swaps
	 * the icon set, and all three arrive through `sync()`.
	 */
	private measureTabWidths(): void {
		const strip = this.strip;
		if ( ! strip ) {
			return;
		}
		strip.dataset.deckMeasuring = '';
		for ( const [ id, tab ] of this.tabs ) {
			const wasActive = tab.classList.contains(
				'os-dock__deck--active',
			);
			tab.classList.add( 'os-dock__deck--active' );
			this.expanded.set( id, tab.offsetWidth );
			tab.classList.toggle( 'os-dock__deck--active', wasActive );
		}
		delete strip.dataset.deckMeasuring;
	}

	/**
	 * Point the plate at the active tab's final width.
	 *
	 * The plate does not move. Its trailing edge is pinned to the
	 * strip's by CSS and the selected tab is always the last one on
	 * the strip, so the only thing that differs between decks is how
	 * far its leading edge reaches — a shorter label, a shorter plate.
	 *
	 * ONE write per switch, to the measured final width, and the
	 * stylesheet's transition carries it there on the same curve the
	 * label unfurls on. This used to re-target every frame off the
	 * tab's live geometry, and that is what made it wobble: a 720ms
	 * curve restarting sixty times a second against a moving box is a
	 * chase, and a chase rubber-bands. The one thing on the rail that
	 * is meant to hold still looked like the least stable.
	 *
	 * `data-plate-placed` gates the transition, so the strip's first
	 * paint sizes the plate rather than growing it out of nothing.
	 */
	private syncPlate(): void {
		const strip = this.strip;
		if ( ! strip || ! this.activeId ) {
			return;
		}
		const w = this.expanded.get( this.activeId ) ?? 0;
		if ( w <= 0 ) {
			return;
		}
		strip.style.setProperty( '--_deck-plate-w', `${ w }px` );
		strip.dataset.platePlaced = '';
	}

	private paintTabBadge( tab: HTMLElement, count: number ): void {
		const existing = tab.querySelector< HTMLElement >(
			':scope > .os-dock__deck-badge',
		);
		if ( count <= 0 ) {
			existing?.remove();
			return;
		}
		const display = count > 99 ? '99+' : String( count );
		if ( existing ) {
			if ( existing.textContent !== display ) {
				existing.textContent = display;
			}
			return;
		}
		const badge = document.createElement( 'span' );
		badge.className = 'os-dock__deck-badge';
		badge.textContent = display;
		// Not announced: the tab's own `aria-label` names the deck,
		// and the count is restated by the tiles the moment the deck
		// is opened. A second live number here reads as noise.
		badge.setAttribute( 'aria-hidden', 'true' );
		tab.appendChild( badge );
	}

	/**
	 * Arrow / Home / End inside the strip, with AUTOMATIC activation.
	 *
	 * The opposite call from the window tab strip, and for the reason
	 * that one gives: activation there loads an admin page, so
	 * arrowing past eight tabs must not fire eight loads. Switching a
	 * deck toggles an attribute. Nothing is fetched, nothing is
	 * mounted, and manual activation would mean every keyboard user
	 * pressing Enter after every arrow for no benefit.
	 *
	 * Arrows walk the deck list's own order, not the painted one. The
	 * painted order moves the selected tab to the end, so "next" in
	 * visual terms would change meaning with every press — arrowing
	 * right twice could land you back where you started. The
	 * registered sequence is the stable mental model and it is what
	 * `aria-selected` and the DOM both report.
	 */
	private onStripKeydown( e: KeyboardEvent ): void {
		if ( e.altKey || e.ctrlKey || e.metaKey ) {
			return;
		}
		let target: string | null = null;
		switch ( e.key ) {
			case 'ArrowRight':
			case 'ArrowDown':
				this.step( 1, 'keyboard' );
				target = this.activeId;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				this.step( -1, 'keyboard' );
				target = this.activeId;
				break;
			case 'Home':
				target = this.live[ 0 ]?.id ?? null;
				if ( target ) {
					this.setActive( target, 'keyboard' );
				}
				break;
			case 'End':
				target = this.live[ this.live.length - 1 ]?.id ?? null;
				if ( target ) {
					this.setActive( target, 'keyboard' );
				}
				break;
			default:
				return;
		}
		e.preventDefault();
		if ( target ) {
			this.tabs.get( target )?.focus();
		}
	}

	/**
	 * Wheel and swipe across the rail.
	 *
	 * Both defer to a scrolling deck. A deck wide enough to overflow
	 * the pill still owns its horizontal scroll, and stealing that
	 * gesture would make the tiles past the edge unreachable by the
	 * only means that ever reached them — trading one hidden-tile
	 * problem for the same one.
	 */
	private bindGestures(): void {
		const { container, itemHost } = this.deps;

		const overflowing = (): boolean =>
			itemHost.scrollWidth - itemHost.clientWidth > 1;

		let wheelLock = 0;
		const onWheel = ( e: WheelEvent ): void => {
			if ( ! this.strip || overflowing() ) {
				return;
			}
			const delta =
				Math.abs( e.deltaX ) > Math.abs( e.deltaY ) ? e.deltaX : e.deltaY;
			if ( Math.abs( delta ) < 8 ) {
				return;
			}
			const now = e.timeStamp;
			// One deck per gesture. A trackpad flick delivers a long
			// tail of decaying deltas; without a lock a single swipe
			// would run the whole strip.
			if ( now - wheelLock < 420 ) {
				return;
			}
			wheelLock = now;
			e.preventDefault();
			this.step( delta > 0 ? 1 : -1, 'wheel' );
		};
		container.addEventListener( 'wheel', onWheel, { passive: false } );
		this.detachers.push( () =>
			container.removeEventListener( 'wheel', onWheel ),
		);

		let swipeFrom: { x: number; y: number; id: number } | null = null;
		const onDown = ( e: PointerEvent ): void => {
			if ( e.pointerType !== 'touch' || ! this.strip || overflowing() ) {
				swipeFrom = null;
				return;
			}
			swipeFrom = { x: e.clientX, y: e.clientY, id: e.pointerId };
		};
		const onUp = ( e: PointerEvent ): void => {
			if ( ! swipeFrom || e.pointerId !== swipeFrom.id ) {
				return;
			}
			const dx = e.clientX - swipeFrom.x;
			const dy = e.clientY - swipeFrom.y;
			swipeFrom = null;
			// Horizontal, and decisively so — a 48px drag that also
			// moved 40px vertically is someone scrolling the page.
			if ( Math.abs( dx ) < 48 || Math.abs( dx ) < Math.abs( dy ) * 1.5 ) {
				return;
			}
			this.step( dx < 0 ? 1 : -1, 'swipe' );
		};
		container.addEventListener( 'pointerdown', onDown );
		container.addEventListener( 'pointerup', onUp );
		container.addEventListener( 'pointercancel', onUp );
		this.detachers.push( () => {
			container.removeEventListener( 'pointerdown', onDown );
			container.removeEventListener( 'pointerup', onUp );
			container.removeEventListener( 'pointercancel', onUp );
		} );
	}

	/**
	 * Opt-in: move the rail to the deck holding the focused window.
	 *
	 * Reads the tiles' own `--focused` class rather than asking the
	 * window manager, so it stays true to whatever the dock decided
	 * "focused" means — including the id-derivation fallbacks in
	 * `updateActiveStates()` that a naive baseId lookup here would
	 * miss.
	 */
	private followFocus(): void {
		if ( ! this.activeId ) {
			return;
		}
		for ( const deck of this.live ) {
			if ( deck.id === this.activeId ) {
				continue;
			}
			const hit = this.tilesIn( deck.id ).some( ( t ) =>
				t.classList.contains( 'os-dock__item--focused' ),
			);
			if ( hit ) {
				this.setActive( deck.id, 'auto' );
				return;
			}
		}
	}
}
