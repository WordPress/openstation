/**
 * Desktop Mode — Wallpaper render layer.
 *
 * Manages the `<div id="desktop-mode-wallpaper">` element the shell
 * markup reserves inside `#desktop-mode-shell`. CSS wallpapers set a
 * custom property; canvas wallpapers mount DOM here.
 *
 * The tricky part is the mount/unmount race: a user clicking two
 * swatches in quick succession can queue two async mounts. Without
 * protection, whichever resolves last wins and orphans the other's
 * resources. We guard with a monotonic generation counter — every
 * apply() increments it; a mount that resolves on a stale generation
 * tears itself down instead of inserting into the DOM.
 *
 * @since 0.6.0
 */

import { doAction, HOOKS } from '../hooks';
import { loadModules } from '../modules/registry';
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
	};
}

function prefersReducedMotion(): boolean {
	if ( typeof window.matchMedia !== 'function' ) {
		return false;
	}
	return window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches;
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

	/** Bound listener so we can remove it in dispose(). */
	private boundVisibilityChange = (): void => {
		if ( ! this.active ) {
			return;
		}
		doAction( HOOKS.WALLPAPER_VISIBILITY, {
			id: this.active.id,
			state: document.hidden ? 'hidden' : 'visible',
		} );
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
	 * Imperative teardown entry point — called from desktop.ts on
	 * `pagehide` so a canvas wallpaper's ticker doesn't compete with
	 * the session-beacon flush at unload.
	 */
	public teardownActive(): void {
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
					`[desktop-mode] Wallpaper "${ id }" teardown threw:`,
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
			this.element.style.setProperty( '--desktop-mode-bg', value );
			// Also mirror onto the shell so theming rules that read
			// the variable from the shell (per-scheme overrides,
			// dock-pill backgrounds) see the active
			// value. This matches the pre-registry behavior.
			const shell = document.getElementById( 'desktop-mode-shell' );
			shell?.style.setProperty( '--desktop-mode-bg', value );
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

	private handleMountFailure( id: string, err: unknown ): void {
		this.element.innerHTML = '';
		doAction( HOOKS.WALLPAPER_MOUNT_FAILED, { id, error: err } );
		doAction( HOOKS.SHELL_ERROR, { scope: 'wallpaper-mount', id, error: err } );
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[desktop-mode] Wallpaper "${ id }" failed to mount:`,
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
