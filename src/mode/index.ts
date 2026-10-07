import { doAction, HOOKS } from '../hooks';
import { stampDisplay, stampMode, type OsDisplay, type OsMode } from './stamp';

export {
	DISPLAY_ATTRIBUTE,
	MODE_ATTRIBUTE,
	OS_DISPLAYS,
	OS_MODES,
	isMobileStamped,
	isStandaloneStamped,
	readStampedDisplay,
	readStampedMode,
	stampDisplay,
	stampMode,
} from './stamp';
export type { OsDisplay, OsMode } from './stamp';

export const STANDALONE_QUERY = '(display-mode: standalone)';

export function resolveDisplay(
	win: Pick< globalThis.Window, 'matchMedia' > | undefined,
	nav: { standalone?: boolean } | undefined,
): OsDisplay {
	const matches =
		typeof win?.matchMedia === 'function' && win.matchMedia( STANDALONE_QUERY ).matches;
	return displayFor( matches, nav );
}

function displayFor( queryMatches: boolean, nav: { standalone?: boolean } | undefined ): OsDisplay {
	return queryMatches || nav?.standalone === true ? 'standalone' : 'browser';
}

export type OsModePreference = 'auto' | 'desktop' | 'mobile';

export const OS_MODE_PREFERENCES: readonly OsModePreference[] = [
	'auto',
	'desktop',
	'mobile',
];

export const MOBILE_MAX_WIDTH = 767;

export const TABLET_MAX_WIDTH = 1024;

export interface OsModeBreakpoints {

	mobile: number;

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

export interface OsModeApi {

	get(): OsMode;

	getPreference(): OsModePreference;

	getBreakpoints(): Readonly< OsModeBreakpoints >;

	isMobile(): boolean;

	getDisplay(): OsDisplay;

	isStandalone(): boolean;

	subscribe(
		cb: ( change: OsModeChange ) => void,
		opts?: { immediate?: boolean },
	): () => void;
}

export function sanitizeModePreference( raw: unknown ): OsModePreference {
	return OS_MODE_PREFERENCES.includes( raw as OsModePreference )
		? ( raw as OsModePreference )
		: 'auto';
}

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

	preference?: OsModePreference;
	breakpoints?: Partial< OsModeBreakpoints >;

	root?: Element;

	win?: Pick< globalThis.Window, 'matchMedia' | 'innerWidth' >;

	nav?: { standalone?: boolean };
}

export interface ModeController {
	api: OsModeApi;

	setPreference( preference: OsModePreference ): void;

	dispose(): void;
}

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

	const nav =
		opts.nav ??
		( typeof navigator !== 'undefined'
			? ( navigator as unknown as { standalone?: boolean } )
			: undefined );
	const displayQuery: MediaQueryList | null =
		typeof win.matchMedia === 'function' ? win.matchMedia( STANDALONE_QUERY ) : null;
	let display: OsDisplay = displayFor( !! displayQuery?.matches, nav );
	stampDisplay( root, display );
	const updateDisplay = (): void => {
		display = displayFor( !! displayQuery?.matches, nav );
		stampDisplay( root, display );
	};

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

	const queries: MediaQueryList[] = [];
	if ( typeof win.matchMedia === 'function' ) {
		for ( const px of [ breakpoints.mobile, breakpoints.tablet ] ) {
			const q = win.matchMedia( `(max-width: ${ px }px)` );

			if ( typeof q.addEventListener === 'function' ) {
				q.addEventListener( 'change', update );
			} else if ( typeof q.addListener === 'function' ) {
				q.addListener( update );
			}
			queries.push( q );
		}
	}
	if ( displayQuery ) {
		if ( typeof displayQuery.addEventListener === 'function' ) {
			displayQuery.addEventListener( 'change', updateDisplay );
		} else if ( typeof displayQuery.addListener === 'function' ) {
			displayQuery.addListener( updateDisplay );
		}
	}

	const api: OsModeApi = {
		get: () => mode,
		getPreference: () => preference,
		getBreakpoints: () => ( { ...breakpoints } ),
		isMobile: () => 'mobile' === mode,
		getDisplay: () => display,
		isStandalone: () => 'standalone' === display,
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
			if ( displayQuery ) {
				if ( typeof displayQuery.removeEventListener === 'function' ) {
					displayQuery.removeEventListener( 'change', updateDisplay );
				} else if ( typeof displayQuery.removeListener === 'function' ) {
					displayQuery.removeListener( updateDisplay );
				}
			}
			listeners.clear();
		},
	};
}
