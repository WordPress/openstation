/**
 * Workspace notes — what the desk's author pins on it.
 *
 * An agency sets up a desk for a client and leaves a note on it: "Orders
 * go here; ask us before touching Plugins". Everyone using the desk sees
 * the note, can read it and can dismiss it — and cannot change it. The
 * author changes it while editing the workspace ("Editing workspace …"),
 * where the notes become editable, draggable by their pin, and new ones
 * can be added: a regular note, or an **XL note** at twice the size for
 * a longer, nicer write-up.
 *
 * They wear the pinned-note look (`notes.css`: the paper, the pushpin,
 * the colours) without the pinned-note machinery: a workspace note is a
 * few fields of the desk's profile, not a post, so it has no server of
 * its own, no trash and no convert-to-draft. Dismissals are the one
 * thing kept per person (`workspaceDismissedNotes`, a REST route).
 *
 * The layer sits where pinned notes sit — on the wallpaper, under the
 * windows — and hides in Overview the same way.
 */

import { __ } from '../i18n';
import type { WorkspaceNote } from './types';

/** The sticky-note colours, in the order new notes cycle through them. */
const COLORS = [ 'butter', 'sky', 'mint', 'blush', 'lilac', 'peach' ];

/** Characters a note may hold; an XL note holds twice as many. */
export const NOTE_MAX = { normal: 1000, xl: 2000 } as const;

export interface WorkspaceNotesOptions {
	/** The desktop area — the notes hang on its wallpaper. */
	host: HTMLElement;
	/** For the pushpin art. */
	pluginUrl: string;
	/** Ids this user has dismissed. */
	dismissed: readonly string[];
	/** Persist a dismissal. */
	dismiss: ( id: string ) => void;
}

