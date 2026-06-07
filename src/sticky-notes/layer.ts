import { addAction, addFilter, HOOKS } from '../hooks';
import { __ } from '../i18n';
import '../ui/components/wpd-save-status/wpd-save-status';
import '../ui/components/wpd-textarea/wpd-textarea';
import '../ui/components/wpd-window-button/wpd-window-button';
import {
	buildGuidelineEditUrl,
	fetchStickyNotes,
	resolveStickyTerms,
	saveStickyNote,
	type StickyNotesRestConfig,
} from './rest';
import { startStickyNotesHeartbeat } from './heartbeat';
import {
	DEFAULT_STICKY_TITLE,
	generatedTitle,
	noteFromGuideline,
	titleForBody,
} from './text';
import type {
	StickyNotesHeartbeatPayload,
	StickyNotesHeartbeatSubscribe,
	StickyGeometry,
	StickyNote,
	StickyTerms,
} from './types';

type SavePhase = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

interface StickyNotesLayerOptions {
	host: HTMLElement;
	config: StickyNotesRestConfig;
	/**
	 * Whether the Gutenberg Guidelines experiment (the `wp_guideline`
	 * CPT + `wp_guideline_type` taxonomy) is registered server-side.
	 * When `false`, `boot()` returns immediately without touching the
	 * network — the supporting REST routes would only 404. Defaults to
	 * `true` so a shell that doesn't pass the flag keeps the prior
	 * boot-and-swallow behavior.
	 */
	available?: boolean;
	openArtifact: ( url: string, title: string, guidelineId: number ) => void;
	getActiveDesktopId?: () => string;
	onError?: ( message: string ) => void;
}

type WpdTextareaElement = HTMLElement & {
	focusInput?: () => void;
};

const GEOMETRY_KEY = 'desktop-mode-sticky-notes-geometry';
const DEFAULT_WIDTH = 264;
const DEFAULT_HEIGHT = 176;
const MIN_WIDTH = 180;
const MIN_HEIGHT = 128;
const EDGE_PADDING = 16;
const SAVE_DEBOUNCE_MS = 1000;

export class StickyNotesLayer {
	private host: HTMLElement;
	private config: StickyNotesRestConfig;
	private available: boolean;
	private openArtifact: ( url: string, title: string, guidelineId: number ) => void;
	private getActiveDesktopId: () => string;
	private onError?: ( message: string ) => void;
	private root: HTMLElement | null = null;
	private terms: StickyTerms | null = null;
	private controllers = new Map< string, StickyNoteController >();
	private contextMenuInstalled = false;
	private desktopHooksInstalled = false;
	private highWaterMs = 0;
	private zIndexCounter = 0;

	constructor( options: StickyNotesLayerOptions ) {
		this.host = options.host;
		this.config = options.config;
		this.available = options.available ?? true;
		this.openArtifact = options.openArtifact;
		this.getActiveDesktopId = options.getActiveDesktopId ?? ( () => 'desktop-1' );
		this.onError = options.onError;
	}

	async boot(): Promise< void > {
		// Sticky notes ride on Gutenberg's Guidelines experiment (the
		// `wp_guideline` CPT + `wp_guideline_type` taxonomy). When that
		// experiment isn't registered the supporting REST routes 404 —
		// harmless (the errors below are swallowed) but noisy in the
		// console and a wasted round-trip on every boot. The shell tells
		// us up front whether the routes exist; skip the boot entirely
		// when they don't. `available` defaults to `true`, so a shell
		// that predates the flag keeps the prior boot-and-swallow path.
		if ( ! this.available ) {
			return;
		}
		try {
			this.terms = await resolveStickyTerms( this.config );
			if ( ! this.terms ) {
				return;
			}
			this.installContextMenu();
			this.installDesktopHooks();
			const notes = await fetchStickyNotes(
				this.config,
				this.terms.stickyTermId,
			);
			this.bumpHighWaterFromNotes( notes );
			startStickyNotesHeartbeat( this );
			if ( notes.length === 0 ) {
				return;
			}
			this.ensureRoot();
			sortNotesByModified( notes ).forEach( ( note, index ) =>
				this.upsert( note, index ),
			);
		} catch ( error ) {
			// Sticky guidelines are an optional Gutenberg-side surface.
			// Missing endpoints or denied private guidelines should not
			// make the desktop noisy on boot.
			if ( error instanceof Error ) {
				// eslint-disable-next-line no-console
				console.debug( '[desktop-mode] Sticky notes unavailable:', error.message );
			}
		}
	}

