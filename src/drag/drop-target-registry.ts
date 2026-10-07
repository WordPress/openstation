import type { DragPayload, DropTarget } from './types';

export class DropTargetRegistry {
	private readonly _targets = new Map< string, DropTarget >();
	private readonly _byElement = new Map< HTMLElement, DropTarget >();

	register( target: DropTarget ): () => void {
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

	hitTest( el: Element | null ): DropTarget | null {
		let cur: Element | null = el;
		while ( cur ) {
			if ( cur instanceof HTMLElement ) {
				const t = this._byElement.get( cur );
				if ( t ) {
					return t;
				}
				if ( cur.classList.contains( 'os-window' ) ) {
					return null;
				}
			}
			cur = cur.parentElement;
		}
		return null;
	}

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
