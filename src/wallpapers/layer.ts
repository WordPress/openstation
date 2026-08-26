/**
 * OpenStation — Wallpaper render layer.
 *
 * Manages the `<div id="os-wallpaper">` element the shell
 * markup reserves inside `#os-shell`. CSS wallpapers set a
 * custom property; canvas wallpapers mount DOM here.
 *
 * The tricky part is the mount/unmount race: a user clicking two
 * swatches in quick succession can queue two async mounts. Without
 * protection, whichever resolves last wins and orphans the other's
 * resources. We guard with a monotonic generation counter — every
 * apply() increments it; a mount that resolves on a stale generation
 * tears itself down instead of inserting into the DOM.
 */

import { doAction, HOOKS } from '../hooks';
import { loadModules } from '../modules/registry';
import { getWallpaperSettings } from './settings-store';
import type {
	CanvasWallpaperDef,
	CssWallpaperDef,
	WallpaperContext,
	WallpaperDef,
	WallpaperTeardown,
} from './types';

/** Public context creator — also used by OS Settings for editor panels. */
export function createContext(
	id: string,
	pluginUrl: string,
): WallpaperContext {
	return {
		id,
		pluginUrl,
		prefersReducedMotion: prefersReducedMotion(),
		visible: ! document.hidden,
		settings: getWallpaperSettings( id ),
	};
}

function prefersReducedMotion(): boolean {
	if ( typeof window.matchMedia !== 'function' ) {
		return false;
	}
	return window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches;
}

/**
 * Suspend/resume surface exposed publicly as `wp.os.wallpaper`.
 *
 * @public
 */
export interface WallpaperSuspendApi {
	suspend: ( reason: string ) => void;
	resume: ( reason: string ) => void;
	isSuspended: () => boolean;
}

/**
 * WallpaperLayer — single instance per shell, created from desktop.ts.
 */
export class WallpaperLayer {
	private element: HTMLElement;
	private pluginUrl: string;

	/** Monotonically increasing — protects against mount/unmount races. */
	private generation = 0;

	/** Currently-active canvas wallpaper state, if any. */
	private active: { id: string; teardown: WallpaperTeardown } | null = null;

	/**
	 * Held suspend reasons, refcounted — two `suspend('game:a')` calls
	 * need two `resume('game:a')` calls. The layer is suspended while
	 * any reason is held.
	 */
	private suspendReasons = new Map< string, number >();

	/** Frozen-frame overlay shown while suspended (best-effort). */
	private freezeOverlay: HTMLCanvasElement | null = null;

	/** The live canvas hidden behind the freeze overlay. */
	private frozenCanvas: HTMLElement | null = null;

	/** Bound listener so we can remove it in dispose(). */
	private boundVisibilityChange = (): void => {
		this.emitEffectiveVisibility();
	};

	constructor( element: HTMLElement, pluginUrl: string ) {
		this.element = element;
		this.pluginUrl = pluginUrl;
		document.addEventListener( 'visibilitychange', this.boundVisibilityChange );
	}

	/**
	 * Apply a wallpaper definition. Safe to call from any event
	 * handler — handles type dispatch, teardown of the prior active
	 * canvas, and race-safe async mounts.
	 */
	public apply( def: WallpaperDef ): void {
		// Increment the generation before any async work. Stale mounts
		// (resolved after another apply() came through) compare
		// against this value and tear themselves down.
		const gen = ++this.generation;

		// Tear down the previous canvas, if any. Synchronous portion
		// runs inline; we don't await in case the teardown is slow —
		// starting the new mount immediately is the UX we want.
		this.teardownActive();

		if ( def.type === 'css' ) {
			this.applyCss( def );
			return;
		}

		this.applyCanvas( def, gen );
	}

	/**
	 * Suspend wallpaper animation — e.g. while a game renders its own
	 * canvas. Refcounted per reason; the wallpaper stays suspended
	 * until every held reason is resumed. On the first held reason the
	 * layer freezes the current frame into a bitmap overlay
	 * (best-effort) and re-emits the effective visibility so mounted
	 * scenes stop their tickers. The scene is never destroyed.
	 */
	public suspend( reason: string ): void {
		const wasSuspended = this.isSuspended();
		this.suspendReasons.set(
			reason,
			( this.suspendReasons.get( reason ) ?? 0 ) + 1,
		);
		if ( wasSuspended ) {
			return;
		}
		this.installFreezeOverlay();
		this.emitSuspendAction();
		this.emitEffectiveVisibility();
	}

