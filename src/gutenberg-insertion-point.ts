export interface InsertionPoint {

	rootClientId: string;

	index: number;
}

export interface CanvasPoint {
	doc: Document;
	x: number;
	y: number;
}

const LAYOUT_SELECTOR = '.block-editor-block-list__layout';
const BLOCK_SELECTOR = '[data-block]';
const CANVAS_IFRAME_SELECTOR = 'iframe[name="editor-canvas"]';

export function resolveCanvasPoint( doc: Document, x: number, y: number ): CanvasPoint {
	const frame = doc.querySelector< HTMLIFrameElement >( CANVAS_IFRAME_SELECTOR );
	if ( ! frame ) {
		return { doc, x, y };
	}
	let inner: Document | null = null;
	try {
		inner = frame.contentDocument;
	} catch {
		inner = null;
	}
	if ( ! inner ) {
		return { doc, x, y };
	}
	const rect = frame.getBoundingClientRect();
	return { doc: inner, x: x - rect.left, y: y - rect.top };
}

function isElement( node: unknown ): node is HTMLElement {
	return !! node && ( node as Node ).nodeType === 1;
}

function blocksOf( layout: Element ): HTMLElement[] {
	return Array.from( layout.children ).filter(
		( el ): el is HTMLElement => isElement( el ) && el.hasAttribute( 'data-block' ),
	);
}

function rootClientIdOf( layout: Element ): string {
	const owner = layout.parentElement?.closest( BLOCK_SELECTOR );
	return owner ? owner.getAttribute( 'data-block' ) ?? '' : '';
}

function isHorizontal( layout: Element ): boolean {
	if ( layout.classList.contains( 'is-horizontal' ) ) {
		return true;
	}
	const view = layout.ownerDocument.defaultView;
	if ( ! view ) {
		return false;
	}
	const style = view.getComputedStyle( layout );
	return style.display === 'flex' && ( style.flexDirection === 'row' || style.flexDirection === 'row-reverse' );
}

export function computeInsertionPoint( doc: Document, x: number, y: number ): InsertionPoint | null {
	const hit = doc.elementFromPoint( x, y );
	if ( ! hit ) {
		return null;
	}

	const nearestLayout = hit.closest( LAYOUT_SELECTOR );
	const block = hit.closest( BLOCK_SELECTOR );
	if ( isElement( block ) && ( ! nearestLayout || nearestLayout.contains( block ) ) ) {
		const layout = block.parentElement?.closest( LAYOUT_SELECTOR );
		if ( ! layout ) {
			return null;
		}
		const siblings = blocksOf( layout );
		const idx = siblings.indexOf( block );
		if ( idx === -1 ) {
			return null;
		}
		const rect = block.getBoundingClientRect();
		const after = isHorizontal( layout )
			? x > rect.left + rect.width / 2
			: y > rect.top + rect.height / 2;
		return { rootClientId: rootClientIdOf( layout ), index: idx + ( after ? 1 : 0 ) };
	}

	const layout = nearestLayout;
	if ( ! layout ) {
		return null;
	}
	const siblings = blocksOf( layout );
	const horizontal = isHorizontal( layout );
	for ( let i = 0; i < siblings.length; i++ ) {
		const rect = siblings[ i ].getBoundingClientRect();
		const startsPast = horizontal ? rect.left > x : rect.top > y;
		if ( startsPast ) {
			return { rootClientId: rootClientIdOf( layout ), index: i };
		}
	}
	return { rootClientId: rootClientIdOf( layout ), index: siblings.length };
}

export function sameInsertionPoint(
	a: InsertionPoint | null,
	b: InsertionPoint | null,
): boolean {
	if ( ! a || ! b ) {
		return a === b;
	}
	return a.rootClientId === b.rootClientId && a.index === b.index;
}
