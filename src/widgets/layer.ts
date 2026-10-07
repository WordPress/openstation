import { doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import * as registry from './registry';
import {
	closeWidgetPicker,
	openWidgetPicker,
	refreshWidgetPicker,
} from './picker';
import {
	applyGeometry,
	buildFrame,
	clampGeometryToParent,
	type Frame,
} from './frame';
import { subscribeWorkArea } from '../work-area';
import {
	loadDockedHeights,
	loadEnabledIds,
	loadGeometry,
	readRawEnabled,
	saveDockedHeights,
	saveEnabledIds,
	saveGeometry,
} from './state';
import { showInlineLoader } from '../ui/inline-loader';
import { createWidgetStorage } from './storage';
import type { WidgetGeometry, WidgetTeardown } from './types';

const DEFAULT_ENABLED_IDS = [ 'clock' ];

const HOVER_PADDING = 40;

const ADD_TILE_GAP = 12;

interface MountedWidget {
	id: string;
	frame: Frame;

	generation: number;

	teardown: WidgetTeardown | null;

	floating: boolean;
}

export class WidgetLayer {
	private root: HTMLElement;
	private listEl: HTMLElement;
	private floatingHost: HTMLElement;
	private addTile: HTMLButtonElement;

	private pluginUrl: string;
	private enabledIds: string[];

	private override: string[] | null = null;
	private geometry: Record< string, WidgetGeometry >;
	private dockedHeights: Record< string, number >;
	private mounted: Map< string, MountedWidget > = new Map();

	private generation = 0;

	private unwatchPointer: ( () => void ) | null = null;

	private stackObserver: ResizeObserver | null = null;

	constructor(
		root: HTMLElement,
		pluginUrl: string,
		floatingHost?: HTMLElement,
	) {
		this.root = root;
		this.pluginUrl = pluginUrl;
		this.enabledIds = loadEnabledIds();
		this.geometry = loadGeometry();
		this.dockedHeights = loadDockedHeights();
		this.floatingHost = floatingHost ?? root.parentElement ?? root;

		this.listEl = document.createElement( 'div' );
		this.listEl.className = 'os-widgets__list';
		this.root.appendChild( this.listEl );

		this.addTile = this.buildAddTile();
		this.root.appendChild( this.addTile );

		if ( typeof ResizeObserver === 'function' ) {
			this.stackObserver = new ResizeObserver( () =>
				this.positionAddTile(),
			);
		}

		this.paintEmptyState();
		this.watchPointerProximity();
	}

	private visibleIds(): readonly string[] {
		return this.override ?? this.enabledIds;
	}

	public hydrate(): void {
		if ( readRawEnabled() === null ) {
			this.enabledIds = DEFAULT_ENABLED_IDS.filter(
				( id ) => !! registry.get( id ),
			);
			saveEnabledIds( this.enabledIds );
		}

		for ( const id of this.visibleIds() ) {
			if ( this.mounted.has( id ) ) {
				continue;
			}
			this.mountById( id );
		}
		this.paintEmptyState();
	}

	public add( id: string ): void {
		if ( ! registry.get( id ) ) {
			return;
		}
		if ( this.override ) {
			if ( this.override.includes( id ) ) {
				return;
			}
			this.override = [ ...this.override, id ];
			this.mountById( id );
			this.paintEmptyState();
			doAction( HOOKS.WIDGET_ADDED, { id } );
			return;
		}
		if ( this.enabledIds.includes( id ) ) {
			return;
		}
		this.enabledIds.push( id );
		saveEnabledIds( this.enabledIds );
		this.mountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_ADDED, { id } );
	}

	public remove( id: string ): void {
		if ( this.override ) {
			if ( ! this.override.includes( id ) ) {
				return;
			}
			this.override = this.override.filter( ( e ) => e !== id );
			this.unmountById( id );
			this.paintEmptyState();
			doAction( HOOKS.WIDGET_REMOVED, { id } );
			refreshWidgetPicker();
			return;
		}
		const before = this.enabledIds.length;
		this.enabledIds = this.enabledIds.filter( ( e ) => e !== id );
		if ( this.enabledIds.length === before ) {
			return;
		}
		saveEnabledIds( this.enabledIds );

		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}

		if ( this.dockedHeights[ id ] !== undefined ) {
			delete this.dockedHeights[ id ];
			saveDockedHeights( this.dockedHeights );
		}
		this.unmountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_REMOVED, { id } );
		refreshWidgetPicker();
	}

	public getEnabledIds(): string[] {
		return [ ...this.enabledIds ];
	}

	public getMountedIds(): string[] {
		return Array.from( this.mounted.keys() );
	}

	public openPicker(): void {
		this.positionAddTile();
		this.root.classList.add( 'os-widgets--picking' );
		openWidgetPicker( {
			anchor: this.addTile,
			registry: () => registry.all(),

			enabledIds: () => [ ...this.visibleIds() ],
			onAdd: ( id ) => {
				this.add( id );

				closeWidgetPicker();

				this.addTile.focus();
			},
			onClose: () =>
				this.root.classList.remove( 'os-widgets--picking' ),
		} );
	}

	public mountIfEnabled( id: string ): void {
		if ( ! registry.get( id ) ) {
			return;
		}

		if ( ! this.visibleIds().includes( id ) ) {
			return;
		}
		if ( this.mounted.has( id ) ) {
			return;
		}
		this.mountById( id );
		this.paintEmptyState();
	}

	public unmount( id: string ): void {
		if ( ! this.mounted.has( id ) ) {
			return;
		}
		this.unmountById( id );
		this.paintEmptyState();
	}

	public ensureMounted( id: string ): boolean {
		if ( ! registry.get( id ) ) {
			return false;
		}
		if ( this.enabledIds.includes( id ) ) {
			return true;
		}
		this.add( id );
		return true;
	}

	public setVisibleIds( ids: readonly string[] | null ): void {
		this.override = ids ? [ ...ids ] : null;
		const want = new Set( this.visibleIds() );
		for ( const id of Array.from( this.mounted.keys() ) ) {
			if ( ! want.has( id ) ) {
				this.unmountById( id );
			}
		}
		for ( const id of want ) {
			if ( this.mounted.has( id ) || ! registry.get( id ) ) {
				continue;
			}
			this.mountById( id );
		}
		this.paintEmptyState();
	}

	public disposeAll(): void {
		for ( const id of Array.from( this.mounted.keys() ) ) {
			this.unmountById( id );
		}
		this.unwatchPointer?.();
		this.unwatchPointer = null;
		this.stackObserver?.disconnect();
	}

	private mountById( id: string ): void {
		const def = registry.get( id );
		if ( ! def ) {
			return;
		}
		const gen = ++this.generation;
		const initialGeometry = def.movable === true ? this.geometry[ id ] : undefined;
		const frame = buildFrame(
			def,
			{
				floatingParent: this.floatingHost,
				geometry: initialGeometry,
				dockedHeight: this.dockedHeights[ id ],
			},
			{
				onRemove: () => this.remove( id ),
				onGeometryChanged: ( geom ) => this.persistGeometry( id, geom ),
				onDockedHeightChanged: ( height ) =>
					this.persistDockedHeight( id, height ),
				onLiberate: ( geom ) => this.liberate( id, geom ),
				onRedock: () => this.redock( id ),
			},
		);

		const floating = !! initialGeometry;
		const record: MountedWidget = {
			id,
			frame,
			generation: gen,
			teardown: null,
			floating,
		};
		this.mounted.set( id, record );
		this.placeCard( frame.card, floating );

		this.stackObserver?.observe( frame.card );

		const ctx = {
			id,
			pluginUrl: this.pluginUrl,
			storage: createWidgetStorage( id ),
		};
		doAction( HOOKS.WIDGET_MOUNTING, { id, container: frame.body, ctx } );

		const onResolve = ( teardown: WidgetTeardown ): void => {
			const current = this.mounted.get( id );
			if ( ! current || current.generation !== gen ) {
				try {
					teardown();
				} catch {

				}
				return;
			}
			current.teardown = teardown;

			this.positionAddTile();
			doAction( HOOKS.WIDGET_MOUNTED, { id, container: frame.body, ctx } );
		};

		let result;
		try {
			result = def.mount( frame.body, ctx );
		} catch ( err ) {
			this.handleMountFailure( id, err );
			return;
		}
		if ( isThenable( result ) ) {
			const loader = showInlineLoader( frame.body, {
				label: __( 'Loading…' ),
			} );
			result.then(
				( teardown ) => {
					loader.done();
					onResolve( teardown );
				},
				( err ) => {
					loader.done();
					if ( this.mounted.get( id )?.generation === gen ) {
						this.handleMountFailure( id, err );
					}
				},
			);
			return;
		}
		onResolve( result );
	}

	private unmountById( id: string ): void {
		const record = this.mounted.get( id );
		if ( ! record ) {
			return;
		}
		doAction( HOOKS.WIDGET_UNMOUNTING, { id } );
		try {
			record.teardown?.();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'widget-teardown', id, error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Widget "${ id }" teardown threw:`,
					err,
				);
			}
		}

		this.generation++;
		this.stackObserver?.unobserve( record.frame.card );
		record.frame.dispose();
		this.mounted.delete( id );
	}

	private handleMountFailure( id: string, err: unknown ): void {
		const record = this.mounted.get( id );
		if ( record ) {
			record.frame.dispose();
			this.mounted.delete( id );
		}
		doAction( HOOKS.WIDGET_MOUNT_FAILED, { id, error: err } );
		doAction( HOOKS.SHELL_ERROR, { scope: 'widget-mount', id, error: err } );
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[openstation] Widget "${ id }" failed to mount:`,
				err,
			);
		}
	}

	private buildAddTile(): HTMLButtonElement {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'os-widgets__add';
		tile.setAttribute( 'aria-label', __( 'Add widget' ) );
		const plus = document.createElement( 'span' );
		plus.className = 'os-widgets__add-plus';
		plus.setAttribute( 'aria-hidden', 'true' );
		plus.textContent = '+';
		const label = document.createElement( 'span' );
		label.className = 'os-widgets__add-label';
		label.textContent = __( 'Add widget' );
		tile.appendChild( plus );
		tile.appendChild( label );
		tile.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			this.openPicker();
		} );
		return tile;
	}

	private watchPointerProximity(): void {
		let rect: DOMRect | null = null;
		let frame = 0;

		const invalidate = (): void => {
			rect = null;
			this.positionAddTile();
		};

		const remeasure = (): void => {
			if ( frame ) {
				return;
			}
			frame = requestAnimationFrame( () => {
				frame = 0;
				this.positionAddTile();
			} );
		};
		const onMove = ( e: PointerEvent ): void => {
			if ( ! rect ) {
				rect = this.root.getBoundingClientRect();
			}
			const near =
				e.clientX >= rect.left - HOVER_PADDING &&
				e.clientX <= rect.right + HOVER_PADDING &&
				e.clientY >= rect.top - HOVER_PADDING &&
				e.clientY <= rect.bottom + HOVER_PADDING;
			this.root.classList.toggle( 'os-widgets--hovered', near );
			if ( near ) {
				remeasure();
			}
		};
		const onLeave = (): void => {
			this.root.classList.remove( 'os-widgets--hovered' );
		};

		document.addEventListener( 'pointermove', onMove, { passive: true } );
		document.documentElement.addEventListener( 'pointerleave', onLeave );
		window.addEventListener( 'resize', invalidate );

		let observer: ResizeObserver | null = null;
		if ( typeof ResizeObserver === 'function' ) {
			observer = new ResizeObserver( invalidate );
			observer.observe( this.root );
			if ( this.root.parentElement ) {
				observer.observe( this.root.parentElement );
			}
		}

		const offWorkArea = subscribeWorkArea( () => this.reclampFloating() );

		this.unwatchPointer = () => {
			if ( frame ) {
				cancelAnimationFrame( frame );
				frame = 0;
			}
			offWorkArea();
			observer?.disconnect();
			document.removeEventListener( 'pointermove', onMove );
			document.documentElement.removeEventListener(
				'pointerleave',
				onLeave,
			);
			window.removeEventListener( 'resize', invalidate );
		};
	}

	private placeCard( card: HTMLElement, floating: boolean ): void {
		if ( floating ) {
			this.floatingHost.appendChild( card );
		} else {
			this.listEl.appendChild( card );
		}
	}

	private liberate( id: string, geometry: WidgetGeometry ): void {
		const record = this.mounted.get( id );
		if ( ! record || record.floating ) {
			return;
		}
		record.floating = true;
		this.floatingHost.appendChild( record.frame.card );
		applyGeometry( record.frame.card, geometry );
		this.persistGeometry( id, geometry );
		this.paintEmptyState();
	}

	public redock( id: string ): void {
		const record = this.mounted.get( id );
		if ( ! record || ! record.floating ) {
			return;
		}
		record.floating = false;

		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}

		const card = record.frame.card;
		card.classList.remove( 'os-widgets__card--floating' );
		card.style.left = '';
		card.style.top = '';
		card.style.width = '';
		const dockedHeight = this.dockedHeights[ id ];
		card.style.height =
			dockedHeight !== undefined ? `${ dockedHeight }px` : '';

		this.listEl.appendChild( card );
		this.paintEmptyState();
	}

	private reclampFloating(): void {
		for ( const [ id, record ] of this.mounted ) {
			if ( ! record.floating ) {
				continue;
			}
			const current = this.geometry[ id ];
			if ( ! current ) {
				continue;
			}
			const next = clampGeometryToParent( current, this.floatingHost );
			if ( next.x === current.x && next.y === current.y ) {
				continue;
			}
			applyGeometry( record.frame.card, next );
			this.persistGeometry( id, next );
		}
	}

	private persistGeometry( id: string, geometry: WidgetGeometry ): void {
		this.geometry[ id ] = geometry;
		saveGeometry( this.geometry );
		this.positionAddTile();
	}

	private positionAddTile(): void {
		const colRect = this.root.getBoundingClientRect();
		if ( ! colRect.height ) {
			return;
		}
		let bottom = this.listEl.offsetTop + this.listEl.offsetHeight;
		for ( const record of this.mounted.values() ) {
			if ( ! record.floating ) {
				continue;
			}
			const rect = record.frame.card.getBoundingClientRect();
			const overlap =
				Math.min( rect.right, colRect.right ) -
				Math.max( rect.left, colRect.left );
			if ( overlap < colRect.width / 2 ) {
				continue;
			}
			bottom = Math.max(
				bottom,
				rect.bottom - colRect.top + this.root.scrollTop,
			);
		}

		const limit =
			colRect.height + this.root.scrollTop - this.addTile.offsetHeight;
		const top = Math.max( 0, Math.min( bottom + ADD_TILE_GAP, limit ) );
		if ( this.addTile.style.top === `${ top }px` ) {
			return;
		}
		this.addTile.style.top = `${ top }px`;
	}

	private persistDockedHeight( id: string, height: number ): void {
		if ( ! Number.isFinite( height ) || height <= 0 ) {
			return;
		}
		this.dockedHeights[ id ] = height;
		saveDockedHeights( this.dockedHeights );
	}

	private paintEmptyState(): void {
		let docked = 0;
		for ( const record of this.mounted.values() ) {
			if ( ! record.floating ) {
				docked++;
			}
		}
		this.root.classList.toggle(
			'os-widgets--has-widgets',
			docked > 0,
		);
		this.positionAddTile();
	}
}

function isThenable( x: unknown ): x is PromiseLike< WidgetTeardown > {
	return (
		!! x &&
		( typeof x === 'object' || typeof x === 'function' ) &&
		typeof ( x as { then?: unknown } ).then === 'function'
	);
}