	createNote( body = '' ): void {
		if ( ! this.terms ) {
			return;
		}
		const note: StickyNote = {
			localId: `local:${ Date.now() }:${ Math.random().toString( 36 ).slice( 2 ) }`,
			guidelineId: null,
			title: body.trim() ? generatedTitle( body ) : DEFAULT_STICKY_TITLE,
			body,
			termIds: this.terms.termIds,
		};
		const controller = this.upsert( note, this.controllers.size, {
			activate: true,
		} );
		controller.focus();
	}

	private upsert(
		note: StickyNote,
		index: number,
		options: { activate?: boolean } = {},
	): StickyNoteController {
		this.ensureRoot();
		const key = noteKey( note );
		const existing = this.controllers.get( key );
		if ( existing ) {
			existing.replace( note );
			if ( options.activate ) {
				this.bringToFront( existing );
			}
			return existing;
		}
		const controller = new StickyNoteController( {
			layer: this,
			note,
			index,
		} );
		this.controllers.set( key, controller );
		this.root?.appendChild( controller.element );
		this.assignZIndex( controller );
		this.applyDesktopVisibility( controller );
		if ( options.activate ) {
			this.bringToFront( controller );
		}
		return controller;
	}

	private ensureRoot(): HTMLElement {
		if ( this.root ) {
			return this.root;
		}
		const root = document.createElement( 'section' );
		root.className = 'desktop-mode-sticky-notes';
		root.setAttribute( 'aria-label', __( 'Sticky notes' ) );
		this.host.appendChild( root );
		this.root = root;
		return root;
	}

	private installContextMenu(): void {
		if ( this.contextMenuInstalled ) {
			return;
		}
		this.contextMenuInstalled = true;
		addFilter(
			'desktop-mode.wallpaper-context-menu',
			'desktop-mode/sticky-notes',
			( items: unknown ) => {
				if ( ! Array.isArray( items ) || ! this.terms ) {
					return items;
				}
				if (
					items.some( ( item ) =>
						( item as { id?: unknown } ).id === 'new-sticky-note',
					)
				) {
					return items;
				}
				return [
					...items,
					{
						id: 'new-sticky-note',
						label: __( 'New sticky note' ),
						icon: 'dashicons-edit-page',
						sort: 14,
						onClick: () => this.createNote(),
					},
				];
			},
		);
	}

	private installDesktopHooks(): void {
		if ( this.desktopHooksInstalled ) {
			return;
		}
		this.desktopHooksInstalled = true;
		addAction(
			HOOKS.DESKTOP_SWITCHED,
			'desktop-mode/sticky-notes',
			() => this.refreshDesktopVisibility(),
		);
		addAction< [ { desktopId?: string; migratedTo?: string } ] >(
			HOOKS.DESKTOP_CLOSED,
			'desktop-mode/sticky-notes',
			( detail ) => {
				this.migrateDesktopAssignments( detail?.desktopId, detail?.migratedTo );
				this.refreshDesktopVisibility();
			},
		);
	}

	save( note: StickyNote ): Promise< StickyNote > {
		if ( ! this.terms ) {
			return Promise.reject( new Error( __( 'Sticky term is unavailable.' ) ) );
		}
		return saveStickyNote( this.config, note, this.terms );
	}

	getHeartbeatSubscription(): StickyNotesHeartbeatSubscribe | undefined {
		if ( ! this.terms ) {
			return undefined;
		}
		return {
			stickyTermId: this.terms.stickyTermId,
			knownIds: this.knownGuidelineIds(),
			version: this.highWaterMs,
		};
	}

	applyHeartbeatPayload( payload: StickyNotesHeartbeatPayload ): void {
		for ( const guideline of payload.notes ?? [] ) {
			const note = noteFromGuideline( guideline );
			this.upsertRemote( note );
		}
		for ( const id of payload.removed ?? [] ) {
			this.forgetGuidelineId( id );
		}
		if (
			typeof payload.serverTimeMs === 'number' &&
			Number.isFinite( payload.serverTimeMs ) &&
			payload.serverTimeMs > this.highWaterMs
		) {
			this.highWaterMs = payload.serverTimeMs;
		}
		if ( payload.truncated ) {
			void this.reloadFromServer();
		}
	}

