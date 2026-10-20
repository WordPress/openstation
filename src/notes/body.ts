/**
 * OpenStation — A pinned note's rendered body.
 *
 * The note's text is Markdown, painted through the shared renderer
 * (`src/markdown.ts`), which escapes before it interprets anything, so
 * a public note cannot put markup on anyone else's wallpaper. `- [ ]`
 * items become `<os-checkbox>` boxes: live on the owner's paper, where
 * ticking one hands the source line back to the controller to write
 * `[x]` into the text, and disabled on everyone else's.
 *
 * On the owner's paper the body is also the way into the editor: a
 * click on the text (not on a link or a box, and not the end of a
 * text selection), or Enter with the body focused.
 */

import { __ } from '../i18n';
import '../ui/components/os-checkbox/os-checkbox';
import { renderMarkdown } from '../markdown';

/**
 * Flag a body whose text runs past the paper, so notes.css can fade
 * the last line into "keep scrolling". The editor gets the same flag
 * from `<os-textarea auto-grow>`.
 */
function syncMoreBelow( body: HTMLElement ): void {
	body.toggleAttribute(
		'data-more-below',
		body.scrollTop + body.clientHeight < body.scrollHeight - 1,
	);
}

export interface NoteBodyOwner {
	/** The owner asked to edit the source. */
	onEdit(): void;
	/** A box was ticked; `lineIndex` is its 0-based source line. */
	onToggleTask( lineIndex: number, checked: boolean ): void;
}

export class NoteBody {
	readonly element: HTMLElement;
	private readonly owner: NoteBodyOwner | null;
	/** The text the body was last painted from. */
	private paintedText: string | null = null;

	/** Pass `owner` for the owner's paper; omit it for a read-only one. */
	constructor( owner: NoteBodyOwner | null = null ) {
		this.owner = owner;
		const body = document.createElement( 'div' );
		body.className = 'os-pinned-note__body';
		this.element = body;
		body.addEventListener( 'scroll', () => syncMoreBelow( body ), { passive: true } );
		window.requestAnimationFrame( () => syncMoreBelow( body ) );
		if ( owner ) {
			this.wireOwner( owner );
		}
	}

	/**
	 * Paint `text`. Skipped when it is what is already painted, so a
	 * save landing after a tick never rebuilds the box the keyboard is
	 * still on.
	 */
	render( text: string ): void {
		if ( text === this.paintedText ) {
			return;
		}
		this.paintedText = text;
		this.element.innerHTML = renderMarkdown( text, {
			tasks: { disabled: ! this.owner },
		} );
		syncMoreBelow( this.element );
	}

	/** Paint `text` even if it is what was painted last. */
	repaint( text: string ): void {
		this.paintedText = null;
		this.render( text );
	}

	/**
	 * Record that the DOM already shows `text` — a tick has flipped its
	 * own box, and the text was rewritten to match.
	 */
	adopt( text: string ): void {
		this.paintedText = text;
	}

	private wireOwner( owner: NoteBodyOwner ): void {
		const body = this.element;
		body.tabIndex = 0;
		body.setAttribute( 'role', 'group' );
		body.setAttribute(
			'aria-label',
			__( 'Note text. Press Enter to edit.', 'desktop-mode' ),
		);
		body.dataset.placeholder = __( 'Empty note. Click to write.', 'desktop-mode' );
		body.addEventListener( 'click', ( event ) => {
			const target = event.target as Element | null;
			// A link follows itself and a box ticks itself; a drag that
			// selected text was reading, not asking to edit.
			if ( target?.closest?.( 'a, os-checkbox' ) ) {
				return;
			}
			const selection = body.ownerDocument.defaultView?.getSelection();
			if ( selection && ! selection.isCollapsed ) {
				return;
			}
			owner.onEdit();
		} );
		body.addEventListener( 'keydown', ( event ) => {
			if ( event.target === body && event.key === 'Enter' ) {
				event.preventDefault();
				owner.onEdit();
			}
		} );
		body.addEventListener( 'os-checkbox-change', ( event ) => {
			const detail = ( event as CustomEvent< { checked: boolean; value: string | null } > ).detail;
			if ( detail.value !== null ) {
				owner.onToggleTask( Number( detail.value ), detail.checked );
			}
		} );
	}
}
