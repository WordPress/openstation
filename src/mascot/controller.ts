/**
 * Desktop Mode — Mascot controller (shell side).
 *
 * The always-on half of the mascot: a few hundred bytes in
 * `desktop[.min].js` that own the layer element, the on/off
 * preference, and the lazy load of the real thing.
 *
 * The simulation, PixiJS, and the renderer live in
 * `assets/js/mascot[.min].js` and are fetched the first time the
 * mascot is switched on. A user who never turns it on never
 * downloads a byte of it.
 *
 * The mascot is a **first-class shell layer**, not a widget: it owns
 * a sibling of the wallpaper inside `#desktop-mode-shell`, paints
 * above every window, and is not bound by the widget column's
 * placement rules. Widgets are cards on a rail; the mascot roams.
 */

import { applyFilters, doAction } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { MASCOT_DEFAULTS, sanitizeMascotConfig } from './config';
import type {
	MascotConfig,
	MascotHandle,
	MascotMountFn,
	PartialMascotConfig,
} from './types';

/** localStorage key for the mascot's resting place. */
const POSITION_KEY = 'desktop-mode-mascot-position';

/** Id of the layer element the controller creates inside the shell. */
export const MASCOT_LAYER_ID = 'desktop-mode-mascot';

export interface MascotControllerOptions {
	/** Shell element the layer is appended to. */
	shell: HTMLElement;
	/** URL of the lazy mascot bundle, from the shell config. */
	bundleUrl: string;
	/** Server-side config (`desktop_mode_mascot_config` filter output). */
	serverConfig?: unknown;
	/** Whether the user's saved preference has the mascot on. */
	enabled: boolean;
	/** Persist the on/off preference. Called on every user toggle. */
	persist: ( enabled: boolean ) => void;
}

/**
 * Public shape exposed as `wp.desktop.mascot`.
 *
 * @public
 */
export interface MascotApi {
	/** Whether the mascot is currently switched on. */
	isEnabled: () => boolean;
	/** Switch the mascot on. Resolves once it is on screen. */
	enable: () => Promise< void >;
	/** Switch the mascot off and release the WebGL context. */
	disable: () => void;
	/** Flip the current state. Resolves once the change is applied. */
	toggle: () => Promise< void >;
	/** Body centre in viewport coordinates, or `null` when off. */
	getPosition: () => { x: number; y: number } | null;
	/** Move the mascot. No-op when off. */
	setPosition: ( x: number, y: number ) => void;
	/** The resolved configuration currently in force. */
	getConfig: () => MascotConfig;
	/**
	 * Merge a partial configuration over the current one and apply it
	 * live. Values are clamped; see `docs/mascot.md`.
	 */
	setConfig: ( partial: PartialMascotConfig ) => void;
}

export class MascotController {
	private options: MascotControllerOptions;
	private layer: HTMLElement | null = null;
	private handle: MascotHandle | null = null;
	private config: MascotConfig;
	private enabled: boolean;
	/**
	 * Bumped on every enable/disable. An in-flight mount compares it
	 * on resolve and self-destructs if the user has since changed
	 * their mind — otherwise a fast on-off-on lands two mascots.
	 */
	private generation = 0;
	private loading: Promise< void > | null = null;

	public constructor( options: MascotControllerOptions ) {
		this.options = options;
		this.enabled = options.enabled;
		this.config = this.resolveConfig();
	}

	/** Mount now if the saved preference says so. */
	public boot(): void {
		if ( this.enabled ) {
			void this.mount();
		}
	}

	public api(): MascotApi {
		return {
			isEnabled: () => this.enabled,
			enable: () => this.setEnabled( true ),
			disable: () => {
				void this.setEnabled( false );
			},
			toggle: () => this.setEnabled( ! this.enabled ),
			getPosition: () => this.handle?.getPosition() ?? null,
			setPosition: ( x: number, y: number ) => this.handle?.setPosition( x, y ),
			getConfig: () => this.config,
			setConfig: ( partial: PartialMascotConfig ) => {
				this.config = sanitizeMascotConfig( partial, this.config );
				this.handle?.applyConfig( this.config );
			},
		};
	}

	/**
	 * Turn the mascot on or off, persisting the preference and firing
	 * the lifecycle action. Re-entrant-safe.
	 */
	public async setEnabled( next: boolean ): Promise< void > {
		if ( next === this.enabled ) {
			return;
		}
		this.enabled = next;
		this.generation++;
		this.options.persist( next );
		doAction( next ? 'desktop-mode.mascot.enabled' : 'desktop-mode.mascot.disabled', {} );
		if ( next ) {
			await this.mount();
		} else {
			this.unmount();
		}
	}

