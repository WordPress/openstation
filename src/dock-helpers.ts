import { applyFilters, doAction, HOOKS } from './hooks';
import type {
	DockHookContextBase,
	DockItem,
	DockRenderContext,
	DockTileContext,
	SystemDockItem,
} from './dock';

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

export function dispatchBeforeRender( ctx: DockRenderContext ): void {
	doAction( HOOKS.DOCK_BEFORE_RENDER, ctx );
}
export function dispatchAfterRender( ctx: DockRenderContext ): void {
	doAction( HOOKS.DOCK_AFTER_RENDER, ctx );
}

const DEFAULT_DOCK_SELECTOR = [
	'.os-dock',
	'#os-dock',
	'#os-side-dock',
	'.os-dock__tooltip',
	'.os-dock-submenu',
].join( ',' );

const customSelectors = new Set< string >();

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

export function registerDockSelector( selector: string ): () => void {
	if ( typeof selector !== 'string' || selector.trim() === '' ) {
		return () => undefined;
	}
	customSelectors.add( selector );
	return () => {
		customSelectors.delete( selector );
	};
}

export function _resetDockSelectorsForTests(): void {
	customSelectors.clear();
}

export type { DockHookContextBase, DockRenderContext, DockTileContext };