	/**
	 * Release one hold on a suspend reason. Animation resumes once no
	 * reason remains held. Unknown reasons are ignored.
	 */
	public resume( reason: string ): void {
		const count = this.suspendReasons.get( reason );
		if ( count === undefined ) {
			return;
		}
		if ( count > 1 ) {
			this.suspendReasons.set( reason, count - 1 );
			return;
		}
		this.suspendReasons.delete( reason );
		if ( this.isSuspended() ) {
			return;
		}
		this.removeFreezeOverlay();
		this.emitSuspendAction();
		this.emitEffectiveVisibility();
	}

	/** Whether any suspend reason is currently held. */
	public isSuspended(): boolean {
		return this.suspendReasons.size > 0;
	}

	/**
	 * Imperative teardown entry point — called from desktop.ts on
	 * `pagehide` so a canvas wallpaper's ticker doesn't compete with
	 * the session-beacon flush at unload.
	 */
	public teardownActive(): void {
		// Drop the freeze overlay before (or without) a canvas teardown:
		// a wallpaper switch while suspended must not leave a stale
		// bitmap of the old wallpaper behind.
		this.removeFreezeOverlay();
		if ( ! this.active ) {
			// CSS-only wallpapers still leave their custom property on
			// the shell; nothing to remove.
			return;
		}
		const { id, teardown } = this.active;
		this.active = null;
		doAction( HOOKS.WALLPAPER_UNMOUNTING, { id } );
		try {
			teardown();
		} catch ( err ) {
			// A throwing teardown shouldn't prevent subsequent mounts
			// from succeeding. Log but keep going.
			doAction( HOOKS.SHELL_ERROR, { scope: 'wallpaper-teardown', id, error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Wallpaper "${ id }" teardown threw:`,
					err,
				);
			}
		}
		// Fully clear the layer — a misbehaving mount may have left
		// nodes behind despite the teardown contract.
		this.element.innerHTML = '';
	}

	/** Remove listeners. Not called in normal flow — reserved for tests. */
	public dispose(): void {
		this.teardownActive();
		document.removeEventListener( 'visibilitychange', this.boundVisibilityChange );
	}

	private applyCss( def: CssWallpaperDef ): void {
		// Canvas wallpapers clear innerHTML on teardown; CSS wallpapers
		// never write to it. Nothing to do here for the DOM side.
		const value = def.resolveValue
			? def.resolveValue( createContext( def.id, this.pluginUrl ) )
			: def.value;
		if ( typeof value === 'string' ) {
			this.element.style.setProperty( '--os-bg', value );
			// Also mirror onto the shell so theming rules that read
			// the variable from the shell (per-scheme overrides,
			// dock-pill backgrounds) see the active
			// value. This matches the pre-registry behavior.
			const shell = document.getElementById( 'os-shell' );
			shell?.style.setProperty( '--os-bg', value );
		}
	}

	private applyCanvas( def: CanvasWallpaperDef, gen: number ): void {
		const ctx = createContext( def.id, this.pluginUrl );
		doAction( HOOKS.WALLPAPER_MOUNTING, { id: def.id, container: this.element, ctx } );

		// Declared module dependencies (e.g. `needs: ['pixijs']`) are
		// resolved BEFORE mount fires. Unknown module ids reject with
		// a readable error that bubbles through `mount-failed`.
		const depsReady =
			def.needs && def.needs.length > 0
				? loadModules( def.needs )
				: Promise.resolve();

		const onResolve = ( teardown: WallpaperTeardown ): void => {
			// Race check: a later apply() already bumped the
			// generation. Tear down immediately; don't insert or track.
			if ( gen !== this.generation ) {
				try {
					teardown();
				} catch {
					/* already racing; best-effort */
				}
				return;
			}
			this.active = { id: def.id, teardown };
			doAction( HOOKS.WALLPAPER_MOUNTED, { id: def.id, container: this.element, ctx } );
			// A wallpaper applied while the layer is suspended (or the
			// tab hidden) must not start animating: tell it about the
			// effective state right away. Freshly-mounted scenes show
			// their first frame, so no bitmap overlay is needed here.
			if ( this.isEffectivelyHidden() ) {
				this.emitEffectiveVisibility();
			}
		};

		depsReady.then(
			() => {
				// Race check — the user may have switched wallpapers
				// during the module load.
				if ( gen !== this.generation ) {
					return;
				}

				let result;
				try {
					result = def.mount( this.element, ctx );
				} catch ( err ) {
					this.handleMountFailure( def.id, err );
					return;
				}

				if ( isThenable( result ) ) {
					result.then( onResolve, ( err ) => {
						if ( gen !== this.generation ) {
							return;
						}
						this.handleMountFailure( def.id, err );
					} );
					return;
				}

				onResolve( result );
			},
			( err ) => {
				if ( gen !== this.generation ) {
					return;
				}
				this.handleMountFailure( def.id, err );
			},
		);
	}

	/** Hidden tab OR held suspend reason — what mounted scenes act on. */
	private isEffectivelyHidden(): boolean {
		return document.hidden || this.isSuspended();
	}

	/**
	 * Re-emit `WALLPAPER_VISIBILITY` with the effective state. Both the
	 * `visibilitychange` listener and suspend/resume route through this,
	 * so a tab re-focus during suspension cannot restart animation.
	 */
	private emitEffectiveVisibility(): void {
		if ( ! this.active ) {
			return;
		}
		doAction( HOOKS.WALLPAPER_VISIBILITY, {
			id: this.active.id,
			state: this.isEffectivelyHidden() ? 'hidden' : 'visible',
		} );
	}

	private emitSuspendAction(): void {
		doAction( HOOKS.WALLPAPER_SUSPEND, {
			id: this.active?.id ?? null,
			suspended: this.isSuspended(),
			reasons: Array.from( this.suspendReasons.keys() ),
		} );
	}

	/**
	 * Freeze the current frame: copy the live wallpaper canvas onto a
	 * 2D overlay canvas layered above it, then hide the live canvas.
	 * Best-effort — Pixi's WebGL canvas has no `preserveDrawingBuffer`,
	 * so the draw can produce a blank on some drivers; on any failure
	 * we skip the overlay entirely (a canvas whose ticker stops keeps
	 * presenting its last frame anyway).
	 */
	private installFreezeOverlay(): void {
		if ( this.freezeOverlay || ! this.active ) {
			return;
		}
		const source = this.element.querySelector( 'canvas' );
		if ( ! source || source.width === 0 || source.height === 0 ) {
			return;
		}
		try {
			const overlay = document.createElement( 'canvas' );
			overlay.width = source.width;
			overlay.height = source.height;
			const ctx2d = overlay.getContext( '2d' );
			if ( ! ctx2d ) {
				return;
			}
			ctx2d.drawImage( source, 0, 0 );
			overlay.className = 'os-wallpaper-freeze';
			overlay.style.position = 'absolute';
			overlay.style.inset = '0';
			overlay.style.width = '100%';
			overlay.style.height = '100%';
			overlay.style.pointerEvents = 'none';
			overlay.setAttribute( 'aria-hidden', 'true' );
			this.element.appendChild( overlay );
			source.style.visibility = 'hidden';
			this.freezeOverlay = overlay;
			this.frozenCanvas = source;
		} catch {
			// Tainted canvas / driver quirk — skip the overlay.
		}
	}

	private removeFreezeOverlay(): void {
		this.freezeOverlay?.remove();
		this.freezeOverlay = null;
		if ( this.frozenCanvas ) {
			this.frozenCanvas.style.visibility = '';
			this.frozenCanvas = null;
		}
	}

	private handleMountFailure( id: string, err: unknown ): void {
		this.element.innerHTML = '';
		doAction( HOOKS.WALLPAPER_MOUNT_FAILED, { id, error: err } );
		doAction( HOOKS.SHELL_ERROR, { scope: 'wallpaper-mount', id, error: err } );
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[openstation] Wallpaper "${ id }" failed to mount:`,
				err,
			);
		}
	}
}

function isThenable( value: unknown ): value is Promise<WallpaperTeardown> {
	return (
		!! value &&
		typeof value === 'object' &&
		typeof ( value as { then?: unknown } ).then === 'function'
	);
}
