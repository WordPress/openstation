/**
 * OpenStation — responsive mode.
 *
 * One answer to "which experience is the shell rendering?":
 *
 *   `'desktop'` — 1025px and up. Windows, dock, wallpaper icons.
 *   `'tablet'`  — 768px to 1024px. Reported, not yet a distinct
 *                 layout: the shell renders the desktop experience.
 *   `'mobile'`  — up to 767px. The phone layer (`src/mobile/`) takes
 *                 over: a home grid, full-screen apps, an app
 *                 switcher and a bottom tab bar.
 *
 * The mode is a pure function of the viewport width and the user's
 * preference (`'auto' | 'desktop' | 'mobile'`, Preferences → Mobile).
 * `resolveMode()` is that function, exported alone so tests and the
 * PHP-printed first-paint stamp (`openstation_print_mode_stamp()`)
 * can agree on it without booting anything.
 *
 * The module owns exactly three side effects: it stamps
 * `data-os-mode` on `<html>` (the selector every mode-aware
 * stylesheet keys on — the same attribute the head stamp writes, so
 * the first paint and the live value never disagree), it fires
 * `HOOKS.MODE_CHANGED` on the hook bus, and it dispatches the
 * `os-mode-changed` CustomEvent on `document`. Nothing here lays
 * anything out; the phone layer and the desktop surfaces subscribe
 * and decide for themselves, per `docs/event-driven-framework.md`.
 *
 * Detection is `matchMedia`, not a `resize` listener: the browser
 * fires the media-query listener only on a crossing, so a desktop
 * user dragging a window edge costs nothing here.
 */
import { doAction, HOOKS } from '../hooks';
import { stampMode, type OsMode } from './stamp';

export { MODE_ATTRIBUTE, OS_MODES, readStampedMode, stampMode, isMobileStamped } from './stamp';
export type { OsMode } from './stamp';

/** The user's override. `'auto'` follows the viewport. */
export type OsModePreference = 'auto' | 'desktop' | 'mobile';

export const OS_MODE_PREFERENCES: readonly OsModePreference[] = [
	'auto',
	'desktop',
	'mobile',
];

/** Widest viewport (CSS px, inclusive) that is a phone. */
export const MOBILE_MAX_WIDTH = 767;
/** Widest viewport (CSS px, inclusive) that is a tablet. */
export const TABLET_MAX_WIDTH = 1024;

export interface OsModeBreakpoints {
	/** Viewports at or below this width are `'mobile'`. */
	mobile: number;
	/** Viewports at or below this width (and above `mobile`) are `'tablet'`. */
	tablet: number;
}

export const DEFAULT_BREAKPOINTS: Readonly< OsModeBreakpoints > = {
	mobile: MOBILE_MAX_WIDTH,
	tablet: TABLET_MAX_WIDTH,
};

export interface OsModeChange {
	mode: OsMode;
	previous: OsMode;
	preference: OsModePreference;
}

type ModeListener = ( change: OsModeChange ) => void;

/**
 * The public `wp.os.mode` surface. Read-only from the outside: the
 * preference is a setting, and settings are written through
 * `wp.os.updateOsSettings( { mobileLayout } )` like every other one.
 */
export interface OsModeApi {
	/** The effective mode right now. */
	get(): OsMode;
	/** The user's override that produced it. */
	getPreference(): OsModePreference;
	/** The breakpoints in force (filterable server-side). */
	getBreakpoints(): Readonly< OsModeBreakpoints >;
	/** `get() === 'mobile'`. */
	isMobile(): boolean;
	/**
	 * Called with every transition, and — when `immediate` is set —
	 * once right away with the current mode. Returns the
	 * unsubscribe function.
	 */
	subscribe(
		cb: ( change: OsModeChange ) => void,
		opts?: { immediate?: boolean },
	): () => void;
}

/**
 * Coerce an unknown value to a preference, defaulting to `'auto'`.
 */
export function sanitizeModePreference( raw: unknown ): OsModePreference {
	return OS_MODE_PREFERENCES.includes( raw as OsModePreference )
		? ( raw as OsModePreference )
		: 'auto';
}

/**
 * Coerce an unknown breakpoint object, keeping the invariant
 * `0 < mobile < tablet` so the three bands stay disjoint whatever a
 * filter returned.
 */
export function sanitizeBreakpoints( raw: unknown ): OsModeBreakpoints {
	const obj = ( raw && typeof raw === 'object' ? raw : {} ) as Record<
		string,
		unknown
	>;
	const num = ( v: unknown, fallback: number ): number => {
		const n = typeof v === 'number' ? v : Number( v );
		return Number.isFinite( n ) && n > 0 ? Math.floor( n ) : fallback;
	};
	const mobile = num( obj.mobile, DEFAULT_BREAKPOINTS.mobile );
	const tablet = Math.max(
		mobile + 1,
		num( obj.tablet, DEFAULT_BREAKPOINTS.tablet ),
	);
	return { mobile, tablet };
}

