/**
 * Desktop Mode — Drop target registry.
 *
 * Keeps the live list of drop targets and runs the hit-test on each
 * `pointermove`. Hit-testing is a simple "deepest registered ancestor
 * of `elementFromPoint`" walk — no z-order accounting, no priority
 * fields. The DOM nesting IS the priority.
 *
 * Claimant semantics: the deepest registered ancestor *claims* the
 * pointer position even if its `accept()` returns false. The cursor
 * shows `no-drop` and the drop is rejected, instead of falling
 * through to a parent target. This is what stops a drop on top of an
 * iframe window from being silently routed to the wallpaper
 * underneath.
 */

import type { DragPayload, DropTarget } from './types';

export class DropTargetRegistry {
	private readonly _targets = new Map< string, DropTarget >();
	private readonly _byElement = new Map< HTMLElement, DropTarget >();

	register( target: DropTarget ): () => void {
		// Idempotent: re-registering with the same id replaces in
		// place. Layers that re-mount during a hot reload don't have
		// to track their previous deregister.
		const prev = this._targets.get( target.id );
		if ( prev ) {
			this._byElement.delete( prev.element );
		}
		this._targets.set( target.id, target );
		this._byElement.set( target.element, target );
		return () => {
			const cur = this._targets.get( target.id );
			if ( cur === target ) {
				this._targets.delete( target.id );
				this._byElement.delete( target.element );
			}
		};
	}

	list(): readonly DropTarget[] {
		return Array.from( this._targets.values() );
	}

	clear(): void {
		this._targets.clear();
		this._byElement.clear();
	}

	/**
	 * Find the deepest registered target whose element is `el` or an
	 * ancestor of `el`. Walks the DOM tree once (O(depth)).
	 *
	 * Window claim boundary: if the walk crosses a `.desktop-mode-window`
	 * element BEFORE finding a registered target, hit-testing stops
	 * there and returns null. This is the rule that makes "drag over
	 * a Gutenberg admin window" produce reject feedback instead of
	 * silently routing the drop to the wallpaper canvas underneath.
	 *
	 * A window can opt INTO accepting drops by registering a target
	 * on its own body (e.g. Recycle Bin's `[data-desktop-mode-recycle-bin-root]`):
	 * since that element sits inside the window, the walk hits it
	 * before reaching the window boundary and the body's target wins.
	 */
	hitTest( el: Element | null ): DropTarget | null {
		let cur: Element | null = el;
		while ( cur ) {
			if ( cur instanceof HTMLElement ) {
				const t = this._byElement.get( cur );
				if ( t ) {
					return t;
				}
				if ( cur.classList.contains( 'desktop-mode-window' ) ) {
					return null;
				}
			}
			cur = cur.parentElement;
		}
		return null;
	}

	/**
	 * Convenience: pick the target at viewport `(clientX, clientY)`.
	 * Caller is responsible for hiding any obscuring ghost element
	 * before calling — see `GhostHandle.withHidden()`.
	 */
	hitTestPoint( clientX: number, clientY: number ): {
		target: DropTarget | null;
		element: Element | null;
		accepted: boolean;
		payload?: DragPayload;
	} {
		const el = document.elementFromPoint( clientX, clientY );
		const target = this.hitTest( el );
		return { target, element: el, accepted: false };
	}
}
