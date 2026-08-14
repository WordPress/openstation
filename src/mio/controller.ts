/**
 * OpenStation — Mio controller (shell side).
 *
 * The always-on half of Mio: a few hundred bytes in
 * `desktop[.min].js` that own the layer element, the on/off
 * preference, and the lazy load of the real thing.
 *
 * The simulation, PixiJS, and the renderer live in
 * `assets/js/mio[.min].js` and are fetched the first time the
 * Mio is switched on. A user who never turns it on never
 * downloads a byte of it.
 *
 * Mio is a **first-class shell layer**, not a widget: it owns
 * a sibling of the wallpaper inside `#os-shell`, paints
 * above every window, and is not bound by the widget column's
 * placement rules. Widgets are cards on a rail; Mio roams.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { MIO_DEFAULTS, sanitizeMioConfig } from './config';
import { emptyMioLook, sanitizeMioLook, splitMioLook } from './look';
import type {
	MioAppearance,
	MioConfig,
	MioHandle,
	MioLook,
	MioLookPhysics,
	MioMountFn,
	PartialMioConfig,
} from './types';

/** localStorage key for Mio's resting place. */
const POSITION_KEY = 'desktop-mode-mio-position';

/*
 * There is no localStorage key for the user's *look*, on purpose.
 *
 * It lives in user meta, inside the OS Settings blob, reached through
 * the `savedLook` / `persistLook` options below. The look is the one
 * Mio preference that is about the person rather than the machine —
 * someone who spends ten minutes building a companion should find it
 * on their phone, and on the machine they use at work. The position
 * above stays local precisely because it is *not* that: where Mio
 * rests is a fact about one screen.
 *
 * `saveState()` on the settings side still writes localStorage
 * synchronously before it POSTs, so the fast local cache is not lost —
 * it is just no longer the source of truth.
 */

/** Id of the layer element the controller creates inside the shell. */
export const MIO_LAYER_ID = 'os-mio';

/**
 * Id of the dock tile that toggles Mio.
 *
 * Doubles as the key OS Settings → Apps & Plugins writes its visibility
 * override under, so it has to be stable.
 */
export const MIO_TILE_ID = 'os-mio-toggle';

/**
 * Mio's dock icon: the ring and the eyes, and nothing else.
 *
 * A portrait rather than a symbol. Dashicons has no mark that means
 * "your desk companion", and the nearest stand-ins (a superhero, a
 * speech balloon) say something else entirely — the only icon that
 * reads as Mio is Mio.
 *
 * **The alpha has to carry the identity, not the colour.** A desktop
 * theme may tint any dock icon, and `renderIcon()` implements a tint
 * by painting the art as a *mask*: the fill comes from the theme and
 * only the artwork's alpha survives. An earlier version of this icon
 * drew a near-black body disc under the ring — faithful to the real
 * thing, and it collapsed under the mask to a flat filled circle,
 * because a disc is exactly what its alpha is. So there is no body
 * here. The centre is transparent, the ring is a stroke, and the eyes
 * are the only other thing with any coverage, which means the
 * silhouette *is* the face. Tinted it reads as a ring with two eyes;
 * untinted it keeps the neon sweep below.
 *
 * Kept as readable source and base64-encoded once at module load, so
 * the art stays reviewable in a diff instead of arriving as an opaque
 * blob. No `currentColor` anywhere — that keyword routes art down a
 * second, always-on mask path in `src/icon.ts` and would throw the
 * gradient away even on an untinted dock.
 */
