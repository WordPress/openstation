/**
 * OpenStation — the window tab strip's own behaviour.
 *
 * Everything in here is pure DOM: it takes elements, not `Window`
 * instances. That is deliberate. `tabs.ts` reaches for the toast
 * layer and the iframe helpers, so a feature bundle that only wants
 * to declare a few tabs (OpenStation Preferences, any native window)
 * would drag all of it in. This module imports nothing, so it costs
 * a feature bundle almost nothing to use.
 *
 * Three concerns live together because they are one concern from the
 * user's side: where the active surface sits, which tab the keyboard
 * is on, and which pane is showing.
 *
 * ## Tab kinds
 *
 * Every tab in a strip is a `role="tab"` button carrying `data-kind`:
 *
 * - `submenu` — swaps the window's iframe URL. Built in `dom.ts`.
 * - `main` / `external` — the primary iframe and plugin-opened
 *   sub-iframes. Owned by `tabs.ts`.
 * - `panel` — shows a sibling `<os-tabpanel>` in the window body.
 *   Native windows only, and the reason this module exists.
 *
 * The keyboard and the roving tabindex are generic over all four:
 * one strip is one tablist however its tabs were built.
 */

/** A tab that shows a pane in the window body rather than navigating. */
export interface PanelTabEntry {
	/** Matches the `for` attribute of the `<os-tabpanel>` it shows. */
	value: string;
	/** Visible label. */
	label: string;
}

/** Fired on the window element whenever a panel tab is activated. */
export const PANEL_TAB_CHANGE_EVENT = 'os-window-tab-change';

/** Every tab in the strip, in DOM order. */
function tabsIn( strip: HTMLElement ): HTMLElement[] {
	return Array.from(
		strip.querySelectorAll< HTMLElement >( '.os-window__tab' ),
	);
}

/**
 * ARIA ids, derived from the window's own id so they survive a
 * re-render. Window roots are named `wp-window-<id>` by the shell, so
 * this is unique per document without a counter.
 *
 * Tab values may be namespaced `vendor/name` (see
 * `openstation_register_window_tab()`), and a slash is legal in an id
 * but not in a bare CSS selector. These ids are only ever used as
 * attribute VALUES (`aria-controls`, `aria-labelledby`) and resolved
 * with `getElementById`, so slugifying is belt-and-braces rather than
 * load-bearing.
 */
function slug( value: string ): string {
	return value.replace( /[^a-zA-Z0-9_-]/g, '-' );
}

function tabId( winEl: HTMLElement, value: string ): string {
	return `${ winEl.id || 'os-window' }-tab-${ slug( value ) }`;
}

function panelId( winEl: HTMLElement, value: string ): string {
	return `${ winEl.id || 'os-window' }-panel-${ slug( value ) }`;
}

/**
 * Sit the plate — the active tab's surface — onto the active tab.
 *
 * The plate is one element that travels rather than a fill that
 * switches off on one tab and on at the next, so this is the only
 * thing that has to know where the active tab IS. It publishes three
 * custom properties and lets CSS animate them.
 *
 * Published on the STRIP, not the plate: the rail that traces the
 * page's top edge is the strip's own `::before`, and custom
 * properties inherit downward only, so a value set on the plate would
 * be invisible to its parent. The plate reads all three by
 * inheritance, so one write serves both halves of the line.
 *
 * Two things are load-bearing:
 *
 * 1. **`offsetLeft`, not `getBoundingClientRect()`.** The plate is an
 *    absolutely-positioned child of the strip, which is itself the
 *    scroll container — so it scrolls WITH the tabs, and its geometry
 *    has to be in the strip's own scrolled coordinate space. A
 *    viewport-relative rect would drift by exactly `scrollLeft` the
 *    moment a long strip is scrolled.
 * 2. **`data-placed` gates the transition.** Without it the plate
 *    animates in from the strip's left edge every time a window
 *    opens, because the first measurement is a change from zero.
 *
 * With no active tab — `syncActiveTab` can land on a URL matching
 * nothing, and foregrounding an external sub-tab deactivates every
 * submenu tab — the plate keeps its last geometry and fades out, so
 * re-activating does not read as it flying in from nowhere.
 */
export function positionTabPlate( strip: HTMLElement ): void {
	const plate = strip.querySelector< HTMLElement >(
		'.os-window__tab-plate',
	);
	if ( ! plate ) {
		return;
	}
	const active = strip.querySelector< HTMLElement >(
		'.os-window__tab--active',
	);
	if ( ! active ) {
		plate.dataset.empty = '';
		strip.dataset.tabPlateEmpty = '';
		return;
	}
	delete plate.dataset.empty;
	delete strip.dataset.tabPlateEmpty;
	strip.style.setProperty( '--_tab-plate-x', `${ active.offsetLeft }px` );
	strip.style.setProperty( '--_tab-plate-w', `${ active.offsetWidth }px` );
	strip.style.setProperty( '--_tab-strip-w', `${ strip.clientWidth }px` );
	// Only now may it animate. A width of 0 means layout has not run
	// yet (the first frame of a window being assembled), and placing
	// the plate off that measurement would teach it a wrong origin to
	// travel from.
	if ( active.offsetWidth > 0 ) {
		plate.dataset.placed = '';
	}
}

