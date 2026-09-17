/**
 * The shell tour — three coachmarks on a user's first boot.
 *
 * Open a window, snap it, press ⌘K. Twenty seconds, and the three
 * gestures that make the station a station rather than a wallpaper
 * behind wp-admin. Each step completes when the user actually does
 * the thing — a window opens, a snap commits, the palette opens — and
 * every card carries a "Do it for me" so nobody is stuck. There is no
 * scrim: step 2 asks the user to drag a window, so the desk has to be
 * live underneath.
 *
 * ## It takes its entry points, not the shell
 *
 * This module ships in its own lazy bundle (`shell-tour[.min].js`),
 * so it cannot read shell module state: the palette list, the window
 * stack and the dock registry compiled here would be empty copies.
 * Everything it needs arrives through {@link ShellTourDeps} — a
 * window lookup, a palette opener, a fallback window opener — and the
 * step signals are the shell's public ones: the `wp.hooks` bus
 * (`os.window.opened`, `os.snap.zone-committed`) and the
 * `os-palette-opened` document event, all of which cross bundles.
 *
 * ## Seen state
 *
 * Skip, Escape or Done records `shell-tour` in the seen-intros
 * registry, once, through the same fire-and-forget POST the rebrand
 * notice uses. That buys per-user persistence across browsers, the
 * "Reset what's-new dialogs" button and the `os-intros-reset` event
 * with no new storage. The main-bundle side (`./loader.ts`) owns the
 * boot gate and the replay listeners.
 */

import '../ui/components/os-coachmark/os-coachmark';
import '../ui/components/os-key/os-key';
import type { OsCoachmark } from '../ui/components/os-coachmark/os-coachmark';
import { __ } from '../i18n';
import { addAction, HOOKS, removeAction } from '../hooks';
import { trackedFetch } from '../tracked-fetch';

import { SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT } from './constants';

export { SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT };

/** Hook namespace for the step listeners. */
const NS = 'openstation/shell-tour';

/**
 * Where step 1 points. The Posts tile by its dock id (the classic
 * `menu-posts` entry, or the native Posts window when that beta is
 * on), else the first tile of any rail. `null` centres the card.
 */
const DOCK_TILE_SELECTORS = [
	'.os-dock [data-nav-id="menu-posts"]',
	'.os-dock [data-nav-id="desktop-mode-posts"]',
	'.os-dock .os-dock__item',
];

/** The platform-native chord for the palette. */
const SHORTCUT_LABEL =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad|iPod/i.test( navigator.platform || navigator.userAgent || '' )
		? '⌘K'
		: 'Ctrl+K';

/** The slice of a window the tour needs. */
export interface ShellTourWindowLike {
	readonly id: string;
	readonly element: HTMLElement;
	applySnap( zone: 'left' | 'right' ): void;
}

export interface ShellTourDeps {
	/** The REST base + nonce for recording the dismissal. */
	config: { seenIntrosUrl?: string; restNonce?: string };
	/** Resolves the window step 1 opened, for step 2's anchor and snap. */
	windowManager: { getById( id: string ): ShellTourWindowLike | undefined };
	/** Opens the ⌘K palette — the shell lends its own entry point. */
	openPalette: () => void;
	/** Opens some window when no dock tile can be found to click. */
	openFallbackWindow: () => void;
	/** Where the coachmark mounts. Defaults to `document.body`. */
	host?: HTMLElement;
}

export type ShellTourEndReason = 'done' | 'skip' | 'escape' | 'restart' | 'teardown';

export interface ShellTourHandle {
	/** Zero-based index of the current card (3 is the closing card). */
	readonly step: number;
	end( reason: ShellTourEndReason ): void;
}

interface StepDef {
	heading: string;
	body: () => Node[];
	primary: string;
	secondary: string;
	anchor: () => Element | null;
	/** "Do it for me". Returns true when it advanced the step itself. */
	doIt: () => boolean;
}