	openNoteArtifact( note: StickyNote ): void {
		if ( note.guidelineId === null ) {
			return;
		}
		this.openArtifact(
			buildGuidelineEditUrl( this.config.adminUrl, note.guidelineId ),
			note.title,
			note.guidelineId,
		);
	}

	notifyError( message: string ): void {
		this.onError?.( message );
	}

	hostSize(): { width: number; height: number } {
		return {
			width: Math.max( 1, this.host.clientWidth ),
			height: Math.max( 1, this.host.clientHeight ),
		};
	}

	defaultGeometry( index: number ): StickyGeometry {
		const { width: hostWidth, height: hostHeight } = this.hostSize();
		const width = Math.min(
			DEFAULT_WIDTH,
			Math.max( MIN_WIDTH, hostWidth - EDGE_PADDING * 2 ),
		);
		const height = Math.min(
			DEFAULT_HEIGHT,
			Math.max( MIN_HEIGHT, hostHeight - EDGE_PADDING * 2 ),
		);
		const offset = ( index % 8 ) * 28;
		const left = clamp(
			hostWidth - width - 32 - offset,
			EDGE_PADDING,
			Math.max( EDGE_PADDING, hostWidth - width - EDGE_PADDING ),
		);
		const top = clamp(
			32 + offset,
			EDGE_PADDING,
			Math.max( EDGE_PADDING, hostHeight - height - EDGE_PADDING ),
		);
		return {
			x: left / hostWidth,
			y: top / hostHeight,
			width,
			height,
		};
	}

	forget( controller: StickyNoteController ): void {
		this.controllers.delete( noteKey( controller.note ) );
		controller.dispose();
		controller.element.remove();
		if ( this.controllers.size === 0 ) {
			this.root?.remove();
			this.root = null;
		}
	}

	replaceControllerKey( oldKey: string, controller: StickyNoteController ): void {
		const newKey = noteKey( controller.note );
		this.controllers.delete( oldKey );
		this.controllers.set( newKey, controller );
		moveStoredGeometry( oldKey, newKey );
		this.applyDesktopVisibility( controller );
	}

	bumpHighWaterFromNote( note: StickyNote ): void {
		const modifiedMs = noteModifiedMs( note );
		if ( modifiedMs > this.highWaterMs ) {
			this.highWaterMs = modifiedMs;
		}
	}

	bringToFront( controller: StickyNoteController ): void {
		controller.setZIndex( this.nextZIndex() );
	}

	geometryForNote( note: StickyNote, index: number ): StickyGeometry {
		const key = noteKey( note );
		const loaded = loadGeometry( key );
		const desktopId = this.normalizeDesktopId( loaded?.desktopId );
		const geometry = loaded
			? { ...loaded, desktopId }
			: { ...this.defaultGeometry( index ), desktopId };
		if (
			! loaded ||
			loaded.desktopId !== geometry.desktopId
		) {
			saveGeometry( key, geometry );
		}
		return geometry;
	}

	private upsertRemote( note: StickyNote ): StickyNoteController {
		const key = noteKey( note );
		const existing = this.controllers.get( key );
		if ( existing ) {
			if ( ! existing.shouldReplaceFromRemote( note ) ) {
				this.bumpHighWaterFromNote( note );
				return existing;
			}
			existing.replace( note );
			this.bumpHighWaterFromNote( note );
			return existing;
		}
		const controller = this.upsert( note, this.controllers.size );
		this.bumpHighWaterFromNote( note );
		return controller;
	}

	private forgetGuidelineId( guidelineId: number ): void {
		for ( const controller of this.controllers.values() ) {
			if ( controller.note.guidelineId === guidelineId ) {
				this.forget( controller );
				return;
			}
		}
	}

	private knownGuidelineIds(): number[] {
		const ids: number[] = [];
		for ( const controller of this.controllers.values() ) {
			if ( controller.note.guidelineId !== null ) {
				ids.push( controller.note.guidelineId );
			}
		}
		return ids;
	}

	private bumpHighWaterFromNotes( notes: StickyNote[] ): void {
		notes.forEach( ( note ) => this.bumpHighWaterFromNote( note ) );
	}

	private assignZIndex( controller: StickyNoteController ): void {
		controller.setZIndex( this.nextZIndex() );
	}

	private nextZIndex(): number {
		this.zIndexCounter += 1;
		return this.zIndexCounter;
	}

