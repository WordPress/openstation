/**
 * Desktop Mode — canvas stage loader + controller (main-bundle side).
 *
 * Ships in `desktop[.min].js`. Deliberately imports nothing from
 * `./stage`, `./index` or `./effects/*` — those pull in the Pixi glue,
 * and the whole point of the lazy `stage` bundle is that a user who
 * never switches the feature on never downloads it. The only shared
 * code is `./feature-detect` and `./chain`, both pure.
 *
 * Owns three decisions:
 *
 * 1. **Whether to start at all** — the browser must support
 *    HTML-in-Canvas and the user must have `canvasStageEnabled` on.
 * 2. **When the wrap is safe** — moving the shell into the canvas
 *    re-parents every `<iframe>`, which reloads it and would throw away
 *    unsaved work in an open editor. At boot there are no windows, so
 *    the wrap is free; at runtime we only do it when no iframe window
 *    is open, and otherwise offer a page reload.
 * 3. **What is live** — effect selection and every slider are applied
 *    without a reload, always. Only the master toggle is gated.
 *
 * @since 0.9.8
 */

import { __ } from '../i18n';
import { wpdConfirm } from '../wpd-confirm';
import { isStageSupported } from './feature-detect';
import type { ScreenEffectSelection } from './types';

/** The API `src/stage/entry.ts` publishes on `window`. */
interface StageBundleApi {
	start( options: {
		shell: HTMLElement;
		selection?: ScreenEffectSelection[];
		windowEffects?: Record< string, unknown >;
	} ): Promise< void >;
	stop(): void;
	setSelection( selection: ScreenEffectSelection[] ): Promise< void >;
	setWindowEffects( selection: Record< string, unknown > ): void;
	isActive(): boolean;
}

/**
 * Minimal shape of the OS-settings object this controller reads. Kept
 * structural so the controller can be unit-tested with a stub instead
 * of a real `OsSettings` instance.
 */
export interface StageOsSettings {
	getOsSettingsSnapshot(): StageRelevantSettings;
	subscribeOsSettings( cb: ( snapshot: StageRelevantSettings ) => void ): () => void;
}

/** The slice of OS settings the stage controller cares about. */
interface StageRelevantSettings {
	canvasStageEnabled?: boolean;
	screenEffects?: ScreenEffectSelection[];
	windowEffects?: Record< string, unknown >;
}

export interface StageControllerOptions {
	/** The shell root — `#desktop-mode-shell`. */
	shell: HTMLElement;
	/** URL of `stage[.min].js`, from `desktopModeConfig.stageBundleUrl`. */
	bundleUrl: string;
	/** OS settings, for the initial read and live updates. */
	osSettings: StageOsSettings;
	/** Loads vendor modules by id — `wp.desktop.loadModules`. */
	loadModules( ids: string[] ): Promise< void >;
	/**
	 * Whether any open window hosts an `<iframe>`. Wrapping while one is
	 * open would reload it, so the controller asks before re-parenting.
	 */
	hasIframeWindows(): boolean;
}

let inflight: Promise< StageBundleApi > | null = null;

function loadedBundle(): StageBundleApi | null {
	return (
		( window as unknown as { desktopModeStage?: StageBundleApi } )
			.desktopModeStage ?? null
	);
}

function injectScript( scriptUrl: string ): Promise< StageBundleApi > {
	return new Promise( ( resolve, reject ) => {
		const finish = (): void => {
			const api = loadedBundle();
			if ( api ) {
				resolve( api );
				return;
			}
			reject(
				new Error(
					'[desktop-mode/stage] bundle loaded but did not publish window.desktopModeStage.',
				),
			);
		};

		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-desktop-mode-stage="1"]',
		);
		if ( existing ) {
			if ( loadedBundle() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load the stage bundle' ) ),
				);
			}
			return;
		}

		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.desktopModeStage = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load the stage bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

/**
 * Load PixiJS, the HTML-in-Canvas add-on and the stage bundle, in that
 * order. Concurrent callers share one load.
 *
 * The two Pixi modules are loaded **sequentially, not in parallel**:
 * `pixi-html-source.min.js` extends `window.PIXI` at evaluation time
 * and throws if the core bundle has not defined it yet, and
 * `loadModules()` fans its ids out through `Promise.all`.
 *
 * @param bundleUrl   URL of `stage[.min].js`.
 * @param loadModules The shell's vendor-module loader.
 */