let current: ShellTourHandle | null = null;

/** Record the tour as seen. Silent on failure: see the rebrand notice. */
async function markSeen( config: ShellTourDeps[ 'config' ] ): Promise< void > {
	const base = config.seenIntrosUrl;
	if ( ! base ) {
		return;
	}
	try {
		await trackedFetch(
			`${ base.replace( /\/$/, '' ) }/seen`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce ?? '',
				},
				body: JSON.stringify( { slug: SHELL_TOUR_INTRO_SLUG } ),
			},
			{ source: 'desktop-mode/shell-tour', silent: true },
		);
	} catch {
		// The user has taken or skipped the tour; the cost of a lost
		// write is seeing it once more.
	}
}

function findDockTile(): HTMLElement | null {
	for ( const selector of DOCK_TILE_SELECTORS ) {
		const el = document.querySelector< HTMLElement >( selector );
		if ( el ) {
			return el;
		}
	}
	return null;
}

function paragraph( text: string ): HTMLParagraphElement {
	const p = document.createElement( 'p' );
	p.textContent = text;
	return p;
}

/** Is a tour on screen right now? */
export function isShellTourRunning(): boolean {
	return current !== null;
}

/** End the running tour, if any, without recording it as seen. */
export function endShellTour(): void {
	current?.end( 'teardown' );
}

/**
 * Start the tour. A tour already running is replaced, not stacked.
 */