	private applyDesktopVisibility( controller: StickyNoteController ): void {
		controller.setVisible( this.isNoteOnActiveDesktop( controller.note ) );
	}

	private refreshDesktopVisibility(): void {
		for ( const controller of this.controllers.values() ) {
			this.applyDesktopVisibility( controller );
		}
	}

	private isNoteOnActiveDesktop( note: StickyNote ): boolean {
		const key = noteKey( note );
		const geometry = loadGeometry( key );
		const desktopId = this.normalizeDesktopId( geometry?.desktopId );
		if ( geometry && geometry.desktopId !== desktopId ) {
			saveGeometry( key, { ...geometry, desktopId } );
		}
		return desktopId === this.activeDesktopId();
	}

	private migrateDesktopAssignments(
		desktopId: string | undefined,
		migratedTo: string | undefined,
	): void {
		if ( ! desktopId || ! migratedTo || desktopId === migratedTo ) {
			return;
		}
		const map = readGeometryMap();
		let changed = false;
		Object.entries( map ).forEach( ( [ key, geometry ] ) => {
			if ( geometry.desktopId === desktopId ) {
				map[ key ] = {
					...geometry,
					desktopId: this.normalizeDesktopId( migratedTo ),
				};
				changed = true;
			}
		} );
		if ( changed ) {
			writeGeometryMap( map );
		}
	}

	private activeDesktopId(): string {
		try {
			const id = this.getActiveDesktopId();
			return typeof id === 'string' && id ? id : 'desktop-1';
		} catch {
			return 'desktop-1';
		}
	}

	private normalizeDesktopId( desktopId: string | undefined ): string {
		if ( ! desktopId ) {
			return this.activeDesktopId();
		}
		return desktopId;
	}

	private async reloadFromServer(): Promise< void > {
		if ( ! this.terms ) {
			return;
		}
		try {
			const notes = await fetchStickyNotes(
				this.config,
				this.terms.stickyTermId,
			);
			const ids = new Set< number >();
			sortNotesByModified( notes ).forEach( ( note ) => {
				if ( note.guidelineId !== null ) {
					ids.add( note.guidelineId );
				}
				this.upsertRemote( note );
			} );
			this.knownGuidelineIds().forEach( ( id ) => {
				if ( ! ids.has( id ) ) {
					this.forgetGuidelineId( id );
				}
			} );
		} catch {
			// Quiet — the next heartbeat tick can try again.
		}
	}
}

class StickyNoteController {
	element: HTMLElement;
	note: StickyNote;
	private layer: StickyNotesLayer;
	private index: number;
	private titleEl: HTMLElement;
	private editor: WpdTextareaElement;
	private statusEl: HTMLElement;
	private openButton: HTMLElement;
	private saveTimer: number | null = null;
	private geometryTimer: number | null = null;
	private saving = false;
	private saveAgain = false;
	private resizeObserver: ResizeObserver | null = null;
	private disposed = false;

	constructor( options: {
		layer: StickyNotesLayer;
		note: StickyNote;
		index: number;
	} ) {
		this.layer = options.layer;
		this.note = options.note;
		this.index = options.index;
		this.element = document.createElement( 'article' );
		this.element.className = 'desktop-mode-sticky-note';
		this.element.dataset.stickyNoteId = noteKey( this.note );
		this.titleEl = document.createElement( 'span' );
		this.editor = document.createElement( 'wpd-textarea' ) as WpdTextareaElement;
		this.statusEl = document.createElement( 'wpd-save-status' );
		this.openButton = document.createElement( 'wpd-window-button' );
		this.paint();
		this.applyGeometry( this.layer.geometryForNote( this.note, this.index ) );
		this.element.addEventListener(
			'pointerdown',
			() => this.layer.bringToFront( this ),
			{ capture: true },
		);
		this.element.addEventListener( 'focusin', () => this.layer.bringToFront( this ) );
		this.watchResize();
	}

	focus(): void {
		window.setTimeout( () => this.editor.focusInput?.(), 0 );
	}

	replace( note: StickyNote ): void {
		this.note = note;
		this.element.dataset.stickyNoteId = noteKey( this.note );
		this.titleEl.textContent = this.note.title;
		this.editor.setAttribute( 'value', this.note.body );
		this.refreshOpenButton();
	}

