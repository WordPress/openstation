/**
 * How tall a pinned note may grow.
 *
 * A note grows with its text until its paper reaches the bottom of
 * the work area, so a long note reads in one piece instead of
 * scrolling inside a short paper. A note pinned low on the desktop
 * still gets {@link NOTE_MIN_MAX_HEIGHT}, the cap every note had
 * before, rather than shrinking to a sliver; it can be moved up to
 * open out.
 */

/** The cap no note goes below, wherever it is pinned. */
export const NOTE_MIN_MAX_HEIGHT = 320;

/** Breathing room between a fully grown note and the work area's edge. */
const BOTTOM_GAP = 16;

/** The paper's max-height for a note whose top has `spaceBelow` px under it. */
export function paperMaxHeight( spaceBelow: number ): number {
	return Math.max( NOTE_MIN_MAX_HEIGHT, Math.floor( spaceBelow - BOTTOM_GAP ) );
}

type AutosizeTextarea = HTMLElement & { refreshAutosize?: () => void };

/**
 * Let an auto-grow `<os-textarea>` editor take every row the paper
 * has room for, so the box only starts scrolling once the paper has
 * reached `maxHeight`. Measures live layout, so it is a no-op while
 * the editor is hidden; call it again once it shows.
 */
export function fitEditorRows(
	paper: HTMLElement,
	editor: AutosizeTextarea,
	maxHeight: number,
): void {
	const ta = editor.shadowRoot?.querySelector( 'textarea' );
	if ( editor.hidden || ! ta || ta.clientWidth === 0 ) {
		return;
	}
	const cs = window.getComputedStyle( ta );
	const fontSize = parseFloat( cs.fontSize ) || 14;
	const lineHeight = parseFloat( cs.lineHeight ) || fontSize * 1.45;
	const boxExtras =
		( parseFloat( cs.paddingTop ) || 0 ) +
		( parseFloat( cs.paddingBottom ) || 0 ) +
		( parseFloat( cs.borderTopWidth ) || 0 ) +
		( parseFloat( cs.borderBottomWidth ) || 0 );
	// Everything on the paper that is not the editor: padding, the
	// action row, gaps. Measured against the editor's box rather than
	// the textarea's, which can be taller than the flex item that
	// holds it when the space under the note just shrank.
	const chrome = paper.offsetHeight - editor.offsetHeight;
	const rows = Math.max( 5, Math.floor( ( maxHeight - chrome - boxExtras ) / lineHeight ) );
	if ( editor.getAttribute( 'max-rows' ) !== String( rows ) ) {
		editor.setAttribute( 'max-rows', String( rows ) );
		editor.refreshAutosize?.();
	}
}