/**
 * The mode for a viewport width under a preference. Pure.
 *
 * A forced preference wins regardless of width: `'desktop'` on a
 * phone is the "give me the real thing" escape hatch, `'mobile'` on
 * a desktop is how a developer previews the phone layer without a
 * device.
 */
export function resolveMode(
	width: number,
	preference: OsModePreference = 'auto',
	breakpoints: Readonly< OsModeBreakpoints > = DEFAULT_BREAKPOINTS,
): OsMode {
	if ( 'mobile' === preference ) {
		return 'mobile';
	}
	if ( 'desktop' === preference ) {
		return 'desktop';
	}
	if ( width <= breakpoints.mobile ) {
		return 'mobile';
	}
	if ( width <= breakpoints.tablet ) {
		return 'tablet';
	}
	return 'desktop';
}

export interface InstallModeOptions {
	/** Initial preference, normally `osSettings.mobileLayout`. */
	preference?: OsModePreference;
	breakpoints?: Partial< OsModeBreakpoints >;
	/** Defaults to `document.documentElement`. */
	root?: Element;
	/** Defaults to the global `window`; injectable for tests. */
	win?: Pick< globalThis.Window, 'matchMedia' | 'innerWidth' >;
}

export interface ModeController {
	api: OsModeApi;
	/** Re-resolve under a new preference (the settings store calls this). */
	setPreference( preference: OsModePreference ): void;
	/** Stop listening to the viewport. Leaves the stamp in place. */
	dispose(): void;
}

/**
 * Wire the mode to the viewport and the hook bus. One call per shell.
 */
export function installMode( opts: InstallModeOptions = {} ): ModeController {
	const root = opts.root ?? document.documentElement;
	const win = opts.win ?? window;
	const breakpoints = sanitizeBreakpoints( {
		...DEFAULT_BREAKPOINTS,
		...( opts.breakpoints ?? {} ),
	} );
	let preference = sanitizeModePreference( opts.preference );
	const listeners = new Set< ModeListener >();

	const measure = (): number =>
		typeof win.innerWidth === 'number' && win.innerWidth > 0
			? win.innerWidth
			: Number.POSITIVE_INFINITY;

	let mode: OsMode = resolveMode( measure(), preference, breakpoints );
	stampMode( root, mode );

	const update = (): void => {
		const next = resolveMode( measure(), preference, breakpoints );
		if ( next === mode ) {
			return;
		}
		const change: OsModeChange = { mode: next, previous: mode, preference };
		mode = next;
		stampMode( root, mode );
		doAction( HOOKS.MODE_CHANGED, change );
		document.dispatchEvent(
			new CustomEvent< OsModeChange >( 'os-mode-changed', { detail: change } ),
		);
		for ( const cb of listeners ) {
			try {
				cb( change );
			} catch ( err ) {
				console.error( '[openstation] mode listener threw:', err );
			}
		}
	};

	// Two crossings, two queries. The listener fires only when a
	// query flips, so an ordinary resize inside one band is free.
	const queries: MediaQueryList[] = [];
	if ( typeof win.matchMedia === 'function' ) {
		for ( const px of [ breakpoints.mobile, breakpoints.tablet ] ) {
			const q = win.matchMedia( `(max-width: ${ px }px)` );
			// Older WebKit shipped `addListener` only.
			if ( typeof q.addEventListener === 'function' ) {
				q.addEventListener( 'change', update );
			} else if ( typeof q.addListener === 'function' ) {
				q.addListener( update );
			}
			queries.push( q );
		}
	}

	const api: OsModeApi = {
		get: () => mode,
		getPreference: () => preference,
		getBreakpoints: () => ( { ...breakpoints } ),
		isMobile: () => 'mobile' === mode,
		subscribe( cb, subOpts ) {
			listeners.add( cb );
			if ( subOpts?.immediate ) {
				cb( { mode, previous: mode, preference } );
			}
			return () => {
				listeners.delete( cb );
			};
		},
	};

	return {
		api,
		setPreference( next ) {
			const clean = sanitizeModePreference( next );
			if ( clean === preference ) {
				return;
			}
			preference = clean;
			update();
		},
		dispose() {
			for ( const q of queries ) {
				if ( typeof q.removeEventListener === 'function' ) {
					q.removeEventListener( 'change', update );
				} else if ( typeof q.removeListener === 'function' ) {
					q.removeListener( update );
				}
			}
			listeners.clear();
		},
	};
}