	shouldReplaceFromRemote( note: StickyNote ): boolean {
		if ( this.hasLocalChanges() ) {
			return false;
		}
		const currentMs = noteModifiedMs( this.note );
		const incomingMs = noteModifiedMs( note );
		if (
			currentMs > 0 &&
			incomingMs > 0 &&
			incomingMs <= currentMs &&
			this.note.title === note.title &&
			this.note.body === note.body
		) {
			return false;
		}
		return true;
	}

	setZIndex( zIndex: number ): void {
		this.element.style.zIndex = String( zIndex );
	}

	setVisible( visible: boolean ): void {
		this.element.style.display = visible ? '' : 'none';
	}

	dispose(): void {
		this.disposed = true;
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
			this.saveTimer = null;
		}
		if ( this.geometryTimer !== null ) {
			window.clearTimeout( this.geometryTimer );
			this.geometryTimer = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private paint(): void {
		this.element.innerHTML = '';
		this.element.style.minWidth = `${ MIN_WIDTH }px`;
		this.element.style.minHeight = `${ MIN_HEIGHT }px`;

		const header = document.createElement( 'div' );
		header.className = 'desktop-mode-sticky-note__header';

		const grip = document.createElement( 'span' );
		grip.className = 'desktop-mode-sticky-note__grip';
		grip.setAttribute( 'aria-hidden', 'true' );

		this.titleEl.className = 'desktop-mode-sticky-note__title';
		this.titleEl.textContent = this.note.title;

		this.statusEl.setAttribute( 'mode', 'icon' );
		this.statusEl.setAttribute( 'phase', 'idle' );
		this.statusEl.className = 'desktop-mode-sticky-note__status';

		this.openButton.setAttribute( 'icon', 'detach' );
		this.openButton.setAttribute( 'title', __( 'Open artifact' ) );
		this.openButton.className = 'desktop-mode-sticky-note__open';
		this.openButton.addEventListener( 'wpd-button-activate', () => {
			this.layer.openNoteArtifact( this.note );
		} );

		const close = document.createElement( 'wpd-window-button' );
		close.setAttribute( 'icon', 'close' );
		close.setAttribute( 'danger', '' );
		close.setAttribute( 'title', __( 'Hide sticky note' ) );
		close.className = 'desktop-mode-sticky-note__close';
		close.addEventListener( 'wpd-button-activate', () => this.close() );

		header.append( grip, this.titleEl, this.statusEl, this.openButton, close );
		header.addEventListener( 'pointerdown', ( event ) => this.startDrag( event ) );

		this.editor.className = 'desktop-mode-sticky-note__editor';
		this.editor.setAttribute( 'aria-label', __( 'Sticky note text' ) );
		this.editor.setAttribute( 'rows', '8' );
		this.editor.setAttribute( 'value', this.note.body );
		this.installEditorKeyboardGuard();
		this.editor.addEventListener( 'wpd-input-change', ( event ) => {
			const detail = ( event as CustomEvent< { value: string } > ).detail;
			this.note.body = detail.value;
			this.note.title = titleForBody( detail.value );
			this.titleEl.textContent = this.note.title;
			this.setPhase( 'pending' );
			this.scheduleSave();
		} );
		this.editor.addEventListener( 'wpd-input-commit', () => this.flushSave() );

		this.element.append( header, this.editor );
		this.refreshOpenButton();
	}

	private installEditorKeyboardGuard(): void {
		[ 'keydown', 'keypress', 'keyup' ].forEach( ( eventName ) => {
			this.editor.addEventListener( eventName, ( event ) => {
				event.stopPropagation();
			} );
		} );
	}

	private refreshOpenButton(): void {
		const disabled = this.note.guidelineId === null;
		this.openButton.classList.toggle( 'is-disabled', disabled );
		this.openButton.setAttribute( 'aria-disabled', disabled ? 'true' : 'false' );
	}

	private close(): void {
		if (
			this.note.guidelineId === null &&
			this.note.body.trim().length === 0
		) {
			this.layer.forget( this );
			return;
		}
		this.flushSave();
		this.layer.forget( this );
	}

	private scheduleSave(): void {
		if (
			this.note.guidelineId === null &&
			this.note.body.trim().length === 0
		) {
			this.setPhase( 'idle' );
			return;
		}
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
		}
		this.saveTimer = window.setTimeout( () => {
			this.saveTimer = null;
			void this.save();
		}, SAVE_DEBOUNCE_MS );
	}