/** A new note id: short, unguessable enough, and only ever an id. */
export function newNoteId(): string {
	return Array.from( { length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[ Math.floor( Math.random() * 36 ) ] ).join( '' );
}

/** A small, stable tilt per note, so a wall of notes is not a grid. */
function tilt( id: string ): number {
	let h = 0;
	for ( const ch of id ) {
		h = ( h * 31 + ch.charCodeAt( 0 ) ) % 997;
	}
	return ( h % 7 ) - 3;
}

function clampUnit( v: number ): number {
	return Math.min( 0.95, Math.max( 0, Number.isFinite( v ) ? v : 0 ) );
}

export class WorkspaceNotesLayer {
	private root: HTMLElement;
	private dismissed: Set< string >;
	private editing = false;
	private notes: WorkspaceNote[] = [];

	constructor( private options: WorkspaceNotesOptions ) {
		this.dismissed = new Set( options.dismissed );
		this.root = document.createElement( 'div' );
		this.root.className = 'os-notes os-workspace-notes';
		options.host.appendChild( this.root );
	}

	/** Show a desk's notes: read-only, or editable while it is being edited. */
	public show( notes: readonly WorkspaceNote[] | null | undefined, editing = false ): void {
		this.notes = ( notes ?? [] ).map( ( n ) => ( { ...n } ) );
		this.editing = editing;
		this.paint();
	}

	/** Whether the notes are editable right now. */
	public isEditing(): boolean {
		return this.editing;
	}

	/** The notes as the author left them — read back from the page. */
	public collect(): WorkspaceNote[] {
		return this.notes
			.map( ( n ) => ( { ...n, text: n.text.trim().slice( 0, NOTE_MAX[ n.size ] ) } ) )
			.filter( ( n ) => '' !== n.text );
	}

	/** Add a note while editing, in the middle of the desk, ready to type into. */
	public add( size: WorkspaceNote[ 'size' ] ): void {
		if ( ! this.editing ) {
			return;
		}
		const offset = ( this.notes.length % 5 ) * 0.03;
		const note: WorkspaceNote = {
			id: newNoteId(),
			text: '',
			size,
			color: COLORS[ this.notes.length % COLORS.length ],
			x: clampUnit( ( 'xl' === size ? 0.3 : 0.4 ) + offset ),
			y: clampUnit( 0.2 + offset ),
		};
		this.notes.push( note );
		this.paint();
		this.root.querySelector< HTMLElement >( `[data-note-id="${ note.id }"] .os-pinned-note__body` )?.focus();
	}

	public destroy(): void {
		this.root.remove();
	}

	private paint(): void {
		this.root.replaceChildren();
		for ( const note of this.notes ) {
			if ( ! this.editing && this.dismissed.has( note.id ) ) {
				continue;
			}
			this.root.appendChild( this.noteElement( note ) );
		}
	}

	private noteElement( note: WorkspaceNote ): HTMLElement {
		const el = document.createElement( 'article' );
		el.className = 'os-pinned-note os-workspace-note';
		el.dataset.noteId = note.id;
		el.dataset.noteColor = note.color;
		el.dataset.size = note.size;
		el.dataset.owner = this.editing ? 'me' : 'other';
		el.setAttribute( 'role', 'note' );
		el.setAttribute( 'aria-label', this.editing ? __( 'Workspace note — editing' ) : __( 'Note from the person who set up this workspace' ) );
		el.style.setProperty( '--dm-note-rot', `${ tilt( note.id ) }deg` );
		el.style.left = `${ note.x * 100 }%`;
		el.style.top = `${ note.y * 100 }%`;

		const pin = document.createElement( this.editing ? 'button' : 'span' );
		pin.className = 'os-pinned-note__pin';
		const img = document.createElement( 'img' );
		img.src = `${ this.options.pluginUrl.replace( /\/$/, '' ) }/assets/images/pushpin.svg`;
		img.alt = '';
		img.width = 56;
		img.height = 52;
		img.draggable = false;
		img.className = 'os-pinned-note__pin-img';
		pin.appendChild( img );

		const paper = document.createElement( 'div' );
		paper.className = 'os-pinned-note__paper';
		const body = document.createElement( 'div' );
		body.className = 'os-pinned-note__body';
		body.textContent = note.text;
		paper.appendChild( body );

		const close = document.createElement( 'button' );
		close.type = 'button';
		close.className = 'os-workspace-note__close';

		if ( this.editing ) {
			pin.setAttribute( 'type', 'button' );
			pin.setAttribute( 'aria-label', __( 'Move note — drag the pin' ) );
			pin.addEventListener( 'pointerdown', ( e ) => this.drag( e as PointerEvent, note, el ) );
			body.setAttribute( 'contenteditable', 'plaintext-only' );
			body.setAttribute( 'role', 'textbox' );
			body.setAttribute( 'aria-multiline', 'true' );
			body.setAttribute( 'aria-label', 'xl' === note.size ? __( 'XL note text' ) : __( 'Note text' ) );
			body.dataset.placeholder = __( 'Write a note for the people using this workspace…' );
			body.addEventListener( 'input', () => {
				note.text = ( body.textContent ?? '' ).slice( 0, NOTE_MAX[ note.size ] );
			} );
			close.setAttribute( 'aria-label', __( 'Delete this note' ) );
			close.title = __( 'Delete this note' );
			close.textContent = '×';
			close.addEventListener( 'click', () => {
				this.notes = this.notes.filter( ( n ) => n !== note );
				el.remove();
			} );
		} else {
			pin.setAttribute( 'aria-hidden', 'true' );
			close.setAttribute( 'aria-label', __( 'Dismiss this note' ) );
			close.title = __( 'Dismiss' );
			close.textContent = '×';
			close.addEventListener( 'click', () => {
				this.dismissed.add( note.id );
				this.options.dismiss( note.id );
				el.classList.add( 'is-leaving' );
				window.setTimeout( () => el.remove(), 180 );
			} );
		}
		paper.appendChild( close );
		el.append( pin, paper );
		return el;
	}

	/** Drag a note by its pin, as fractions of the desk. */
	private drag( event: PointerEvent, note: WorkspaceNote, el: HTMLElement ): void {
		event.preventDefault();
		const pin = event.currentTarget as HTMLElement;
		const area = this.options.host.getBoundingClientRect();
		const start = { x: event.clientX, y: event.clientY, nx: note.x, ny: note.y };
		pin.setPointerCapture?.( event.pointerId );
		const move = ( e: PointerEvent ): void => {
			if ( ! area.width || ! area.height ) {
				return;
			}
			note.x = clampUnit( start.nx + ( e.clientX - start.x ) / area.width );
			note.y = clampUnit( start.ny + ( e.clientY - start.y ) / area.height );
			el.style.left = `${ note.x * 100 }%`;
			el.style.top = `${ note.y * 100 }%`;
		};
		const up = (): void => {
			pin.removeEventListener( 'pointermove', move );
			pin.removeEventListener( 'pointerup', up );
			pin.removeEventListener( 'pointercancel', up );
		};
		pin.addEventListener( 'pointermove', move );
		pin.addEventListener( 'pointerup', up );
		pin.addEventListener( 'pointercancel', up );
	}
}