export function startShellTour( deps: ShellTourDeps ): ShellTourHandle {
	current?.end( 'restart' );

	const controller = new AbortController();
	const { signal } = controller;
	const mark = document.createElement( 'os-coachmark' ) as OsCoachmark;
	mark.className = 'os-shell-tour';
	( deps.host ?? document.body ).appendChild( mark );

	let index = 0;
	let openedId = '';
	let ended = false;

	const steps: StepDef[] = [
		{
			heading: __( 'Open a window' ),
			body: () => [
				paragraph(
					__( 'Click a dock tile. Every admin screen opens as a window you can move, resize and keep beside another.' ),
				),
			],
			primary: __( 'Do it for me' ),
			secondary: __( 'Skip tour' ),
			anchor: findDockTile,
			doIt: () => {
				const tile = findDockTile();
				if ( tile ) {
					// The dock binds its open handler on the inner
					// primary button, not on the tile; a click on the
					// tile itself reaches nothing.
					( tile.querySelector< HTMLElement >( '.os-dock__item-primary' ) ?? tile ).click();
				} else {
					deps.openFallbackWindow();
				}
				// The window opens asynchronously; `os.window.opened`
				// advances the step when it lands.
				return false;
			},
		},
		{
			heading: __( 'Snap it to the side' ),
			body: () => [
				paragraph(
					__( 'Drag the window to the left edge until the preview appears, then let go. It takes half the screen; another window can take the other half.' ),
				),
			],
			primary: __( 'Do it for me' ),
			secondary: __( 'Skip tour' ),
			anchor: () => deps.windowManager.getById( openedId )?.element ?? null,
			doIt: () => {
				deps.windowManager.getById( openedId )?.applySnap( 'left' );
				// `applySnap` is the geometry, not the gesture: the
				// commit hook only fires from a real drag, so advance
				// here.
				return true;
			},
		},
		{
			heading: __( 'Find anything' ),
			body: () => {
				const p = document.createElement( 'p' );
				/* translators: %s: the keyboard shortcut, rendered as a key cap. */
				const [ before, after ] = __( 'Press %s to search screens, commands and content, or ask the assistant.' ).split( '%s' );
				p.appendChild( document.createTextNode( before ?? '' ) );
				const key = document.createElement( 'os-key' );
				key.setAttribute( 'label', SHORTCUT_LABEL );
				key.setAttribute( 'variant', 'secondary' );
				key.style.display = 'inline-flex';
				key.style.width = 'auto';
				key.style.verticalAlign = 'middle';
				key.style.setProperty( '--os-ui-key-min-height', '28px' );
				key.style.setProperty( '--os-ui-key-font-size', '12px' );
				key.style.setProperty( '--os-ui-key-padding', '2px 8px' );
				key.addEventListener( 'os-key', () => deps.openPalette(), { signal } );
				p.appendChild( key );
				p.appendChild( document.createTextNode( after ?? '' ) );
				return [ p ];
			},
			primary: __( 'Do it for me' ),
			secondary: __( 'Skip tour' ),
			anchor: () => null,
			doIt: () => {
				deps.openPalette();
				// `os-palette-opened` fires synchronously from the
				// registry; if a plugin palette forgot to announce,
				// the step would hang, so advance either way.
				return true;
			},
		},
		{
			heading: __( 'You are set' ),
			body: () => [
				paragraph(
					__( 'Windows, snapping and search: that is the station. Everything else is in OpenStation Preferences, and this tour is there too whenever you want it back.' ),
				),
			],
			primary: __( 'Done' ),
			secondary: '',
			anchor: () => null,
			doIt: () => true,
		},
	];
	const TOTAL = steps.length - 1;

	const paint = (): void => {
		const step = steps[ index ];
		mark.setAttribute( 'heading', step.heading );
		if ( index < TOTAL ) {
			mark.setAttribute( 'step', String( index + 1 ) );
			mark.setAttribute( 'total', String( TOTAL ) );
		} else {
			mark.removeAttribute( 'step' );
			mark.removeAttribute( 'total' );
		}
		mark.setAttribute( 'primary-label', step.primary );
		mark.setAttribute( 'secondary-label', step.secondary );
		mark.replaceChildren( ...step.body() );
		mark.anchor = step.anchor();
		mark.setAttribute( 'open', '' );
	};

	const advance = (): void => {
		if ( ended || index >= TOTAL ) {
			return;
		}
		index += 1;
		paint();
	};

	const handle: ShellTourHandle = {
		get step() {
			return index;
		},
		end( reason ) {
			if ( ended ) {
				return;
			}
			ended = true;
			controller.abort();
			removeAction( HOOKS.WINDOW_OPENED, NS );
			removeAction( HOOKS.SNAP_ZONE_COMMITTED, NS );
			// Let the coachmark run its close (focus restore) before
			// the node goes; a removed element cannot hand focus back.
			mark.removeAttribute( 'open' );
			window.setTimeout( () => mark.remove(), 60 );
			if ( current === handle ) {
				current = null;
			}
			if ( reason === 'done' || reason === 'skip' || reason === 'escape' ) {
				void markSeen( deps.config );
			}
		},
	};
	current = handle;

	// ---- Step signals ------------------------------------------------
	addAction< [ { windowId?: string } ] >( HOOKS.WINDOW_OPENED, NS, ( detail ) => {
		if ( index !== 0 ) {
			return;
		}
		openedId = typeof detail?.windowId === 'string' ? detail.windowId : '';
		advance();
	} );
	addAction( HOOKS.SNAP_ZONE_COMMITTED, NS, () => {
		if ( index === 1 ) {
			advance();
		}
	} );
	document.addEventListener(
		'os-palette-opened',
		() => {
			if ( index === 2 ) {
				advance();
			}
		},
		{ signal },
	);

	// ---- Card actions ------------------------------------------------
	mark.addEventListener(
		'os-coachmark-primary',
		() => {
			if ( index >= TOTAL ) {
				handle.end( 'done' );
				return;
			}
			if ( steps[ index ].doIt() ) {
				advance();
			}
		},
		{ signal },
	);
	mark.addEventListener( 'os-coachmark-secondary', () => handle.end( 'skip' ), { signal } );
	mark.addEventListener( 'os-coachmark-dismiss', () => handle.end( 'escape' ), { signal } );

	paint();
	return handle;
}