const MIO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
<defs><linearGradient id="mio" x1="19" y1="19" x2="5" y2="5" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#3f6dff"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#ff4fd8"/>
</linearGradient></defs>
<circle cx="12" cy="12" r="8.2" fill="none" stroke="url(#mio)" stroke-width="2.6"/>
<rect x="8" y="9.6" width="2.9" height="4.8" rx="1.45" fill="#fff"/>
<rect x="13.1" y="9.6" width="2.9" height="4.8" rx="1.45" fill="#fff"/>
</svg>`;

/** The same art as a data URI, ready for `renderIcon()`. */
export const MIO_TILE_ICON = `data:image/svg+xml;base64,${ btoa(
	MIO_ICON_SVG,
) }`;

export interface MioControllerOptions {
	/** Shell element the layer is appended to. */
	shell: HTMLElement;
	/** URL of the lazy Mio bundle, from the shell config. */
	bundleUrl: string;
	/** Server-side config (`openstation_mio_config` filter output). */
	serverConfig?: unknown;
	/** Whether the user's saved preference has Mio on. */
	enabled: boolean;
	/** Persist the on/off preference. Called on every user toggle. */
	persist: ( enabled: boolean ) => void;
	/**
	 * The user's saved look, as it came back from user meta. Anything
	 * unrecognisable is dropped — see `sanitizeMioLook`.
	 */
	savedLook?: unknown;
	/**
	 * Persist the user's look. Called whenever a control in "Make it
	 * yours" moves, and once more when the panel closes.
	 *
	 * The implementation is expected to debounce its own network call
	 * (the OS Settings store does), so this can be called on every
	 * slider frame without thinking about it.
	 */
	persistLook?: ( look: MioLook ) => void;
}

/**
 * Public shape exposed as `wp.os.mio`.
 *
 * @public
 */
export interface MioApi {
	/** Whether Mio is currently switched on. */
	isEnabled: () => boolean;
	/** Switch Mio on. Resolves once it is on screen. */
	enable: () => Promise< void >;
	/** Switch Mio off and release the WebGL context. */
	disable: () => void;
	/** Flip the current state. Resolves once the change is applied. */
	toggle: () => Promise< void >;
	/** Body centre in viewport coordinates, or `null` when off. */
	getPosition: () => { x: number; y: number } | null;
	/** Move Mio. No-op when off. */
	setPosition: ( x: number, y: number ) => void;
	/** The resolved configuration currently in force. */
	getConfig: () => MioConfig;
	/**
	 * Merge a partial configuration over the current one and apply it
	 * live. Values are clamped; see `docs/mio.md`.
	 */
	setConfig: ( partial: PartialMioConfig ) => void;
	/**
	 * Apply part of the user's *look* live and remember it — what the
	 * "Make it yours" panel writes on every slider move.
	 *
	 * Takes a flat bag of {@link MioAppearance} keys and the
	 * {@link MioLookPhysics} ones (silhouette, shuffle, idle wobble),
	 * and splits them itself. Anything else in the object is dropped,
	 * so this can never become a back door onto the spring constants.
	 *
	 * Distinct from {@link setConfig}, which is the programmatic
	 * surface and deliberately doesn't persist: a plugin adjusting Mio
	 * for a moment shouldn't silently become the user's saved look.
	 */
	setStyle: ( partial: Partial< MioAppearance & MioLookPhysics > ) => void;
	/** The user's own look, as it will be stored. */
	getLook: () => MioLook;
	/**
	 * Write the current look to the user's account now.
	 *
	 * Every {@link setStyle} already records it, so this is not the
	 * only save — it is the one that runs when the panel closes, which
	 * is the moment a user thinks of themselves as having finished.
	 */
	commitStyle: () => void;
	/**
	 * Forget the saved look and go back to the Mio this site ships —
	 * server config plus the `os.mio.config` filter.
	 * Persisted immediately: "Restore Mio" should still be restored on
	 * the next device.
	 */
	resetStyle: () => void;
}

export class MioController {
	private options: MioControllerOptions;
	private layer: HTMLElement | null = null;
	private handle: MioHandle | null = null;
	/**
	 * A stopped-but-alive instance, kept across a disable.
	 *
	 * Switching Mio off does NOT release its WebGL context. Releasing
	 * one is the single most disruptive thing this module can ask the
	 * browser to do — a full-viewport GPU layer disappears, the
	 * compositor re-rasterises, and on some frames that surfaces as a
	 * white flash across the shell. Parking sidesteps it: the ticker
	 * stops, the layer is hidden, and the context simply stays put
	 * until the page goes away.
	 *
	 * The cost is one idle context and its canvas for the rest of the
	 * page's life, and only for a user who switched Mio on at least
	 * once. A user who never touches it still allocates nothing. The
	 * payoff beyond the flash is that re-enabling is instant: no
	 * bundle fetch, no Pixi boot, no re-created context.
	 */
	private parked: { handle: MioHandle; layer: HTMLElement } | null = null;
	private config: MioConfig;
	private enabled: boolean;
	/**
	 * Bumped on every enable/disable. An in-flight mount compares it
	 * on resolve and self-destructs if the user has since changed
	 * their mind — otherwise a fast on-off-on lands two mios.
	 */
	private generation = 0;
	private loading: Promise< void > | null = null;
	/**
	 * The user's own look, as set from "Make it yours".
	 *
	 * A personal preference about a decorative thing, so it stays well
	 * clear of the `openstation_mio_config` filter — it is applied
	 * *after* it, in {@link resolveConfig}, and a site changing its
	 * shipped Mio never fights a user who has expressed an opinion.
	 */
	private look: MioLook = emptyMioLook();

	public constructor( options: MioControllerOptions ) {
		this.options = options;
		this.enabled = options.enabled;
		// Before `resolveConfig()`, which layers the look over the
		// site's Mio and must therefore already have one.
		this.look = sanitizeMioLook( options.savedLook );
		this.config = this.resolveConfig();
	}

	/** Mount now if the saved preference says so. */
	public boot(): void {
		if ( this.enabled ) {
			void this.mount();
		}
	}

	public api(): MioApi {
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
			setConfig: ( partial: PartialMioConfig ) => {
				this.config = sanitizeMioConfig( partial, this.config );
				this.handle?.applyConfig( this.config );
			},
			setStyle: (
				partial: Partial< MioAppearance & MioLookPhysics >,
			) => {
				const next = splitMioLook( partial );
				this.look = {
					appearance: { ...this.look.appearance, ...next.appearance },
					physics: { ...this.look.physics, ...next.physics },
				};
				this.config = sanitizeMioConfig(
					{ appearance: next.appearance, physics: next.physics },
					this.config,
				);
				this.handle?.applyConfig( this.config );
				this.commitLook();
			},
			getLook: () => ( {
				appearance: { ...this.look.appearance },
				physics: { ...this.look.physics },
			} ),
			commitStyle: () => this.commitLook(),
			resetStyle: () => {
				this.look = emptyMioLook();
				this.config = this.resolveConfig();
				this.handle?.applyConfig( this.config );
				this.commitLook();
			},
		};
	}

	/**
	 * Turn Mio on or off, persisting the preference and firing
	 * the lifecycle action. Re-entrant-safe.
	 */
	public async setEnabled( next: boolean ): Promise< void > {
		if ( next === this.enabled ) {
			return;
		}
		this.enabled = next;
		this.generation++;
		this.options.persist( next );
		doAction( next ? 'os.mio.enabled' : 'os.mio.disabled', {} );
		// Repaint the dock tile's active dot. Its `isOpen()` asks
		// whether the companion is on screen, which is not a question
		// about windows, so no window event will ever fire for it.
		doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );
		if ( next ) {
			await this.mount();
		} else {
			this.unmount();
		}
	}

	/**
	 * Merge server config, defaults, the JS filter, and the user's own
	 * saved style into the configuration Mio actually runs with.
	 *
	 * The user's style goes last on purpose. Everything before it is
	 * something a site decided; this is something a person decided, on
	 * their own machine, about how their own companion looks.
	 */
	private resolveConfig(): MioConfig {
		const fromServer = sanitizeMioConfig(
			this.options.serverConfig,
			MIO_DEFAULTS,
		);
		const filtered = applyFilters< MioConfig, [] >(
			'os.mio.config',
			fromServer,
		);
		// A filter is untrusted input like any other — re-sanitize.
		const resolved = sanitizeMioConfig( filtered, fromServer );
		return sanitizeMioConfig(
			{ appearance: this.look.appearance, physics: this.look.physics },
			resolved,
		);
	}

	/**
	 * Hand the current look to whoever is storing it.
	 *
	 * Deliberately unconditional — including when the look is empty,
	 * which is how "Restore Mio" travels to the user's other devices.
	 * An empty look is a statement ("I want the site's Mio"), not the
	 * absence of one.
	 */
	private commitLook(): void {
		this.options.persistLook?.( {
			appearance: { ...this.look.appearance },
			physics: { ...this.look.physics },
		} );
	}

	private ensureLayer(): HTMLElement {
		if ( this.layer && this.layer.isConnected ) {
			return this.layer;
		}
		const existing = document.getElementById( MIO_LAYER_ID );
		if ( existing ) {
			this.layer = existing;
			return existing;
		}
		const el = document.createElement( 'div' );
		el.id = MIO_LAYER_ID;
		el.className = 'os-mio';
		// Decorative: Mio conveys no information a screen
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
		// Wake a parked instance rather than building a new one. This
		// is the common path for anyone toggling Mio, and it is
		// synchronous — no bundle load, no Pixi boot, no new context.
		const parked = this.parked;
		if ( parked ) {
			this.parked = null;
			parked.layer.style.removeProperty( 'display' );
			parked.handle.applyConfig( this.config );
			parked.handle.setAnimating( true );
			this.handle = parked.handle;
			this.layer = parked.layer;
			return;
		}
		try {
			await this.loadBundle();
		} catch ( err ) {
			console.warn( '[desktop-mode/mio] bundle failed to load.', err );
			return;
		}
		if ( generation !== this.generation || ! this.enabled ) {
			return;
		}
		const mount: MioMountFn | undefined = window.openStationMountMio;
		if ( typeof mount !== 'function' ) {
			console.warn(
				'[desktop-mode/mio] bundle loaded but did not publish window.openStationMountMio.',
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
		// disable path already ran and found no handle to park, so this
		// mount has to put its own instance away — parked rather than
		// destroyed, for the same reason the disable path parks: no
		// toggle should ever release a WebGL context.
		if ( generation !== this.generation || ! this.enabled ) {
			const layer = this.layer;
			this.layer = null;
			handle.setAnimating( false );
			if ( layer ) {
				layer.style.display = 'none';
				this.parked = { handle, layer };
			} else {
				handle.destroy();
			}
			return;
		}
		this.handle = handle;
	}

	/**
	 * Take Mio off the desk.
	 *
	 * **Nothing is destroyed here.** The instance is parked instead —
	 * ticker stopped, layer hidden, WebGL context left alone — because
	 * releasing the context is what makes the browser re-rasterise the
	 * whole shell, and that is what surfaces as a white flash. See
	 * {@link parked}.
	 *
	 * The position is read while the layer is still laid out. Hiding it
	 * makes the host report zero size, and every position derived from
	 * a zero-size host is the top-left corner.
	 */
	private unmount(): void {
		const handle = this.handle;
		const layer = this.layer;
		this.handle = null;
		this.layer = null;
		if ( ! handle || ! layer ) {
			layer?.remove();
			return;
		}
		const resting = handle.getPosition();
		if ( resting ) {
			writePosition( resting );
		}
		handle.setAnimating( false );
		layer.style.display = 'none';
		this.parked = { handle, layer };
	}

	private loadBundle(): Promise< void > {
		if ( typeof window.openStationMountMio === 'function' ) {
			return Promise.resolve();
		}
		if ( ! this.loading ) {
			if ( ! this.options.bundleUrl ) {
				return Promise.reject(
					new Error( 'No Mio bundle URL in the shell config.' ),
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

/** Persist Mio's resting place. */
function writePosition( pos: { x: number; y: number } ): void {
	try {
		window.localStorage.setItem( POSITION_KEY, JSON.stringify( pos ) );
	} catch {
		/* Private mode / quota — Mio just recentres next load. */
	}
}