	private flushSave(): void {
		if ( this.saveTimer !== null ) {
			window.clearTimeout( this.saveTimer );
			this.saveTimer = null;
		}
		if (
			this.note.guidelineId !== null ||
			this.note.body.trim().length > 0
		) {
			void this.save();
		}
	}

	private async save(): Promise< void > {
		if ( this.saving ) {
			this.saveAgain = true;
			this.setPhase( 'pending' );
			return;
		}
		this.saving = true;
		this.setPhase( 'saving' );
		const bodyAtSave = this.note.body;
		try {
			const saved = await this.layer.save( {
				...this.note,
				body: bodyAtSave,
			} );
			if ( this.disposed ) {
				return;
			}
			const oldKey = noteKey( this.note );
			this.note.guidelineId = saved.guidelineId;
			this.note.modified = saved.modified;
			this.note.link = saved.link;
			this.note.termIds = saved.termIds.length > 0 ? saved.termIds : this.note.termIds;
			if ( this.note.body === bodyAtSave ) {
				this.note.title = saved.title;
				this.titleEl.textContent = saved.title;
			}
			if ( oldKey !== noteKey( this.note ) ) {
				this.element.dataset.stickyNoteId = noteKey( this.note );
				this.layer.replaceControllerKey( oldKey, this );
			}
			this.layer.bumpHighWaterFromNote( this.note );
			this.refreshOpenButton();
			this.setPhase( 'saved' );
		} catch ( error ) {
			if ( this.disposed ) {
				return;
			}
			const message = error instanceof Error
				? error.message
				: __( 'Could not save sticky note.' );
			this.setPhase( 'failed', message );
			this.layer.notifyError( message );
		} finally {
			this.saving = false;
			if ( ! this.disposed && this.saveAgain ) {
				this.saveAgain = false;
				this.scheduleSave();
			}
		}
	}

	private setPhase( phase: SavePhase, error?: string ): void {
		this.statusEl.setAttribute( 'phase', phase );
		if ( error ) {
			this.statusEl.setAttribute( 'error', error );
			this.statusEl.setAttribute( 'title', error );
		} else {
			this.statusEl.removeAttribute( 'error' );
			this.statusEl.removeAttribute( 'title' );
		}
	}

	private hasLocalChanges(): boolean {
		const phase = this.statusEl.getAttribute( 'phase' );
		return (
			this.saveTimer !== null ||
			this.saving ||
			this.saveAgain ||
			phase === 'pending' ||
			phase === 'failed'
		);
	}

	private startDrag( event: PointerEvent ): void {
		if ( event.button !== 0 ) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if ( target?.closest( 'wpd-window-button, wpd-save-status' ) ) {
			return;
		}
		event.preventDefault();
		const startRect = this.element.getBoundingClientRect();
		const hostRect = this.layerHostRect();
		const startLeft = startRect.left - hostRect.left;
		const startTop = startRect.top - hostRect.top;
		const startX = event.clientX;
		const startY = event.clientY;
		this.element.classList.add( 'desktop-mode-sticky-note--dragging' );
		this.element.setPointerCapture?.( event.pointerId );

		const move = ( moveEvent: PointerEvent ): void => {
			const width = this.element.offsetWidth;
			const height = this.element.offsetHeight;
			const { width: hostWidth, height: hostHeight } = this.layer.hostSize();
			const left = clamp(
				startLeft + moveEvent.clientX - startX,
				EDGE_PADDING,
				Math.max( EDGE_PADDING, hostWidth - width - EDGE_PADDING ),
			);
			const top = clamp(
				startTop + moveEvent.clientY - startY,
				EDGE_PADDING,
				Math.max( EDGE_PADDING, hostHeight - height - EDGE_PADDING ),
			);
			this.element.style.left = `${ left }px`;
			this.element.style.top = `${ top }px`;
		};
		const up = ( upEvent: PointerEvent ): void => {
			this.element.classList.remove( 'desktop-mode-sticky-note--dragging' );
			this.element.releasePointerCapture?.( upEvent.pointerId );
			document.removeEventListener( 'pointermove', move );
			document.removeEventListener( 'pointerup', up );
			this.persistGeometry();
		};
		document.addEventListener( 'pointermove', move );
		document.addEventListener( 'pointerup', up );
	}

