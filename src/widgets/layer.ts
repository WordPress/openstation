/**
 * Desktop Mode — Widget layer.
 *
 * Owns the right-side `#desktop-mode-widgets` column + the floating
 * overlay for widgets the user has liberated via drag. Responsibilities:
 *
 *   - Load the enabled-id list + floating-widget geometry from
 *     localStorage on boot
 *   - Mount each enabled widget, choosing column-docked vs floating
 *     based on the widget def (`movable`) + persisted state
 *   - Render the trailing `+` tile that opens the picker
 *   - Handle card remove + liberate-on-drag transitions
 *   - Persist changes back to localStorage (+ fire add/remove actions)
 *
 * Drag + resize pointer logic lives in {@link ./frame.ts}; persistence
 * in {@link ./state.ts}. This file is orchestration only so the
 * mental model of each module stays narrow.
 *
 * Widgets paint above the wallpaper (z-index: 1) but under windows
 * (which start at z-index 100). The column never intercepts window
 * drag / resize — only its own cards + `+` button are interactive,
 * everything else passes through.
 *
 * @since 0.7.0
 */

import { doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import * as registry from './registry';
import { openWidgetPicker, refreshWidgetPicker } from './picker';
import { applyGeometry, buildFrame, type Frame } from './frame';
import {
	loadEnabledIds,
	loadGeometry,
	readRawEnabled,
	saveEnabledIds,
	saveGeometry,
} from './state';
import { createWidgetStorage } from './storage';
import type { WidgetGeometry, WidgetTeardown } from './types';

/** First-run default — the clock. Removable like any other. */
const DEFAULT_ENABLED_IDS = [ 'clock' ];

/** Internal record of a mounted widget. */
interface MountedWidget {
	id: string;
	frame: Frame;
	/** Generation at mount time — races compare against this. */
	generation: number;
	/** Teardown fn the def returned. `null` until mount resolves. */
	teardown: WidgetTeardown | null;
	/** True when the widget is absolutely positioned (not in the column). */
	floating: boolean;
}

export class WidgetLayer {
	private root: HTMLElement;
	private listEl: HTMLElement;
	private floatingHost: HTMLElement;
	private addTile: HTMLButtonElement;

	private pluginUrl: string;
	private enabledIds: string[];
	private geometry: Record< string, WidgetGeometry >;
	private mounted: Map< string, MountedWidget > = new Map();

	/**
	 * Monotonic counter incremented on every mount / unmount so async
	 * mounts that resolve after the user flipped the widget off can
	 * detect they're stale and tear themselves down silently.
	 */
	private generation = 0;

	/**
	 * @param root         The column element (`#desktop-mode-widgets`).
	 * @param pluginUrl    Absolute plugin URL — passed to widget ctx.
	 * @param floatingHost Parent for liberated (floating) widgets.
	 *                     Defaults to the column's parent (the desktop
	 *                     area) so floats are bounded by the visible
	 *                     desktop, not the 320 px-wide column.
	 */
	constructor(
		root: HTMLElement,
		pluginUrl: string,
		floatingHost?: HTMLElement,
	) {
		this.root = root;
		this.pluginUrl = pluginUrl;
		this.enabledIds = loadEnabledIds();
		this.geometry = loadGeometry();
		this.floatingHost = floatingHost ?? root.parentElement ?? root;

		this.listEl = document.createElement( 'div' );
		this.listEl.className = 'desktop-mode-widgets__list';
		this.root.appendChild( this.listEl );

		this.addTile = this.buildAddTile();
		this.root.appendChild( this.addTile );

		this.paintEmptyState();
	}

	/**
	 * Mount every widget the user has enabled (per localStorage).
	 * Called once during shell boot, AFTER the registry seed has run
	 * so built-ins are available. Safe to call multiple times — the
	 * `mounted` map dedupes.
	 */
	public hydrate(): void {
		// First-run: no saved list at all → seed with the default
		// (currently just 'clock'). This writes through so the next
		// boot sees an explicit empty [] if the user removed it,
		// distinct from first-run.
		if ( readRawEnabled() === null ) {
			this.enabledIds = DEFAULT_ENABLED_IDS.filter(
				( id ) => !! registry.get( id ),
			);
			saveEnabledIds( this.enabledIds );
		}

		for ( const id of this.enabledIds ) {
			if ( this.mounted.has( id ) ) {
				continue;
			}
			this.mountById( id );
		}
		this.paintEmptyState();
	}

	/**
	 * Add a widget by id — called by the picker after the user
	 * selects an available entry. Idempotent.
	 */
	public add( id: string ): void {
		if ( this.enabledIds.includes( id ) ) {
			return;
		}
		if ( ! registry.get( id ) ) {
			// Unknown id — don't persist a broken entry. Most likely a
			// plugin was deactivated between picker-open and click.
			return;
		}
		this.enabledIds.push( id );
		saveEnabledIds( this.enabledIds );
		this.mountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_ADDED, { id } );
		refreshWidgetPicker();
	}

	/**
	 * Remove a widget by id — called from the card's × button and
	 * from the picker. Idempotent.
	 */
	public remove( id: string ): void {
		const before = this.enabledIds.length;
		this.enabledIds = this.enabledIds.filter( ( e ) => e !== id );
		if ( this.enabledIds.length === before ) {
			return;
		}
		saveEnabledIds( this.enabledIds );
		// Drop any persisted geometry so a re-add starts docked.
		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}
		this.unmountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_REMOVED, { id } );
		refreshWidgetPicker();
	}

	/** Public read for the picker / external callers. */
	public getEnabledIds(): string[] {
		return [ ...this.enabledIds ];
	}

	/**
	 * Mount a widget ONLY if it's already in the user's enabled
	 * list AND not currently mounted. No-op when the widget isn't
	 * enabled (user never opted in) and no-op when it's already on
	 * screen. Used by the server-driven sync: when a plugin
	 * activates mid-session, its widget def registers via the
	 * sync's path; if the user had previously enabled that widget
	 * (in a prior session or before the plugin was deactivated),
	 * we want to bring it back on screen without toggling the
	 * "enabled" state or firing a `WIDGET_ADDED` action.
	 *
	 * The net behaviour is "rehydrate this one widget now that
	 * its def is finally registered," which is subtly different
	 * from `ensureMounted` (which OPT-INs the user into enabling
	 * the widget for the first time).
	 */
	public mountIfEnabled( id: string ): void {
		if ( ! registry.get( id ) ) {
			return;
		}
		if ( ! this.enabledIds.includes( id ) ) {
			return;
		}
		if ( this.mounted.has( id ) ) {
			return;
		}
		this.mountById( id );
		this.paintEmptyState();
	}

	/**
	 * Unmount a widget without touching the persisted enablement.
	 * Used by the server-driven widget-registry sync: when a plugin
	 * deactivates mid-session, its widget defs disappear from the
	 * registry and we need to pull any mounted instance off the
	 * screen — but we deliberately KEEP the id in the user's
	 * enabled list so re-activating the plugin re-mounts it
	 * automatically through `hydrate()`.
	 *
	 * Idempotent; a no-op when the widget isn't currently mounted.
	 */
	public unmount( id: string ): void {
		if ( ! this.mounted.has( id ) ) {
			return;
		}
		this.unmountById( id );
		this.paintEmptyState();
	}

	/**
	 * Guarantee the widget identified by `id` is currently mounted,
	 * adding it to the enabled list if it isn't. No-op when the
	 * widget is already on screen. Intended for companion plugins
	 * that want to pin their widget programmatically — a monitor
	 * plugin that auto-pins itself on the first error burst, a
	 * first-run onboarding flow that ensures the quick-start widget
	 * is present, etc.
	 *
	 * Returns `true` when the widget is mounted (either newly added
	 * or already present), `false` when the id isn't registered —
	 * callers can branch on the failure without having to maintain
	 * their own registry snapshot.
	 */
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

	/**
	 * Tear down every widget. Called on shell unload via `pagehide`
	 * so intervals / RAF loops stop before the beacon flush.
	 */
	public disposeAll(): void {
		for ( const id of Array.from( this.mounted.keys() ) ) {
			this.unmountById( id );
		}
	}

	// --- Internal ---------------------------------------------------

	private mountById( id: string ): void {
		const def = registry.get( id );
		if ( ! def ) {
			return;
		}
		const gen = ++this.generation;
		const initialGeometry = def.movable === true ? this.geometry[ id ] : undefined;
		const frame = buildFrame(
			def,
			{ floatingParent: this.floatingHost, geometry: initialGeometry },
			{
				onRemove: () => this.remove( id ),
				onGeometryChanged: ( geom ) => this.persistGeometry( id, geom ),
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

		const ctx = {
			id,
			pluginUrl: this.pluginUrl,
			storage: createWidgetStorage( id ),
		};
		doAction( HOOKS.WIDGET_MOUNTING, { id, container: frame.body, ctx } );

		const onResolve = ( teardown: WidgetTeardown ): void => {
			// Race check: user flipped this widget off (or the whole
			// layer was disposed) before mount resolved.
			const current = this.mounted.get( id );
			if ( ! current || current.generation !== gen ) {
				try {
					teardown();
				} catch {
					/* best-effort */
				}
				return;
			}
			current.teardown = teardown;
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
			result.then( onResolve, ( err ) => {
				if ( this.mounted.get( id )?.generation === gen ) {
					this.handleMountFailure( id, err );
				}
			} );
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
					`[desktop-mode] Widget "${ id }" teardown threw:`,
					err,
				);
			}
		}
		// Bumping the generation here ensures any in-flight async
		// mount that resolves AFTER this point also tears itself down.
		this.generation++;
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
				`[desktop-mode] Widget "${ id }" failed to mount:`,
				err,
			);
		}
	}

	private buildAddTile(): HTMLButtonElement {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'desktop-mode-widgets__add';
		tile.setAttribute( 'aria-label', __( 'Add widget' ) );
		const plus = document.createElement( 'span' );
		plus.className = 'desktop-mode-widgets__add-plus';
		plus.setAttribute( 'aria-hidden', 'true' );
		plus.textContent = '+';
		const label = document.createElement( 'span' );
		label.className = 'desktop-mode-widgets__add-label';
		label.textContent = __( 'Add widget' );
		tile.appendChild( plus );
		tile.appendChild( label );
		tile.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			openWidgetPicker( {
				anchor: tile,
				registry: () => registry.all(),
				enabledIds: () => [ ...this.enabledIds ],
				onAdd: ( id ) => this.add( id ),
			} );
		} );
		return tile;
	}

	/**
	 * Drop a card into the right parent based on its floating state.
	 * Docked cards append to the column list above the `+` tile;
	 * floating cards append to the desktop-area-level host so they
	 * sit above the wallpaper and can range across the viewport.
	 */
	private placeCard( card: HTMLElement, floating: boolean ): void {
		if ( floating ) {
			this.floatingHost.appendChild( card );
		} else {
			this.listEl.appendChild( card );
		}
	}

	/**
	 * Move a widget from the column into the floating host. Called by
	 * the frame on the user's first drag of a movable widget.
	 */
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

	/**
	 * Inverse of {@link liberate}: move a floating card back into
	 * the column and drop its persisted geometry so a subsequent
	 * shell boot brings it up docked. Called when the user clicks
	 * the re-dock button in the card's chrome header, or
	 * programmatically by companion plugins via
	 * `wp.desktop.widgets.redock( id )` /
	 * `wp.desktop.widgetLayer.redock( id )`.
	 *
	 * Idempotent — a docked widget silently no-ops, an unknown id
	 * silently no-ops. The `--floating` class on the card is
	 * removed as part of the same write so CSS rules that depend
	 * on it (re-dock button visibility, absolute positioning) flip
	 * back in one paint.
	 *
	 * @since 0.7.0 (private)
	 * @since 0.8.6 (public)
	 */
	public redock( id: string ): void {
		const record = this.mounted.get( id );
		if ( ! record || ! record.floating ) {
			return;
		}
		record.floating = false;
		// Clear the persisted geometry BEFORE re-parenting so a
		// concurrent boot doesn't pick up stale floating coords.
		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}
		// Strip the inline geometry so the card renders back at its
		// flex-column natural size — no phantom left/top offsets
		// bleed into column layout.
		const card = record.frame.card;
		card.classList.remove( 'desktop-mode-widgets__card--floating' );
		card.style.left = '';
		card.style.top = '';
		card.style.width = '';
		card.style.height = '';
		// Re-append before the add-tile so the card lands at the
		// bottom of the existing stack (matches the new-widget
		// insertion order — "most recently added / redocked is last").
		this.listEl.appendChild( card );
		this.paintEmptyState();
	}

	private persistGeometry( id: string, geometry: WidgetGeometry ): void {
		this.geometry[ id ] = geometry;
		saveGeometry( this.geometry );
	}

	/**
	 * Toggle a `--has-widgets` modifier so CSS can hide the column's
	 * decorative backdrop when nothing's mounted (keeps the empty
	 * state clean — just the `+` tile floating in the corner).
	 *
	 * Floating widgets don't count toward "has widgets" in the column
	 * sense — if every enabled widget is floating, the column itself
	 * shows only the empty state + add tile.
	 */
	private paintEmptyState(): void {
		let docked = 0;
		for ( const record of this.mounted.values() ) {
			if ( ! record.floating ) {
				docked++;
			}
		}
		this.root.classList.toggle(
			'desktop-mode-widgets--has-widgets',
			docked > 0,
		);
	}
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isThenable( x: unknown ): x is PromiseLike< WidgetTeardown > {
	return (
		!! x &&
		( typeof x === 'object' || typeof x === 'function' ) &&
		typeof ( x as { then?: unknown } ).then === 'function'
	);
}