/**
 * Roving tabindex: exactly one tab in the strip is in the page's tab
 * order, and it is the active one.
 *
 * Without this a strip of twelve sub-pages is twelve stops on the way
 * to the window's content, which is the failure mode the tablist
 * pattern exists to prevent. Tab enters the strip once, arrows move
 * within it, Tab leaves.
 *
 * Called from the strip's existing observer alongside
 * {@link positionTabPlate}, so every place that toggles the active
 * class gets this for free and none of them has to know it exists.
 * That observer filters attributes to `class`, which is what keeps
 * the `tabindex` writes below from being seen as a change and
 * rescheduling forever.
 */
export function syncTabRoving( strip: HTMLElement ): void {
	const tabs = tabsIn( strip );
	if ( tabs.length === 0 ) {
		return;
	}
	const active =
		tabs.find( ( t ) => t.classList.contains( 'os-window__tab--active' ) ) ??
		tabs[ 0 ];
	for ( const tab of tabs ) {
		const next = tab === active ? 0 : -1;
		// Only write on change: the strip's observer is watching this
		// subtree, and a no-op write is still a mutation record.
		if ( tab.tabIndex !== next ) {
			tab.tabIndex = next;
		}
	}
}

/**
 * Arrow / Home / End move focus within the strip.
 *
 * Activation stays MANUAL: focus moves, and the tab is chosen with
 * Enter, Space or a click. `<button>` fires `click` on both keys
 * already, so the strip's click handler is the whole activation path
 * and there is nothing to duplicate here.
 *
 * Manual rather than automatic because of what activation costs in
 * this strip. A submenu tab loads an admin page into the iframe, and
 * a panel tab can mount a pane that owns a canvas. Arrowing across
 * eight tabs to reach the ninth must not fire eight page loads on the
 * way past. The APG allows either, and names exactly this case as the
 * one where manual wins.
 *
 * Focus does NOT wrap at the ends. The strip scrolls, so wrapping
 * would fling it across its whole width in one keypress; Home and End
 * are the deliberate way to reach the ends.
 */
export function handleTabStripKeydown( strip: HTMLElement, e: Event ): void {
	const event = e as KeyboardEvent;
	if ( event.altKey || event.ctrlKey || event.metaKey ) {
		return;
	}
	const target = event.target as HTMLElement | null;
	const current = target?.closest< HTMLElement >( '.os-window__tab' );
	if ( ! current ) {
		return;
	}
	const tabs = tabsIn( strip );
	const index = tabs.indexOf( current );
	if ( index < 0 ) {
		return;
	}

	// A right arrow means "the tab drawn to the right", which is the
	// PREVIOUS one when the strip runs right-to-left.
	const rtl = getComputedStyle( strip ).direction === 'rtl';
	let next: HTMLElement | undefined;
	switch ( event.key ) {
		case 'ArrowRight':
			next = tabs[ rtl ? index - 1 : index + 1 ];
			break;
		case 'ArrowLeft':
			next = tabs[ rtl ? index + 1 : index - 1 ];
			break;
		case 'Home':
			next = tabs[ 0 ];
			break;
		case 'End':
			next = tabs[ tabs.length - 1 ];
			break;
		default:
			return;
	}
	if ( ! next || next === current ) {
		return;
	}
	event.preventDefault();
	current.tabIndex = -1;
	next.tabIndex = 0;
	next.focus();
	/*
	 * `nearest` on both axes: the strip may be scrolled, and bringing a
	 * tab into view must never scroll the desktop behind it.
	 *
	 * Guarded because jsdom does not implement it, the same way the
	 * observers elsewhere in the shell are guarded. Losing the scroll
	 * costs a test environment nothing; throwing here would take the
	 * whole keyboard down with it.
	 */
	next.scrollIntoView?.( { block: 'nearest', inline: 'nearest' } );
}

/** The panel tabs currently in the strip, keyed by value. */
function panelTabsIn( strip: HTMLElement ): Map< string, HTMLElement > {
	const found = new Map< string, HTMLElement >();
	for ( const tab of tabsIn( strip ) ) {
		if ( tab.dataset.kind === 'panel' && tab.dataset.panel ) {
			found.set( tab.dataset.panel, tab );
		}
	}
	return found;
}

/**
 * The `<os-tabpanel>` panes a strip's panel tabs show.
 *
 * Not `:scope > os-tabpanel`, because the panes are not always direct
 * children of the body: a server-registered window wraps them in an
 * `<os-stack>` for padding, and a plugin may nest them however it
 * likes. Depth is therefore not a usable signal, and OWNERSHIP is:
 * a pane belongs to this strip unless it is inside another tab group,
 * which is what a pane containing its own `<os-tabs>` switcher looks
 * like. Without that filter, opening a window whose pane holds a
 * nested tab group would hide half of that group's panes on the way
 * past.
 */