	private applyGeometry( geometry: StickyGeometry ): void {
		const { width: hostWidth, height: hostHeight } = this.layer.hostSize();
		const width = clamp( geometry.width, MIN_WIDTH, hostWidth - EDGE_PADDING * 2 );
		const height = clamp( geometry.height, MIN_HEIGHT, hostHeight - EDGE_PADDING * 2 );
		const left = clamp(
			geometry.x * hostWidth,
			EDGE_PADDING,
			Math.max( EDGE_PADDING, hostWidth - width - EDGE_PADDING ),
		);
		const top = clamp(
			geometry.y * hostHeight,
			EDGE_PADDING,
			Math.max( EDGE_PADDING, hostHeight - height - EDGE_PADDING ),
		);
		this.element.style.left = `${ left }px`;
		this.element.style.top = `${ top }px`;
		this.element.style.width = `${ width }px`;
		this.element.style.height = `${ height }px`;
	}

	private watchResize(): void {
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		this.resizeObserver = new ResizeObserver( () => {
			if ( this.geometryTimer !== null ) {
				window.clearTimeout( this.geometryTimer );
			}
			this.geometryTimer = window.setTimeout( () => {
				this.geometryTimer = null;
				this.persistGeometry();
			}, 150 );
		} );
		this.resizeObserver.observe( this.element );
	}

	private persistGeometry(): void {
		const { width: hostWidth, height: hostHeight } = this.layer.hostSize();
		const left = parseFloat( this.element.style.left ) || 0;
		const top = parseFloat( this.element.style.top ) || 0;
		const existing = loadGeometry( noteKey( this.note ) );
		saveGeometry( noteKey( this.note ), {
			...( existing ?? {} ),
			x: clamp( left / hostWidth, 0, 1 ),
			y: clamp( top / hostHeight, 0, 1 ),
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
		} );
	}

	private layerHostRect(): DOMRect {
		const parent = this.element.parentElement?.parentElement;
		return ( parent ?? document.body ).getBoundingClientRect();
	}
}

export function bootStickyNotes( options: StickyNotesLayerOptions ): StickyNotesLayer {
	const layer = new StickyNotesLayer( options );
	void layer.boot();
	return layer;
}

function noteKey( note: StickyNote ): string {
	return note.guidelineId === null
		? note.localId
		: `guideline:${ note.guidelineId }`;
}

function noteModifiedMs( note: StickyNote ): number {
	if ( typeof note.modifiedMs === 'number' && Number.isFinite( note.modifiedMs ) ) {
		return note.modifiedMs;
	}
	if ( ! note.modified ) {
		return 0;
	}
	const parsed = Date.parse( note.modified );
	return Number.isFinite( parsed ) ? parsed : 0;
}

function sortNotesByModified( notes: StickyNote[] ): StickyNote[] {
	return [ ...notes ].sort( ( a, b ) => noteModifiedMs( a ) - noteModifiedMs( b ) );
}

function loadGeometry( key: string ): StickyGeometry | null {
	const map = readGeometryMap();
	const value = map[ key ];
	if (
		! value ||
		! Number.isFinite( value.x ) ||
		! Number.isFinite( value.y ) ||
		! Number.isFinite( value.width ) ||
		! Number.isFinite( value.height )
	) {
		return null;
	}
	return value;
}

function saveGeometry( key: string, geometry: StickyGeometry ): void {
	const map = readGeometryMap();
	map[ key ] = geometry;
	writeGeometryMap( map );
}

function moveStoredGeometry( oldKey: string, newKey: string ): void {
	if ( oldKey === newKey ) {
		return;
	}
	const map = readGeometryMap();
	if ( map[ oldKey ] ) {
		map[ newKey ] = map[ oldKey ];
		delete map[ oldKey ];
		writeGeometryMap( map );
	}
}

function readGeometryMap(): Record< string, StickyGeometry > {
	try {
		const raw = window.localStorage.getItem( GEOMETRY_KEY );
		return raw ? JSON.parse( raw ) as Record< string, StickyGeometry > : {};
	} catch {
		return {};
	}
}

function writeGeometryMap( map: Record< string, StickyGeometry > ): void {
	try {
		window.localStorage.setItem( GEOMETRY_KEY, JSON.stringify( map ) );
	} catch {
		// Geometry is a convenience; storage may be unavailable.
	}
}

function clamp( value: number, min: number, max: number ): number {
	if ( max < min ) {
		return min;
	}
	return Math.min( max, Math.max( min, value ) );
}