	/**
	 * Merge server config, defaults, and the JS filter into the
	 * configuration the mascot actually runs with.
	 */
	private resolveConfig(): MascotConfig {
		const fromServer = sanitizeMascotConfig(
			this.options.serverConfig,
			MASCOT_DEFAULTS,
		);
		const filtered = applyFilters< MascotConfig, [] >(
			'desktop-mode.mascot.config',
			fromServer,
		);
		// A filter is untrusted input like any other — re-sanitize.
		return sanitizeMascotConfig( filtered, fromServer );
	}

	private ensureLayer(): HTMLElement {
		if ( this.layer && this.layer.isConnected ) {
			return this.layer;
		}
		const existing = document.getElementById( MASCOT_LAYER_ID );
		if ( existing ) {
			this.layer = existing;
			return existing;
		}
		const el = document.createElement( 'div' );
		el.id = MASCOT_LAYER_ID;
		el.className = 'desktop-mode-mascot';
		// Decorative: the mascot conveys no information a screen
		// reader needs, and its drag handle is not a control.
		el.setAttribute( 'aria-hidden', 'true' );
		this.options.shell.appendChild( el );
		this.layer = el;
		return el;
	}

	private async mount(): Promise< void > {
		const generation = this.generation;
		if ( this.handle ) {
			return;
		}
		try {
			await this.loadBundle();
		} catch ( err ) {
			console.warn( '[desktop-mode/mascot] bundle failed to load.', err );
			return;
		}
		if ( generation !== this.generation || ! this.enabled ) {
			return;
		}
		const mount: MascotMountFn | undefined = window.desktopModeMountMascot;
		if ( typeof mount !== 'function' ) {
			console.warn(
				'[desktop-mode/mascot] bundle loaded but did not publish window.desktopModeMountMascot.',
			);
			return;
		}
		const handle = await mount( {
			host: this.ensureLayer(),
			config: this.config,
			position: readPosition(),
			savePosition: writePosition,
		} );
		if ( ! handle ) {
			// Pixi refused to start. Drop the empty layer rather than
			// leaving a dead element on the shell.
			this.layer?.remove();
			this.layer = null;
			return;
		}
		// Toggled off (or re-toggled) while Pixi was booting. The
		// disable path already ran and found no handle to destroy, so
		// this mount has to clean up after itself — including the
		// layer `ensureLayer()` re-created a moment ago.
		if ( generation !== this.generation || ! this.enabled ) {
			handle.destroy();
			this.layer?.remove();
			this.layer = null;
			return;
		}
		this.handle = handle;
	}

	private unmount(): void {
		this.handle?.destroy();
		this.handle = null;
		this.layer?.remove();
		this.layer = null;
	}

	private loadBundle(): Promise< void > {
		if ( typeof window.desktopModeMountMascot === 'function' ) {
			return Promise.resolve();
		}
		if ( ! this.loading ) {
			if ( ! this.options.bundleUrl ) {
				return Promise.reject(
					new Error( 'No mascot bundle URL in the shell config.' ),
				);
			}
			this.loading = loadVendorScript( this.options.bundleUrl ).catch(
				( err ) => {
					// Don't cache the failure — a flaky network should
					// let the next toggle try again.
					this.loading = null;
					throw err;
				},
			);
		}
		return this.loading;
	}
}

/** Read the saved viewport position, or `null` on a first run. */
function readPosition(): { x: number; y: number } | null {
	try {
		const raw = window.localStorage.getItem( POSITION_KEY );
		if ( ! raw ) {
			return null;
		}
		const parsed = JSON.parse( raw ) as { x?: unknown; y?: unknown };
		if (
			typeof parsed?.x !== 'number' ||
			typeof parsed?.y !== 'number' ||
			! Number.isFinite( parsed.x ) ||
			! Number.isFinite( parsed.y )
		) {
			return null;
		}
		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

/** Persist the mascot's resting place. */
function writePosition( pos: { x: number; y: number } ): void {
	try {
		window.localStorage.setItem( POSITION_KEY, JSON.stringify( pos ) );
	} catch {
		/* Private mode / quota — the mascot just recentres next load. */
	}
}
