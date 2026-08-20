/**
 * OpenStation — Pinned notes layer.
 *
 * Renders `wpd_note` posts as paper notes pinned to the wallpaper.
 * Each note hangs from a pushpin, the pin is the ONLY drag handle,
 * drags route through the shell DragManager (payload type `'note'`),
 * and the recycle bin accepts the payload as a trash gesture via
 * `recycle-bin-payloads.ts`.
 *
 * Read-only public notes (other users') render with a steel pin
 * that is *scenery, not a handle* — no drag, no edit, an always-
 * visible author chip.
 */

import { __, sprintf } from '../i18n';
import '../ui/components/os-avatar/os-avatar';
import '../ui/components/os-save-status/os-save-status';
import '../ui/components/os-textarea/os-textarea';
import '../ui/components/os-window-button/os-window-button';
import { osConfirm } from '../os-confirm';
import { osIconSvg } from '../ui/icons';
import { DRAG_EVENTS } from '../drag';
import type { DragManagerApi } from '../drag';
import { NOTE_COLORS, nextNoteColor, sanitizeNoteColorSlug } from './colors';
import {
	hashNoteSeed,
	noteJitter,
	playCrumpleIntoBin,
	playPinInsertion,
	playSnapBack,
	prefersReducedMotion,
	startPendulum,
	type PendulumHandle,
} from './motion';
import { buildPinImage, PIN_TIP_X, PIN_TIP_Y } from './pin';
import {
	createNote,
	isNotesConflict,
	listNotes,
	updateNote,
	type UpdateNoteBody,
} from './rest';
import { startNotesHeartbeat } from './heartbeat';
import { trashNoteWithUndo } from './trash';
import { convertNoteToPost } from './convert';
import {
	NOTE_PAYLOAD_TYPE,
	type Note,
	type NoteDragData,
	type NotesHeartbeatPayload,
	type NotesHeartbeatSubscribe,
} from './types';

const NOTE_WIDTH = 208;
const SAVE_DEBOUNCE_MS = 1000;
const Z_SAVE_DEBOUNCE_MS = 800;
const KEYBOARD_STEP_PX = 10;
const KEYBOARD_FINE_STEP_PX = 1;

type OsTextareaElement = HTMLElement & { focusInput?: () => void };

function getDragManager(): DragManagerApi | null {
	const api = (
		window as unknown as {
			wp?: { os?: { dragManager?: DragManagerApi } };
		}
	).wp?.os?.dragManager;
	return api ?? null;
}

/**
 * The jitter seed to render with. Notes created before the seed
 * landed (or shaped by an older server) fall back to their id so
 * they still get a stable, if arbitrary, tilt.
 */
function jitterSeed( note: Note ): number {
	return note.seed || Math.abs( note.id ) || 1;
}

/**
 * The `post` glyph from `@wordpress/icons`, inlined. Marks the
 * "Convert to post" affordance. `fill` inherits from the button's ink
 * color (see notes.css).
 *
 * Not from `src/ui/icons`: the thirty are the shell's own vocabulary
 * plus the Core verbs it reuses, and `post` is neither. If a second
 * surface ever needs it, it earns a place in the set rather than a
 * second copy here.
 */