function panesIn( winEl: HTMLElement ): HTMLElement[] {
	const body = winEl.querySelector< HTMLElement >( '.os-window__body' );
	if ( ! body ) {
		return [];
	}
	return Array.from(
		body.querySelectorAll< HTMLElement >( 'os-tabpanel[ for ]' ),
	).filter(
		( pane ) => ! pane.parentElement?.closest( 'os-tabpanel, os-tabs' ),
	);
}

/**
 * Show one pane and hide the rest, and light its tab.
 *
 * Panes are toggled with `hidden` rather than re-rendered: a settings
 * pane can own a canvas or a live preview, and rebuilding it on every
 * tab change would throw that away and re-pay for it on the way back.
 */
export function activatePanelTab( winEl: HTMLElement, value: string ): void {
	const strip = winEl.querySelector< HTMLElement >( '.os-window__tabs' );
	if ( ! strip ) {
		return;
	}
	let matched = false;
	for ( const [ tabValue, tab ] of panelTabsIn( strip ) ) {
		const on = tabValue === value;
		matched = matched || on;
		tab.classList.toggle( 'os-window__tab--active', on );
		tab.setAttribute( 'aria-selected', on ? 'true' : 'false' );
	}
	if ( ! matched ) {
		return;
	}
	for ( const pane of panesIn( winEl ) ) {
		const on = pane.getAttribute( 'for' ) === value;
		pane.toggleAttribute( 'hidden', ! on );
		pane.setAttribute( 'aria-hidden', on ? 'false' : 'true' );
	}
	syncTabRoving( strip );
	positionTabPlate( strip );
	winEl.dispatchEvent(
		new CustomEvent( PANEL_TAB_CHANGE_EVENT, {
			bubbles: true,
			detail: { value },
		} ),
	);
}

/**
 * Declare (or re-declare) a native window's panel tabs.
 *
 * Reconciles by value rather than rebuilding the strip. A settings
 * window re-runs this whenever a plugin registers a tab live, and
 * rebuilding would drop keyboard focus out of the strip mid-arrow and
 * hand the plate a fresh element with no measurement, which it would
 * then slide in from the strip's left edge.
 *
 * Leaves every non-panel tab alone, so a window may carry both kinds.
 */
export function setPanelTabs(
	winEl: HTMLElement,
	entries: readonly PanelTabEntry[],
	activeValue?: string,
): void {
	const strip = winEl.querySelector< HTMLElement >( '.os-window__tabs' );
	if ( ! strip ) {
		return;
	}
	const existing = panelTabsIn( strip );
	const previouslyActive = Array.from( existing.entries() ).find( ( [ , t ] ) =>
		t.classList.contains( 'os-window__tab--active' ),
	)?.[ 0 ];

	// Tabs go after the plate, which is the strip's first child so it
	// paints beneath the labels.
	let after: Element | null = strip.querySelector(
		'.os-window__tab-plate',
	);

	for ( const entry of entries ) {
		let tab = existing.get( entry.value );
		if ( tab ) {
			existing.delete( entry.value );
		} else {
			const button = document.createElement( 'button' );
			// Not a submit button: a native window's body can contain a
			// form, and the default type would post it.
			button.type = 'button';
			tab = button;
			tab.className = 'os-window__tab';
			tab.dataset.kind = 'panel';
			tab.dataset.panel = entry.value;
			tab.setAttribute( 'role', 'tab' );
			tab.setAttribute( 'aria-selected', 'false' );
			tab.tabIndex = -1;
		}
		if ( tab.textContent !== entry.label ) {
			tab.textContent = entry.label;
		}
		tab.id = tabId( winEl, entry.value );
		tab.setAttribute( 'aria-controls', panelId( winEl, entry.value ) );
		// `insertBefore` with the node already in place is a move to
		// the same spot, which the DOM treats as a mutation. Skip it.
		if ( tab.previousElementSibling !== after ) {
			strip.insertBefore( tab, after ? after.nextSibling : strip.firstChild );
		}
		after = tab;
	}

	// Anything left in the map is a tab the caller dropped.
	for ( const stale of existing.values() ) {
		stale.remove();
	}

	// Pair each pane back to its tab for assistive tech.
	for ( const pane of panesIn( winEl ) ) {
		const value = pane.getAttribute( 'for' );
		if ( ! value ) {
			continue;
		}
		pane.id = panelId( winEl, value );
		pane.setAttribute( 'aria-labelledby', tabId( winEl, value ) );
	}

	/*
	 * An explicit `activeValue` wins: a caller passing one is making a
	 * choice, and second-guessing it would make "open on the About
	 * tab" impossible to express. With none, hold the user where they
	 * were, which is what a live re-declare needs — a plugin
	 * registering a tab must not snap the user back to the first one
	 * mid-action. First tab is the floor.
	 */
	const valid = ( v: string | undefined ): v is string =>
		v !== undefined && entries.some( ( e ) => e.value === v );
	const next = [ activeValue, previouslyActive, entries[ 0 ]?.value ].find(
		valid,
	);
	if ( next !== undefined ) {
		activatePanelTab( winEl, next );
	}
}