export async function ensureStageBundle(
	bundleUrl: string,
	loadModules: ( ids: string[] ) => Promise< void >,
): Promise< StageBundleApi > {
	const already = loadedBundle();
	if ( already ) {
		return already;
	}
	if ( ! bundleUrl ) {
		throw new Error(
			'[desktop-mode/stage] no stage bundle URL configured.',
		);
	}
	if ( ! inflight ) {
		inflight = ( async () => {
			await loadModules( [ 'pixijs' ] );
			await loadModules( [ 'pixi-html-source' ] );
			return injectScript( bundleUrl );
		} )().catch( ( err ) => {
			// Reset so a later retry (the user toggling again) can start
			// a fresh load rather than re-awaiting a rejected promise.
			inflight = null;
			throw err;
		} );
	}
	return inflight;
}

export interface StageController {
	/**
	 * Resolves once the boot-time wrap is done — or immediately when the
	 * stage is off or unsupported.
	 *
	 * **Boot must await this before opening any window.** Wrapping the
	 * shell re-parents its whole subtree, so a window opened while the
	 * stage is still loading Pixi would have its iframe reloaded the
	 * moment the wrap landed. Gating session restore on this promise is
	 * what keeps the wrap free.
	 */
	ready: Promise< void >;
	/** Unsubscribe from settings and stop the stage. */
	dispose(): void;
}

/**
 * Wire the canvas stage to OS settings and start it if the user already
 * had it on.
 *
 * Call this during boot **before** session restore opens any windows —
 * that is the one moment when re-parenting the shell costs nothing.
 *
 * @param options Shell, bundle URL, settings and window-manager probe.
 */
export function startStageController(
	options: StageControllerOptions,
): StageController {
	const { shell, bundleUrl, osSettings, loadModules, hasIframeWindows } =
		options;

	const supported = isStageSupported();
	let enabled =
		supported &&
		osSettings.getOsSettingsSnapshot().canvasStageEnabled === true;
	let selection = osSettings.getOsSettingsSnapshot().screenEffects ?? [];
	let windowEffects = osSettings.getOsSettingsSnapshot().windowEffects ?? {};

	const ready = enabled ? start( selection ) : Promise.resolve();

	async function start( next: ScreenEffectSelection[] ): Promise< void > {
		try {
			const api = await ensureStageBundle( bundleUrl, loadModules );
			await api.start( { shell, selection: next, windowEffects } );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode/stage] failed to start the canvas stage; the desktop keeps rendering as plain DOM:',
					err,
				);
			}
		}
	}

	const unsubscribe = osSettings.subscribeOsSettings( ( snapshot ) => {
		const nextEnabled = supported && snapshot.canvasStageEnabled === true;
		const nextSelection = snapshot.screenEffects ?? [];
		const selectionChanged =
			JSON.stringify( nextSelection ) !== JSON.stringify( selection );
		selection = nextSelection;

		// Window transition choices are read fresh on every transition,
		// so pushing them through is all that live-applying takes.
		const nextWindowEffects = snapshot.windowEffects ?? {};
		if (
			JSON.stringify( nextWindowEffects ) !== JSON.stringify( windowEffects )
		) {
			windowEffects = nextWindowEffects;
			loadedBundle()?.setWindowEffects( nextWindowEffects );
		}

		if ( nextEnabled === enabled ) {
			// Steady state — only the effect chain can have moved, and
			// that is always live.
			if ( enabled && selectionChanged ) {
				void loadedBundle()?.setSelection( nextSelection );
			}
			return;
		}

		enabled = nextEnabled;

		// The master toggle flipped. Re-parenting the shell reloads every
		// iframe inside it, so when windows are open we ask first rather
		// than silently discarding whatever the user was editing.
		if ( hasIframeWindows() ) {
			void promptReload( nextEnabled );
			return;
		}

		if ( nextEnabled ) {
			void start( nextSelection );
		} else {
			loadedBundle()?.stop();
		}
	} );

	return {
		ready,
		dispose: () => {
			unsubscribe();
			loadedBundle()?.stop();
		},
	};
}

async function promptReload( turningOn: boolean ): Promise< void > {
	const confirmed = await wpdConfirm( {
		title: turningOn
			? __( 'Reload to render the desktop in a canvas?' )
			: __( 'Reload to stop rendering in a canvas?' ),
		message: __(
			'Switching the canvas renderer moves the whole desktop, which reloads every open window. Save your work first — anything unsaved in an open window will be lost.',
		),
		confirmLabel: __( 'Reload now' ),
		cancelLabel: __( 'Later' ),
	} );
	if ( confirmed ) {
		window.location.reload();
	}
}
