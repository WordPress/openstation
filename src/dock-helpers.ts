/**
 * Composition helpers for custom dock rail renderers.
 *
 * The decoration hooks (`wp-desktop.dock.tile-class`, `tile-element`,
 * `tile-rendered`, `tile-tooltip`, `before-render`, `after-render`)
 * fire from inside the default `Dock` renderer's paint loop. A
 * custom rail renderer that doesn't call them silently breaks
 * decoration plugins. These helpers let a renderer participate in
 * the same hook surface in two lines instead of re-implementing the
 * filter chain.
 *
 * @since 0.18.0
 */

import { applyFilters, doAction, HOOKS } from './hooks';
import type {
	DockHookContextBase,
	DockItem,
	DockRenderContext,
	DockTileContext,
	SystemDockItem,
} from './dock';

/**
 * Run the registered `wp-desktop.dock.tile-class` filter against a
 * base classNames list. Use this in your renderer's tile-build code
 * so decoration plugins (glow, shake, dim, etc.) work alongside
 * your renderer:
 *
 * ```js
 * const classes = wp.desktop.applyTileClasses(
 *     [ 'my-renderer__tile' ],
 *     item,
 *     { isSystem: false, dockId: 'my-renderer', orientation: 'bottom' },
 * );
 * tile.className = classes.join( ' ' );
 * ```
 *
 * @public
 * @since 0.18.0
 */
export function applyTileClasses(
	baseClasses: string[],
	item: DockItem | SystemDockItem,
	ctx: Omit< DockTileContext, 'item' | 'container' > & {
		container?: HTMLElement;
	},
): string[] {
	const fullCtx: DockTileContext = {
		rail: ctx.rail ?? 'dock',
		orientation: ctx.orientation,
		dockId: ctx.dockId,
		container: ctx.container ?? document.body,
		item,
		isSystem: ctx.isSystem,
	};
	return applyFilters< string[] >(
		HOOKS.DOCK_TILE_CLASS,
		baseClasses,
		fullCtx,
	);
}

/**
 * Run the registered `wp-desktop.dock.tile-element` filter so a
 * decoration plugin can wrap your tile's outer element. Pair with
 * `applyTileClasses` and the `dispatchTileRendered` action below
 * for full hook compatibility.
 *
 * @public
 * @since 0.18.0
 */
export function applyTileElement(
	tile: HTMLElement,
	item: DockItem | SystemDockItem,
	ctx: Omit< DockTileContext, 'item' | 'container' > & {
		container?: HTMLElement;
	},
): HTMLElement {
	const fullCtx: DockTileContext = {
		rail: ctx.rail ?? 'dock',
		orientation: ctx.orientation,
		dockId: ctx.dockId,
		container: ctx.container ?? document.body,
		item,
		isSystem: ctx.isSystem,
	};
	return applyFilters< HTMLElement >(
		HOOKS.DOCK_TILE_ELEMENT,
		tile,
		fullCtx,
	);
}

/**
 * Run the registered `wp-desktop.dock.tile-tooltip` filter. Returns
 * the (possibly mutated, possibly suppressed → empty string) label
 * to display.
 *
 * @public
 * @since 0.18.0
 */
export function applyTileTooltip(
	label: string,
	item: DockItem | SystemDockItem,
	ctx: Omit< DockTileContext, 'item' | 'container' > & {
		container?: HTMLElement;
	},
): string {
	const fullCtx: DockTileContext = {
		rail: ctx.rail ?? 'dock',
		orientation: ctx.orientation,
		dockId: ctx.dockId,
		container: ctx.container ?? document.body,
		item,
		isSystem: ctx.isSystem,
	};
	return applyFilters< string >(
		HOOKS.DOCK_TILE_TOOLTIP,
		label,
		fullCtx,
	);
}

/**
 * Fire `wp-desktop.dock.tile-rendered` after a tile lands in the
 * DOM. Decoration plugins use this for post-insertion measurements
 * (IntersectionObserver, getBoundingClientRect-driven animations).
 *
 * @public
 * @since 0.18.0
 */
export function dispatchTileRendered(
	el: HTMLElement,
	item: DockItem | SystemDockItem,
	ctx: Omit< DockTileContext, 'item' | 'container' > & {
		container?: HTMLElement;
	},
): void {
	const fullCtx: DockTileContext = {
		rail: ctx.rail ?? 'dock',
		orientation: ctx.orientation,
		dockId: ctx.dockId,
		container: ctx.container ?? document.body,
		item,
		isSystem: ctx.isSystem,
	};
	doAction( HOOKS.DOCK_TILE_RENDERED, { ...fullCtx, el } );
}

/**
 * Fire `wp-desktop.dock.before-render` and (separately) `after-render`
 * around a paint pass. Plugins use these to invalidate cached
 * decoration state and to apply bulk treatments after a sweep.
 *
 * @public
 * @since 0.18.0
 */
export function dispatchBeforeRender( ctx: DockRenderContext ): void {
	doAction( HOOKS.DOCK_BEFORE_RENDER, ctx );
}
export function dispatchAfterRender( ctx: DockRenderContext ): void {
	doAction( HOOKS.DOCK_AFTER_RENDER, ctx );
}

// ---------------------------------------------------------------
// Hit-test helper — `isDockElement( target )`.
// ---------------------------------------------------------------

const DEFAULT_DOCK_SELECTOR = [
	'.wp-desktop-dock',
	'#wp-desktop-dock',
	'#wp-desktop-side-dock',
	'.wp-desktop-dock__tooltip',
	'.wp-desktop-dock-submenu',
].join( ',' );

const customSelectors = new Set< string >();

/**
 * Walk an event target's `composedPath` looking for a known dock
 * element. Used by click-outside-to-collapse handlers in custom
 * rail renderers — saves every plugin from re-walking the path
 * with bespoke class checks.
 *
 * Custom rail renderers can register their own root selectors via
 * {@link registerDockSelector} so a click on their renderer's
 * surface is recognised as "inside the dock" by everyone — most
 * importantly by their OWN click-outside handler when they read
 * the result of this helper.
 *
 * @public
 * @since 0.18.0
 */
export function isDockElement( target: EventTarget | null ): boolean {
	if ( ! target || typeof ( target as Element ).closest !== 'function' ) {
		return false;
	}
	const el = target as Element;
	if ( el.closest( DEFAULT_DOCK_SELECTOR ) ) {
		return true;
	}
	for ( const selector of customSelectors ) {
		if ( el.closest( selector ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Register an additional CSS selector treated as "inside the dock"
 * by {@link isDockElement}. Custom rail renderers should register
 * their root selector at mount time so other plugins'
 * click-outside-to-dismiss handlers don't trigger when the user
 * clicks the renderer's UI.
 *
 * Returns an unregister function. Idempotent.
 *
 * @public
 * @since 0.18.0
 */
export function registerDockSelector( selector: string ): () => void {
	if ( typeof selector !== 'string' || selector.trim() === '' ) {
		return () => undefined;
	}
	customSelectors.add( selector );
	return () => {
		customSelectors.delete( selector );
	};
}

/** Test-only helper to clear registered selectors between cases. */
export function _resetDockSelectorsForTests(): void {
	customSelectors.clear();
}

// Re-export the context types so plugin authors see one
// place to import.
export type { DockHookContextBase, DockRenderContext, DockTileContext };
