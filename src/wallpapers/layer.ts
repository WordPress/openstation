import { doAction, HOOKS } from '../hooks';
import { loadModules } from '../modules/registry';
import { getWallpaperSettings } from './settings-store';
import { applyWallpaperTone, resolveWallpaperTone } from './tone';
import type {
	CanvasWallpaperDef,
	CssWallpaperDef,
	WallpaperContext,
	WallpaperDef,
	WallpaperTeardown,
} from './types';

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

export interface WallpaperSuspendApi {
	suspend: ( reason: string ) => void;
	resume: ( reason: string ) => void;
	isSuspended: () => boolean;
}

export class WallpaperLayer {
	private element: HTMLElement;
	private pluginUrl: string;

	private generation = 0;

	private active: { id: string; teardown: WallpaperTeardown } | null = null;

	private suspendReasons = new Map< string, number >();

	private freezeOverlay: HTMLCanvasElement | null = null;

	private frozenCanvas: HTMLElement | null = null;

	private boundVisibilityChange = (): void => {
		this.emitEffectiveVisibility();
	};

	constructor( element: HTMLElement, pluginUrl: string ) {
		this.element = element;
		this.pluginUrl = pluginUrl;
		document.addEventListener( 'visibilitychange', this.boundVisibilityChange );
	}

	public apply( def: WallpaperDef ): void {
		const gen = ++this.generation;

		this.teardownActive();

		if ( def.type === 'css' ) {
			this.applyCss( def );
			this.applyTone( def, gen );
			return;
		}

		this.applyCanvas( def, gen );
		this.applyTone( def, gen );
	}

	private applyTone( def: WallpaperDef, gen: number ): void {
		void resolveWallpaperTone( def ).then( ( tone ) => {
			if ( gen === this.generation ) {
				applyWallpaperTone( tone );
			}
		} );
	}

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

	public isSuspended(): boolean {
		return this.suspendReasons.size > 0;
	}

	public teardownActive(): void {
		this.removeFreezeOverlay();
		if ( ! this.active ) {
			return;
		}
		const { id, teardown } = this.active;
		this.active = null;
		doAction( HOOKS.WALLPAPER_UNMOUNTING, { id } );
		try {
			teardown();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'wallpaper-teardown', id, error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Wallpaper "${ id }" teardown threw:`,
					err,
				);
			}
		}

		this.element.innerHTML = '';
	}

	public dispose(): void {
		this.teardownActive();
		document.removeEventListener( 'visibilitychange', this.boundVisibilityChange );
	}

	private applyCss( def: CssWallpaperDef ): void {
		const value = def.resolveValue
			? def.resolveValue( createContext( def.id, this.pluginUrl ) )
			: def.value;
		if ( typeof value === 'string' ) {
			this.element.style.setProperty( '--os-bg', value );

			const shell = document.getElementById( 'os-shell' );
			shell?.style.setProperty( '--os-bg', value );
		}
	}

	private applyCanvas( def: CanvasWallpaperDef, gen: number ): void {
		const ctx = createContext( def.id, this.pluginUrl );
		doAction( HOOKS.WALLPAPER_MOUNTING, { id: def.id, container: this.element, ctx } );

		const depsReady =
			def.needs && def.needs.length > 0
				? loadModules( def.needs )
				: Promise.resolve();

		const onResolve = ( teardown: WallpaperTeardown ): void => {
			if ( gen !== this.generation ) {
				try {
					teardown();
				} catch {

				}
				return;
			}
			this.active = { id: def.id, teardown };
			doAction( HOOKS.WALLPAPER_MOUNTED, { id: def.id, container: this.element, ctx } );

			if ( this.isEffectivelyHidden() ) {
				this.emitEffectiveVisibility();
			}
		};

		depsReady.then(
			() => {
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

	private isEffectivelyHidden(): boolean {
		return document.hidden || this.isSuspended();
	}

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