const ICON_POST = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="m7.3 9.7 1.4 1.4c.2-.2.3-.3.4-.5 0 0 0-.1.1-.1.3-.5.4-1.1.3-1.6L12 7 9 4 7.2 6.5c-.6-.1-1.1 0-1.6.3 0 0-.1 0-.1.1-.3.1-.4.2-.6.4l1.4 1.4L4 11v1h1l2.3-2.3zM4 20h9v-1.5H4V20zm0-5.5V16h16v-1.5H4z" /></svg>`;

/** Delete a note. Core's trash, from the set. */
const ICON_TRASH = osIconSvg( 'trash', { size: 20 } );

export interface NotesLayerOptions {
	host: HTMLElement;
	/** Plugin base URL (no trailing slash) — locates the pushpin SVG. */
	pluginUrl: string;
	/**
	 * Whether the viewer can author posts. Gates the "Convert to post"
	 * affordance on owned notes (inline button + Posts dock drop target).
	 */
	canCreatePosts?: boolean;
	onError?: ( message: string ) => void;
}

export class NotesLayer {
	readonly host: HTMLElement;
	readonly pluginUrl: string;
	readonly canCreatePosts: boolean;
	private onError?: ( message: string ) => void;
	private root: HTMLElement | null = null;
	private liveRegion: HTMLElement | null = null;
	private controllers = new Map< number, NoteController >();
	private zCounter = 1;
	private highWaterMs = 0;
	private tempIdCounter = 0;

	constructor( options: NotesLayerOptions ) {
		this.host = options.host;
		this.pluginUrl = options.pluginUrl;
		this.canCreatePosts = options.canCreatePosts ?? false;
		this.onError = options.onError;
	}

	async boot(): Promise< void > {
		try {
			const { notes } = await listNotes();
			notes.forEach( ( note ) => {
				this.bumpHighWater( note.updatedAtMs );
				this.upsertNote( note, { animate: 'none' } );
			} );
			startNotesHeartbeat( this );
		} catch ( error ) {
			// A fresh site with zero notes still resolves fine — an
			// error here means the routes are unreachable. Stay quiet
			// on the wallpaper; log for the debugging session.
			if ( error instanceof Error ) {
				// eslint-disable-next-line no-console
				console.debug( '[openstation] Pinned notes unavailable:', error.message );
			}
		}
	}

	/**
	 * Insert or update a note on the wall.
	 */
	upsertNote(
		note: Note,
		options: { animate: 'none' | 'thunk' | 'move' } = { animate: 'none' },
	): NoteController {
		this.ensureRoot();
		this.zCounter = Math.max( this.zCounter, note.z );
		const existing = this.controllers.get( note.id );
		if ( existing ) {
			existing.replace( note );
			return existing;
		}
		const controller = new NoteController( { layer: this, note } );
		this.controllers.set( note.id, controller );
		this.root?.appendChild( controller.element );
		if ( options.animate !== 'none' ) {
			void controller.playInsertion( options.animate === 'thunk' ? 1 : 0.7 );
		}
		return controller;
	}

	removeNote( noteId: number ): void {
		const controller = this.controllers.get( noteId );
		if ( ! controller ) {
			return;
		}
		this.controllers.delete( noteId );
		controller.dispose();
		controller.element.remove();
	}

	/** Rebind a controller after a temp (optimistic) id resolves. */
	rekeyNote( oldId: number, controller: NoteController ): void {
		this.controllers.delete( oldId );
		this.controllers.set( controller.note.id, controller );
	}

	has( noteId: number ): boolean {
		return this.controllers.has( noteId );
	}

	get( noteId: number ): NoteController | undefined {
		return this.controllers.get( noteId );
	}

	nextTempId(): number {
		this.tempIdCounter -= 1;
		return this.tempIdCounter;
	}

	bringToFront( controller: NoteController ): void {
		this.zCounter += 1;
		controller.setZ( this.zCounter );
	}

	bumpHighWater( updatedAtMs: number ): void {
		if ( Number.isFinite( updatedAtMs ) && updatedAtMs > this.highWaterMs ) {
			this.highWaterMs = updatedAtMs;
		}
	}

	hostSize(): { width: number; height: number } {
		return {
			width: Math.max( 1, this.host.clientWidth ),
			height: Math.max( 1, this.host.clientHeight ),
		};
	}

	/** Clamp a normalized position so the note stays reachable. */
	clampPosition( x: number, y: number ): { x: number; y: number } {
		const { width, height } = this.hostSize();
		const maxX = Math.max( 0, 1 - NOTE_WIDTH / width );
		const maxY = Math.max( 0, 1 - 120 / height );
		return {
			x: Math.min( maxX, Math.max( 0, x ) ),
			y: Math.min( maxY, Math.max( 0, y ) ),
		};
	}

	/** Normalized 0–1 top-left for a viewport point. */
	normalizedFromClient( clientX: number, clientY: number ): { x: number; y: number } {
		const rect = this.host.getBoundingClientRect();
		const { width, height } = this.hostSize();
		return this.clampPosition(
			( clientX - rect.left ) / width,
			( clientY - rect.top ) / height,
		);
	}

	/**
	 * Pin a new note optimistically against a negative temp id, then
	 * adopt the server copy. Shared by the wallpaper context menu and
	 * the Note Pad's tear-off drop.
	 */
	createNoteAt( options: {
		x: number;
		y: number;
		text?: string;
		color?: string;
		isPublic?: boolean;
		/** Focus the editor once the paper lands. */
		focus?: boolean;
	} ): NoteController {
		const text = options.text ?? '';
		const color = sanitizeNoteColorSlug( options.color ?? NOTE_COLORS[ 0 ] );
		const isPublic = options.isPublic === true;
		const { x, y } = this.clampPosition( options.x, options.y );
		// Hashed client-side so the optimistic paper and every later
		// render share a tilt. Position is the fallback because
		// `hashNoteSeed('')` is a constant, and the wallpaper-menu path
		// always starts empty — every note from it would come out
		// parallel, which is the one thing the seed exists to prevent.
		const seed = hashNoteSeed( text || `${ x },${ y }` );

		const tempId = this.nextTempId();
		const controller = this.upsertNote(
			{
				id: tempId,
				text,
				color,
				x,
				y,
				z: 1,
				public: isPublic,
				seed,
				ownerId: 0,
				ownerName: '',
				ownerAvatar: '',
				canEdit: true,
				updatedAtMs: 0,
			},
			{ animate: 'thunk' },
		);
		this.bringToFront( controller );
		if ( options.focus ) {
			controller.focusEditor();
		}

		void createNote( { text, color, x, y, public: isPublic, seed } )
			.then( ( note ) => {
				this.bumpHighWater( note.updatedAtMs );
				// The server echoes our position back; we only need the
				// id and the concurrency token.
				controller.replace( note );
				this.rekeyNote( tempId, controller );
				// Edits typed during the POST debounced against the temp
				// id and couldn't save. Now they can.
				controller.flushPendingEdits();
			} )
			.catch( ( err: unknown ) => {
				this.removeNote( tempId );
				this.notifyError(
					__( 'Could not pin the note. Please try again.', 'desktop-mode' ),
				);
				// eslint-disable-next-line no-console
				console.error( '[openstation] notes: create failed:', err );
			} );

		return controller;
	}

	announce( message: string ): void {
		this.ensureRoot();
		if ( this.liveRegion ) {
			this.liveRegion.textContent = message;
		}
	}

	notifyError( message: string ): void {
		this.onError?.( message );
	}

	trashNote( note: Note ): void {
		void trashNoteWithUndo( note, {
			onEvict: ( noteId ) => this.removeNote( noteId ),
			onRestore: ( restored ) => {
				this.bumpHighWater( restored.updatedAtMs );
				this.upsertNote( restored, { animate: 'move' } );
			},
		} );
	}

	/**
	 * Convert a note to a draft post: evict optimistically, auto-open
	 * the draft editor, Undo restores the note (and discards the draft).
	 */
	convertNote( note: Note ): void {
		if ( ! this.canCreatePosts || ! note.canEdit ) {
			return;
		}
		void convertNoteToPost( note, {
			onEvict: ( noteId ) => this.removeNote( noteId ),
			onRestore: ( restored ) => {
				this.bumpHighWater( restored.updatedAtMs );
				this.upsertNote( restored, { animate: 'move' } );
			},
		} );
	}

	// ------------------------------------------------------------------
	// Heartbeat
	// ------------------------------------------------------------------

	getHeartbeatSubscription(): NotesHeartbeatSubscribe | undefined {
		return {
			knownIds: Array.from( this.controllers.keys() ).filter( ( id ) => id > 0 ),
			sinceMs: this.highWaterMs,
		};
	}

	applyHeartbeatPayload( payload: NotesHeartbeatPayload ): void {
		for ( const note of payload.notes ?? [] ) {
			this.bumpHighWater( note.updatedAtMs );
			const existing = this.controllers.get( note.id );
			if ( existing ) {
				if ( existing.shouldReplaceFromRemote( note ) ) {
					existing.replace( note );
				}
			} else {
				this.upsertNote( note, { animate: 'move' } );
			}
		}
		for ( const id of payload.removed ?? [] ) {
			this.removeNote( id );
		}
		if (
			typeof payload.serverTimeMs === 'number' &&
			Number.isFinite( payload.serverTimeMs )
		) {
			this.bumpHighWater( payload.serverTimeMs );
		}
		if ( payload.truncated ) {
			// The server capped the delta — anything beyond the cap
			// would be skipped forever now that the high-water mark
			// advanced. Re-hydrate from the full list instead.
			void this.reloadFromServer();
		}
	}

	/** Full re-hydration — the Heartbeat delta overflowed its cap. */
	private async reloadFromServer(): Promise< void > {
		try {
			const { notes } = await listNotes();
			const alive = new Set< number >();
			for ( const note of notes ) {
				alive.add( note.id );
				this.bumpHighWater( note.updatedAtMs );
				const existing = this.controllers.get( note.id );
				if ( existing ) {
					if ( existing.shouldReplaceFromRemote( note ) ) {
						existing.replace( note );
					}
				} else {
					this.upsertNote( note, { animate: 'move' } );
				}
			}
			for ( const id of Array.from( this.controllers.keys() ) ) {
				if ( id > 0 && ! alive.has( id ) ) {
					this.removeNote( id );
				}
			}
		} catch {
			// Quiet — the next heartbeat tick can try again.
		}
	}

	private ensureRoot(): HTMLElement {
		if ( this.root ) {
			return this.root;
		}
		const root = document.createElement( 'section' );
		root.className = 'os-notes';
		root.setAttribute( 'aria-label', __( 'Pinned notes', 'desktop-mode' ) );
		const live = document.createElement( 'div' );
		live.className = 'os-notes__live screen-reader-text';
		live.setAttribute( 'aria-live', 'polite' );
		root.appendChild( live );
		this.host.appendChild( root );
		this.root = root;
		this.liveRegion = live;
		return root;
	}
}

interface GhostParts {
	root: HTMLElement;
	swing: HTMLElement;
	pin: HTMLElement;
	paper: HTMLElement;
}

export class NoteController {
	element: HTMLElement;
	note: Note;
	private layer: NotesLayer;
	private paperEl: HTMLElement;
	private pinEl: HTMLElement;
	private editor: OsTextareaElement | null = null;
	private statusEl: HTMLElement | null = null;
	private colorDot: HTMLButtonElement | null = null;
	private visibilityBtn: HTMLElement | null = null;
	private jitter: { rotation: number; pinOffsetX: number; pinRotation: number };
	private saveTimer: number | null = null;
	private zTimer: number | null = null;
	private patchChain: Promise< void > = Promise.resolve();
	private pendingText: string | null = null;
	private disposed = false;
	private moveMode = false;
	private moveOrigin: { x: number; y: number } | null = null;
	// Session-scoped drag listeners (pendulum, bin-hover doom).
	private dragCleanup: ( () => void ) | null = null;
	private lastPointer: { x: number; y: number } | null = null;

	constructor( options: { layer: NotesLayer; note: Note } ) {
		this.layer = options.layer;
		this.note = options.note;
		this.jitter = noteJitter( jitterSeed( options.note ) );
		this.element = document.createElement( 'article' );
		this.paperEl = document.createElement( 'div' );
		this.pinEl = document.createElement(
			this.note.canEdit ? 'button' : 'span',
		);
		this.paint();
		this.applyPosition();
		this.setZ( this.note.z );
		this.element.addEventListener(
			'pointerdown',
			() => this.layer.bringToFront( this ),
			{ capture: true },
		);
	}

	// ------------------------------------------------------------------
	// DOM
	// ------------------------------------------------------------------

	private paint(): void {
		const note = this.note;
		this.element.className = 'os-pinned-note';
		this.element.dataset.noteId = String( note.id );
		this.element.dataset.noteColor = sanitizeNoteColorSlug( note.color );
		this.element.dataset.owner = note.canEdit ? 'me' : 'other';
		this.element.setAttribute(
			'role',
			note.canEdit ? 'group' : 'note',
		);
		this.element.setAttribute(
			'aria-label',
			note.canEdit
				? __( 'Pinned note', 'desktop-mode' )
				: sprintf(
					/* translators: %s: note author display name. */
					__( 'Note by %s', 'desktop-mode' ),
					note.ownerName,
				),
		);
		this.element.style.setProperty( '--dm-note-rot', `${ this.jitter.rotation }deg` );
		this.element.style.setProperty( '--dm-pin-dx', `${ this.jitter.pinOffsetX }px` );
		this.element.style.setProperty( '--dm-pin-rot', `${ this.jitter.pinRotation }deg` );

		// The pin — drag handle for the owner, scenery for viewers.
		this.pinEl.className = 'os-pinned-note__pin';
		this.pinEl.appendChild( buildPinImage( this.layer.pluginUrl ) );
		if ( note.canEdit ) {
			this.pinEl.setAttribute( 'type', 'button' );
			this.pinEl.setAttribute( 'aria-pressed', 'false' );
			this.pinEl.setAttribute(
				'aria-label',
				__(
					'Move note. Drag the pin, or press Enter then use the arrow keys.',
					'desktop-mode',
				),
			);
			this.pinEl.addEventListener( 'pointerdown', ( event ) =>
				this.startDrag( event as PointerEvent ),
			);
			// Keyboard activation (Enter/Space) fires a click with
			// `detail === 0` and never goes through the DragManager —
			// route it to move mode directly. Pointer clicks arrive via
			// the drag session's `onClickOnly` instead.
			this.pinEl.addEventListener( 'click', ( event ) => {
				if ( ( event as MouseEvent ).detail === 0 && ! this.moveMode ) {
					this.toggleMoveMode();
				}
			} );
			this.pinEl.addEventListener( 'keydown', ( event ) =>
				this.onPinKeydown( event as KeyboardEvent ),
			);
			this.pinEl.addEventListener( 'blur', () => this.exitMoveMode( false ) );
		} else {
			this.pinEl.setAttribute( 'aria-hidden', 'true' );
		}

		// The paper.
		this.paperEl.className = 'os-pinned-note__paper';
		if ( note.canEdit ) {
			this.paintOwnerPaper();
		} else {
			this.paintViewerPaper();
		}

		this.element.append( this.pinEl, this.paperEl );
	}

	private paintOwnerPaper(): void {
		const meta = document.createElement( 'div' );
		meta.className = 'os-pinned-note__meta';

		const status = document.createElement( 'os-save-status' );
		status.setAttribute( 'mode', 'icon' );
		status.setAttribute( 'phase', 'idle' );
		status.className = 'os-pinned-note__status';
		this.statusEl = status;

		const colorDot = document.createElement( 'button' );
		colorDot.type = 'button';
		colorDot.className = 'os-pinned-note__color-dot';
		this.colorDot = colorDot;
		this.refreshColorDot();
		colorDot.addEventListener( 'click', () => this.cycleColor() );

		meta.append( status, colorDot );

		// Every action lives in the footer. The pushpin is painted over
		// the paper's chrome and covers the middle of the meta row, so
		// that row only ever had space for two controls to the right of
		// it — see notes.css.
		const actions = document.createElement( 'div' );
		actions.className = 'os-pinned-note__actions';

		const visibility = document.createElement( 'os-window-button' );
		visibility.className = 'os-pinned-note__visibility';
		this.visibilityBtn = visibility;
		this.refreshVisibility();
		visibility.addEventListener( 'os-button-activate', () =>
			this.togglePublic(),
		);
		actions.appendChild( visibility );

		// "Convert to post" — only for users who can author posts. Drops
		// the note into a fresh draft (the note itself is trashed) and
		// opens the block editor. The pin can also be dragged onto the
		// Posts dock tile for the same effect (see posts-drop-target.ts).
		if ( this.layer.canCreatePosts ) {
			const convert = document.createElement( 'os-window-button' );
			convert.className = 'os-pinned-note__convert';
			convert.innerHTML = ICON_POST;
			const convertLabel = __( 'Convert to a draft post', 'desktop-mode' );
			convert.setAttribute( 'title', convertLabel );
			// Icon-only button — give screen readers an accessible name.
			convert.setAttribute( 'aria-label', convertLabel );
			convert.addEventListener( 'os-button-activate', () =>
				this.layer.convertNote( this.note ),
			);
			actions.appendChild( convert );
		}

		// The pointer/keyboard equivalent of dragging the pin onto the bin.
		const trash = document.createElement( 'os-window-button' );
		trash.className = 'os-pinned-note__trash';
		trash.innerHTML = ICON_TRASH;
		const trashLabel = __( 'Move to Trash', 'desktop-mode' );
		trash.setAttribute( 'title', trashLabel );
		trash.setAttribute( 'aria-label', trashLabel );
		trash.addEventListener( 'os-button-activate', () => this.confirmTrash() );
		actions.appendChild( trash );

		const editor = document.createElement( 'os-textarea' ) as OsTextareaElement;
		editor.className = 'os-pinned-note__editor';
		editor.setAttribute( 'aria-label', __( 'Note text', 'desktop-mode' ) );
		editor.setAttribute( 'rows', '5' );
		editor.setAttribute( 'auto-grow', '' );
		editor.setAttribute( 'max-rows', '10' );
		editor.setAttribute( 'value', this.note.text );
		// Shell-level shortcuts (Alt+Tab window cycling, Show Desktop)
		// must not fire while typing on paper.
		[ 'keydown', 'keypress', 'keyup' ].forEach( ( eventName ) => {
			editor.addEventListener( eventName, ( event ) => event.stopPropagation() );
		} );
		editor.addEventListener( 'os-input-change', ( event ) => {
			const detail = ( event as CustomEvent< { value: string } > ).detail;
			this.pendingText = detail.value;
			this.setPhase( 'pending' );
			this.scheduleSave();
		} );
		editor.addEventListener( 'os-input-commit', () => this.flushSave() );
		this.editor = editor;

		const footer = document.createElement( 'div' );
		footer.className = 'os-pinned-note__footer';
		footer.appendChild( actions );

		this.paperEl.append( meta, editor, footer );
	}

	private paintViewerPaper(): void {
		const body = document.createElement( 'div' );
		body.className = 'os-pinned-note__body';
		body.textContent = this.note.text;

		const chip = document.createElement( 'div' );
		chip.className = 'os-pinned-note__attribution';
		chip.title = sprintf(
			/* translators: %s: note author display name. */
			__( 'Pinned by %s', 'desktop-mode' ),
			this.note.ownerName,
		);
		const avatar = document.createElement( 'os-avatar' );
		avatar.setAttribute( 'size', '20' );
		avatar.setAttribute( 'name', this.note.ownerName );
		if ( this.note.ownerAvatar ) {
			avatar.setAttribute( 'src', this.note.ownerAvatar );
		}
		const name = document.createElement( 'span' );
		name.className = 'os-pinned-note__attribution-name';
		name.textContent = this.note.ownerName;
		chip.append( avatar, name );

		this.paperEl.append( body, chip );
	}

	private refreshColorDot(): void {
		if ( ! this.colorDot ) {
			return;
		}
		const next = nextNoteColor( this.note.color );
		// The affordance shows the OUTCOME: the dot is painted in the
		// color the click will switch to.
		this.colorDot.style.setProperty(
			'--dm-note-next-paper',
			`var(--dm-note-${ next })`,
		);
		this.colorDot.setAttribute(
			'aria-label',
			sprintf(
				/* translators: %s: next paper color name. */
				__( 'Change paper color (next: %s)', 'desktop-mode' ),
				next,
			),
		);
	}

	private refreshVisibility(): void {
		if ( ! this.visibilityBtn ) {
			return;
		}
		const isPublic = this.note.public;
		this.visibilityBtn.innerHTML = '';
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ isPublic ? 'dashicons-admin-site-alt3' : 'dashicons-lock' }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		this.visibilityBtn.appendChild( icon );
		this.visibilityBtn.setAttribute(
			'title',
			isPublic
				? __( 'Public note — everyone can see it. Click to make private.', 'desktop-mode' )
				: __( 'Private note. Click to share with every desktop user.', 'desktop-mode' ),
		);
		this.visibilityBtn.classList.toggle( 'is-public', isPublic );
	}

	// ------------------------------------------------------------------
	// State
	// ------------------------------------------------------------------

	replace( note: Note ): void {
		const idChanged = note.id !== this.note.id;
		const seedChanged = jitterSeed( note ) !== jitterSeed( this.note );
		const colorChanged = note.color !== this.note.color;
		const positionChanged = note.x !== this.note.x || note.y !== this.note.y;
		const zChanged = note.z !== this.note.z;
		this.note = note;
		if ( zChanged ) {
			// Remote stacking change (another session's bringToFront)
			// — apply to the DOM directly; setZ() would loop it back
			// into a PATCH.
			this.element.style.zIndex = String( note.z );
		}
		if ( idChanged ) {
			this.element.dataset.noteId = String( note.id );
		}
		// The seed is stamped at creation and never changes on edits —
		// this only fires when a controller adopts a different note.
		if ( seedChanged ) {
			this.jitter = noteJitter( jitterSeed( note ) );
			this.element.style.setProperty( '--dm-note-rot', `${ this.jitter.rotation }deg` );
			this.element.style.setProperty( '--dm-pin-dx', `${ this.jitter.pinOffsetX }px` );
			this.element.style.setProperty( '--dm-pin-rot', `${ this.jitter.pinRotation }deg` );
		}
		if ( colorChanged ) {
			this.element.dataset.noteColor = sanitizeNoteColorSlug( note.color );
			this.refreshColorDot();
		}
		if ( positionChanged ) {
			this.applyPosition();
		}
		if ( this.note.canEdit ) {
			if ( this.pendingText === null ) {
				this.editor?.setAttribute( 'value', note.text );
			}
			this.refreshVisibility();
		} else {
			const body = this.paperEl.querySelector(
				'.os-pinned-note__body',
			);
			if ( body ) {
				body.textContent = note.text;
			}
		}
	}

	/**
	 * Remote copies never clobber local unsaved edits; otherwise
	 * accept anything newer than what we render.
	 */
	shouldReplaceFromRemote( note: Note ): boolean {
		if ( this.pendingText !== null || this.saveTimer !== null ) {
			return false;
		}
		return note.updatedAtMs >= this.note.updatedAtMs;
	}

	setZ( z: number ): void {
		this.element.style.zIndex = String( z );
		if ( z === this.note.z || ! this.note.canEdit ) {
			return;
		}
		this.note = { ...this.note, z };
		if ( this.note.id <= 0 ) {
			return;
		}
		if ( this.zTimer !== null ) {
			window.clearTimeout( this.zTimer );
		}
		this.zTimer = window.setTimeout( () => {
			this.zTimer = null;
			this.queuePatch( { z: this.note.z } );
		}, Z_SAVE_DEBOUNCE_MS );
	}

	applyPosition(): void {
		this.element.style.left = `${ ( this.note.x * 100 ).toFixed( 3 ) }%`;
		this.element.style.top = `${ ( this.note.y * 100 ).toFixed( 3 ) }%`;
	}

	/** Optimistically move + persist. Used by drop handler and keyboard. */
	moveTo( x: number, y: number ): void {
		const clamped = this.layer.clampPosition( x, y );
		this.note = { ...this.note, x: clamped.x, y: clamped.y };
		this.applyPosition();
		if ( this.note.id > 0 ) {
			this.queuePatch( { x: clamped.x, y: clamped.y } );
		}
	}

	playInsertion( tempo = 1 ): Promise< void > {
		return playPinInsertion( {
			pin: this.pinEl,
			paper: this.paperEl,
			rippleHost: this.element,
			restRotation: this.jitter.pinRotation,
			fallDistance: tempo >= 1 ? 30 : 12,
			tempo,
		} );
	}

	focusEditor(): void {
		window.setTimeout( () => this.editor?.focusInput?.(), 0 );
	}

	dispose(): void {
		this.disposed = true;
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
			this.saveTimer = null;
		}
		if ( this.zTimer !== null ) {
			window.clearTimeout( this.zTimer );
			this.zTimer = null;
		}
		this.dragCleanup?.();
		this.dragCleanup = null;
	}

	// ------------------------------------------------------------------
	// Autosave
	// ------------------------------------------------------------------

	private setPhase( phase: string ): void {
		this.statusEl?.setAttribute( 'phase', phase );
	}

	private scheduleSave(): void {
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
		}
		this.saveTimer = window.setTimeout( () => {
			this.saveTimer = null;
			this.flushSave();
		}, SAVE_DEBOUNCE_MS );
	}

	/**
	 * Persist edits typed while the note was still optimistic (its
	 * create POST in flight). Called by the drop handler once the
	 * server id lands — without it, a save debounce that fired on the
	 * temp id would strand `pendingText` forever (text lost on reload
	 * AND remote replacement blocked, since `shouldReplaceFromRemote`
	 * refuses while local edits are pending).
	 */
	flushPendingEdits(): void {
		this.flushSave();
	}

	private flushSave(): void {
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
			this.saveTimer = null;
		}
		if ( this.pendingText === null || this.note.id <= 0 ) {
			return;
		}
		const text = this.pendingText;
		this.pendingText = null;
		this.note = { ...this.note, text };
		this.setPhase( 'saving' );
		this.queuePatch( { text } );
	}

	private cycleColor(): void {
		const color = nextNoteColor( this.note.color );
		this.note = { ...this.note, color };
		this.element.dataset.noteColor = color;
		this.refreshColorDot();
		if ( this.note.id > 0 ) {
			this.queuePatch( { color } );
		}
	}

	private togglePublic(): void {
		const isPublic = ! this.note.public;
		this.note = { ...this.note, public: isPublic };
		this.refreshVisibility();
		if ( isPublic && ! prefersReducedMotion() && this.visibilityBtn ) {
			// The "stamp" pulse — the note just went up on the shared wall.
			this.visibilityBtn.animate?.(
				[
					{ transform: 'scale(1)' },
					{ transform: 'scale(1.25)' },
					{ transform: 'scale(1)' },
				],
				{ duration: 300, easing: 'ease-out' },
			);
		}
		this.layer.announce(
			isPublic
				? __( 'Note is now public.', 'desktop-mode' )
				: __( 'Note is now private.', 'desktop-mode' ),
		);
		if ( this.note.id > 0 ) {
			this.queuePatch( { public: isPublic } );
		}
	}

	/**
	 * Shared by the footer's trash button and move-mode's Delete key.
	 * Drag-to-bin skips the dialog: the drop is the confirmation, and
	 * it already has the crumple and an Undo toast.
	 */
	private confirmTrash(): void {
		void osConfirm( {
			title: __( 'Move note to the Trash?', 'desktop-mode' ),
			message: __( 'You can restore it from the Trash later.', 'desktop-mode' ),
			confirmLabel: __( 'Move to Trash', 'desktop-mode' ),
			danger: true,
		} ).then( ( confirmed ) => {
			if ( confirmed ) {
				this.layer.trashNote( this.note );
			}
		} );
	}

	/**
	 * All PATCHes flow through one chain so the concurrency token is
	 * always the latest server-issued one, even when a text save and
	 * a position save race.
	 */
	private queuePatch( body: UpdateNoteBody ): void {
		this.patchChain = this.patchChain.then( async () => {
			if ( this.disposed || this.note.id <= 0 ) {
				return;
			}
			try {
				const saved = await updateNote( this.note.id, {
					...body,
					updatedAtMs: this.note.updatedAtMs,
				} );
				if ( this.disposed ) {
					return;
				}
				// Adopt the server's token (and any fields we didn't
				// touch) without clobbering in-flight local edits.
				const publicChanged = saved.public !== this.note.public;
				this.note = {
					...this.note,
					updatedAtMs: saved.updatedAtMs,
					public: saved.public,
				};
				if ( publicChanged ) {
					this.refreshVisibility();
				}
				this.setPhase( 'saved' );
			} catch ( err ) {
				if ( this.disposed ) {
					return;
				}
				if ( isNotesConflict( err ) && err.current ) {
					this.pendingText = null;
					this.replace( err.current );
					this.setPhase( 'idle' );
					this.layer.notifyError(
						__( 'This note was changed in another session — showing the latest version.', 'desktop-mode' ),
					);
					return;
				}
				this.setPhase( 'failed' );
				// eslint-disable-next-line no-console
				console.error( '[openstation] notes: save failed:', err );
			}
		} );
	}

	// ------------------------------------------------------------------
	// Drag (owner only)
	// ------------------------------------------------------------------

	private startDrag( event: PointerEvent ): void {
		if ( ! this.note.canEdit || this.note.id <= 0 ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		// Suppress the native text-selection sweep the pointer would
		// otherwise drag across the paper / neighboring notes.
		event.preventDefault();
		this.element.ownerDocument.defaultView
			?.getSelection()
			?.removeAllRanges();
		const ghost = this.buildGhost();
		const noteRect = this.element.getBoundingClientRect();
		const data: NoteDragData = {
			noteId: this.note.id,
			canEdit: this.note.canEdit,
			updatedAtMs: this.note.updatedAtMs,
		};
		const session = dragManager.start( {
			payload: {
				type: NOTE_PAYLOAD_TYPE,
				source: this.element,
				data,
				ghost: {
					element: ghost.root,
					// The needle tip rides exactly under the cursor —
					// the user is holding the pin.
					offsetX: ghost.tipX,
					offsetY: ghost.tipY,
					hint: {
						neutral: __( 'Drop on the desktop to pin', 'desktop-mode' ),
						accept: __( 'Pin here', 'desktop-mode' ),
						reject: __( 'Can’t pin here', 'desktop-mode' ),
					},
				},
			},
			origin: event,
			onClickOnly: () => {
				// Sub-threshold gestures fire NEITHER onCancel nor
				// onCommit — without this teardown, every pin click
				// would leak the session's document listeners.
				this.teardownDragListeners();
				this.toggleMoveMode();
			},
			onCancel: () => {
				this.teardownDragListeners();
				void this.snapBack( noteRect );
			},
			onCommit: () => {
				this.teardownDragListeners();
				// A wallpaper drop already moved us (Seam A handler runs
				// before onCommit); a bin drop evicted us. Re-seat the
				// pin only if we're still on the wall.
				if ( this.layer.has( this.note.id ) ) {
					void this.playInsertion( 0.7 );
				}
			},
		} );
		if ( ! session ) {
			return;
		}
		this.installDragListeners( ghost );
	}

	private buildGhost(): GhostParts & { tipX: number; tipY: number } {
		const noteRect = this.element.getBoundingClientRect();
		const pinImg = this.pinEl.querySelector( 'img' );
		const pinRect = ( pinImg ?? this.pinEl ).getBoundingClientRect();
		// Needle tip in ghost-local coordinates.
		const tipX = pinRect.left - noteRect.left + pinRect.width * PIN_TIP_X;
		const tipY = pinRect.top - noteRect.top + pinRect.height * PIN_TIP_Y;

		const root = document.createElement( 'div' );
		root.className = 'os-pinned-note-ghost';
		root.style.width = `${ noteRect.width }px`;
		root.style.height = `${ noteRect.height }px`;

		const swing = document.createElement( 'div' );
		swing.className = 'os-pinned-note-ghost__swing';
		swing.style.transformOrigin = `${ tipX }px ${ tipY }px`;

		const pin = this.pinEl.cloneNode( true ) as HTMLElement;
		pin.removeAttribute( 'aria-pressed' );
		pin.setAttribute( 'aria-hidden', 'true' );
		const paper = this.paperEl.cloneNode( true ) as HTMLElement;
		paper.classList.add( 'os-pinned-note-ghost__paper' );
		// Carry the pastel binding onto the detached clone.
		swing.dataset.noteColor = this.element.dataset.noteColor ?? '';

		swing.append( pin, paper );
		root.appendChild( swing );
		return { root, swing, pin, paper, tipX, tipY };
	}

	private installDragListeners( ghost: GhostParts ): void {
		// Never stack sessions: a previous session that ended through
		// the click-only path (or a pathological double-start) must
		// not leave its document listeners behind.
		this.teardownDragListeners();
		let pendulum: PendulumHandle | null = null;

		const onStart = ( ev: Event ): void => {
			const detail = ( ev as CustomEvent< { payload?: { data?: NoteDragData } } > ).detail;
			if ( detail?.payload?.data?.noteId !== this.note.id ) {
				return;
			}
			pendulum = startPendulum( ghost.swing );
		};
		const onMove = ( ev: Event ): void => {
			const detail = (
				ev as CustomEvent< { clientX: number; clientY: number } >
			).detail;
			this.lastPointer = { x: detail.clientX, y: detail.clientY };
			pendulum?.onPointerMove( detail.clientX );
		};
		const onEnter = ( ev: Event ): void => {
			const detail = ( ev as CustomEvent< { targetId?: string } > ).detail;
			if ( detail?.targetId?.startsWith( 'recycle-bin' ) ) {
				ghost.root.classList.add( 'os-pinned-note-ghost--doom' );
				pendulum?.setBias( 6 );
			}
		};
		const onLeave = ( ev: Event ): void => {
			const detail = ( ev as CustomEvent< { targetId?: string } > ).detail;
			if ( detail?.targetId?.startsWith( 'recycle-bin' ) ) {
				ghost.root.classList.remove( 'os-pinned-note-ghost--doom' );
				pendulum?.setBias( 0 );
			}
		};

		document.addEventListener( DRAG_EVENTS.START, onStart );
		document.addEventListener( DRAG_EVENTS.MOVE, onMove );
		document.addEventListener( DRAG_EVENTS.ENTER, onEnter );
		document.addEventListener( DRAG_EVENTS.LEAVE, onLeave );

		this.dragCleanup = (): void => {
			pendulum?.stop();
			pendulum = null;
			document.removeEventListener( DRAG_EVENTS.START, onStart );
			document.removeEventListener( DRAG_EVENTS.MOVE, onMove );
			document.removeEventListener( DRAG_EVENTS.ENTER, onEnter );
			document.removeEventListener( DRAG_EVENTS.LEAVE, onLeave );
		};
	}

	private teardownDragListeners(): void {
		this.dragCleanup?.();
		this.dragCleanup = null;
	}

	private async snapBack( homeRect: DOMRect ): Promise< void > {
		if ( ! this.lastPointer || prefersReducedMotion() ) {
			void this.playInsertion( 0.63 );
			return;
		}
		// The manager already disposed its ghost — fly a fresh visual
		// clone home, then re-seat the pin on the real note.
		const flyback = this.buildGhost();
		flyback.root.classList.add( 'os-pinned-note-ghost--flyback' );
		flyback.root.style.position = 'fixed';
		flyback.root.style.left = `${ this.lastPointer.x - flyback.tipX }px`;
		flyback.root.style.top = `${ this.lastPointer.y - flyback.tipY }px`;
		flyback.root.style.zIndex = '2147483647';
		flyback.root.style.pointerEvents = 'none';
		document.body.appendChild( flyback.root );
		try {
			await playSnapBack( {
				flyback: flyback.root,
				swing: flyback.swing,
				homeX: homeRect.left,
				homeY: homeRect.top,
			} );
		} finally {
			flyback.root.remove();
		}
		void this.playInsertion( 0.63 );
	}

	/** Crumple visual played by the bin drop handler at the release point. */
	async playCrumpleAt( clientX: number, clientY: number ): Promise< void > {
		const ghost = this.buildGhost();
		ghost.root.classList.add( 'os-pinned-note-ghost--flyback' );
		ghost.root.style.position = 'fixed';
		ghost.root.style.left = `${ clientX - ghost.tipX }px`;
		ghost.root.style.top = `${ clientY - ghost.tipY }px`;
		ghost.root.style.zIndex = '2147483647';
		ghost.root.style.pointerEvents = 'none';
		document.body.appendChild( ghost.root );
		try {
			await playCrumpleIntoBin( {
				clone: ghost.root,
				pin: ghost.pin,
				paper: ghost.paper,
				binX: clientX,
				binY: clientY + 24,
			} );
		} finally {
			ghost.root.remove();
		}
	}

	// ------------------------------------------------------------------
	// Keyboard move mode
	// ------------------------------------------------------------------

	private toggleMoveMode(): void {
		if ( this.moveMode ) {
			this.exitMoveMode( true );
		} else {
			this.enterMoveMode();
		}
	}

	private enterMoveMode(): void {
		if ( ! this.note.canEdit ) {
			return;
		}
		this.moveMode = true;
		this.moveOrigin = { x: this.note.x, y: this.note.y };
		this.element.classList.add( 'os-pinned-note--move-mode' );
		this.pinEl.setAttribute( 'aria-pressed', 'true' );
		this.layer.announce(
			__(
				'Moving note. Arrow keys to move, Enter to place, Escape to cancel, Delete to move to the Trash.',
				'desktop-mode',
			),
		);
	}

	private exitMoveMode( commit: boolean ): void {
		if ( ! this.moveMode ) {
			return;
		}
		this.moveMode = false;
		this.element.classList.remove( 'os-pinned-note--move-mode' );
		this.pinEl.setAttribute( 'aria-pressed', 'false' );
		if ( commit ) {
			this.moveTo( this.note.x, this.note.y );
			this.layer.announce( __( 'Note placed.', 'desktop-mode' ) );
			void this.playInsertion( 0.7 );
		} else if ( this.moveOrigin ) {
			this.note = { ...this.note, ...this.moveOrigin };
			this.applyPosition();
		}
		this.moveOrigin = null;
	}

	private onPinKeydown( event: KeyboardEvent ): void {
		if ( ! this.moveMode ) {
			// Enter/Space activate the button → click → toggleMoveMode
			// via onClickOnly-less path; nothing to do here.
			return;
		}
		const { width, height } = this.layer.hostSize();
		const step = event.shiftKey ? KEYBOARD_FINE_STEP_PX : KEYBOARD_STEP_PX;
		const dx = step / width;
		const dy = step / height;
		switch ( event.key ) {
			case 'ArrowLeft':
				this.nudge( -dx, 0 );
				break;
			case 'ArrowRight':
				this.nudge( dx, 0 );
				break;
			case 'ArrowUp':
				this.nudge( 0, -dy );
				break;
			case 'ArrowDown':
				this.nudge( 0, dy );
				break;
			case 'Enter':
			case ' ':
				this.exitMoveMode( true );
				break;
			case 'Escape':
				this.exitMoveMode( false );
				this.layer.announce( __( 'Move cancelled.', 'desktop-mode' ) );
				break;
			case 'Delete':
			case 'Backspace':
				this.exitMoveMode( false );
				this.confirmTrash();
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	private nudge( dx: number, dy: number ): void {
		const clamped = this.layer.clampPosition( this.note.x + dx, this.note.y + dy );
		this.note = { ...this.note, ...clamped };
		this.applyPosition();
	}
}
