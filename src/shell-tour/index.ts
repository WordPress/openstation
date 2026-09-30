/**
 * The shell tour — five coachmarks on a user's first boot.
 *
 * Where the menus are, how to change the layout, then the three
 * gestures that make the station a station rather than a wallpaper
 * behind wp-admin: open a window, snap it, press ⌘K. The two opening
 * cards orient; the three that follow each complete when the user
 * actually does the thing — a window opens, a snap commits, the
 * palette opens — and every card carries an action so nobody is
 * stuck. There is no scrim: the snap card asks the user to drag a
 * window, so the desk has to be live underneath.
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
	/**
	 * Optional so a test double need not implement them. The snap card
	 * floats a window that is already against the edge it is about to
	 * demonstrate, because snapping it again would change nothing on
	 * screen and the card would read as broken.
	 */
	isSnapped?(): boolean;
	unsnap?(): void;
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
	/**
	 * Opens Preferences on Appearance, at the Desktop layout section.
	 *
	 * Reports the window, because that open is the tour's own doing on
	 * two counts: the card after it is waiting for the user to open a
	 * window (see `ignoreWindowId`), and the tour closes what it opened
	 * when it ends — but only when it opened it, never a window the
	 * user already had.
	 */
	openLayoutSettings: () => { windowId: string; wasAlreadyOpen: boolean };
	/**
	 * Where the layout settings are on screen right now: the way in to
	 * Preferences before the card opens it, and the Desktop layout
	 * section once it is showing. `null` when neither can be found, and
	 * the card falls back to the menu rail.
	 */
	findLayoutTarget: () => Element | null;
	/** Closes a window the tour opened. */
	closeWindow: ( id: string ) => void;
	/** Closes the assistant palette. */
	closePalette: () => void;
	/** Where the coachmark mounts. Defaults to `document.body`. */
	host?: HTMLElement;
}

export type ShellTourEndReason = 'done' | 'skip' | 'escape' | 'restart' | 'teardown';

export interface ShellTourHandle {
	/** Zero-based index of the current card (3 is the closing card). */
	readonly step: number;
	end( reason: ShellTourEndReason ): void;
}

/**
 * What each card is, for the step signals to match on. An index would
 * have to be renumbered every time a card moves, silently pointing a
 * signal at the wrong step; a name cannot drift.
 */
type StepId = 'menus' | 'layout' | 'open-window' | 'snap' | 'palette' | 'done';

interface StepDef {
	id: StepId;
	heading: string;
	body: () => Node[];
	/** A function when the label changes within the card. */
	primary: string | ( () => string );
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

/**
 * The rail the menu tiles live on.
 *
 * Resolved from the tile the "open a window" card points at, so Split's
 * two rails collapse to the one that actually carries the menus rather
 * than whichever comes first in the DOM.
 */
function findDockRail(): HTMLElement | null {
	return (
		findDockTile()?.closest< HTMLElement >( '.os-dock' ) ??
		document.querySelector< HTMLElement >( '.os-dock' )
	);
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
	/**
	 * A window the tour opened itself, which must not count as the user
	 * opening one. The layout card opens Preferences; that fires
	 * `os.window.opened` a tick later, by which time the card after it
	 * is on screen asking for exactly that event, and it would answer
	 * its own question. Consumed once, so a user who then opens
	 * Preferences by hand still completes the card.
	 */
	let ignoreWindowId = '';
	/** Has the layout card opened Preferences yet? Drives its own label. */
	let layoutShown = false;
	/** Did a palette open while the tour was up? Then the tour closes it. */
	let paletteOpened = false;
	/**
	 * Windows the tour OPENED, which it closes again when it ends, so a
	 * first run does not leave the desk covered in what the tour did.
	 * Only its own: a window that was already there, or that the user
	 * opened, is theirs to keep.
	 */
	const openedByTour = new Set< string >();
	let ended = false;

	const steps: StepDef[] = [
		{
			id: 'menus',
			heading: __( 'All your menu items are here' ),
			body: () => [
				paragraph(
					__( 'Every WordPress admin menu lives on this rail. Hover a tile for its name; the ones with submenus fan them out.' ),
				),
			],
			// Nothing to perform, so the action is simply the way on.
			primary: __( 'Next' ),
			secondary: __( 'Skip tour' ),
			anchor: findDockRail,
			doIt: () => true,
		},
		{
			id: 'layout',
			heading: __( 'Configure the layout as you wish' ),
			body: () => [
				paragraph(
					__( 'The rail can move to another edge, split in two, or park itself out of the way.' ),
				),
				paragraph( __( 'OpenStation Preferences → Appearance → Desktop layout.' ) ),
			],
			// Two beats in one card: open Preferences, then let the user
			// look at what opened before moving on.
			primary: () => ( layoutShown ? __( 'Next' ) : __( 'Show me' ) ),
			secondary: __( 'Skip tour' ),
			// Before "Show me" this is the tile that opens Preferences;
			// after it, the Desktop layout section itself. Either way the
			// ring is on the thing the card is talking about, not on the
			// whole rail.
			anchor: () => deps.findLayoutTarget() ?? findDockRail(),
			doIt: () => {
				if ( layoutShown ) {
					return true;
				}
				// What the card is pointing at right now, so the follow
				// below can tell "Preferences has painted its section"
				// from "the tile is still the best we have".
				const pointedAt = deps.findLayoutTarget();
				const { windowId, wasAlreadyOpen } = deps.openLayoutSettings();
				ignoreWindowId = windowId;
				if ( windowId && ! wasAlreadyOpen ) {
					openedByTour.add( windowId );
				}
				layoutShown = true;
				// Relabel now; re-anchor onto the section once the app has
				// painted it, which is a few frames away at best.
				paint();
				followLayoutTarget( pointedAt );
				// Opening a window is not this card's completion signal —
				// `os.window.opened` belongs to the card after it — and the
				// card is not finished anyway: the user still has to look.
				return false;
			},
		},
		{
			id: 'open-window',
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
			id: 'snap',
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
			id: 'palette',
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
			id: 'done',
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
		mark.setAttribute(
			'primary-label',
			'function' === typeof step.primary ? step.primary() : step.primary,
		);
		mark.setAttribute( 'secondary-label', step.secondary );
		mark.replaceChildren( ...step.body() );
		mark.anchor = step.anchor();
		mark.setAttribute( 'open', '' );
	};

	/**
	 * Re-anchor the layout card once the target MOVES ON — from the tile
	 * that opens Preferences to the Desktop layout section itself.
	 *
	 * Waiting for a target to merely exist would return on the first
	 * frame, because the tile is already there; the card would then
	 * stay pinned to the dock while the section it is talking about sat
	 * open behind it. The coachmark positions when its anchor is set
	 * and does not follow a scroll, so this waits for the section to be
	 * painted, its page showing and the reveal scrolled, then points.
	 */
	const followLayoutTarget = (
		previous: Element | null,
		framesLeft = 60,
	): void => {
		if ( ended || 'layout' !== steps[ index ]?.id ) {
			return;
		}
		const target = deps.findLayoutTarget();
		if ( target && target !== previous ) {
			paint();
			return;
		}
		if ( framesLeft > 0 ) {
			requestAnimationFrame( () =>
				followLayoutTarget( previous, framesLeft - 1 ),
			);
		}
	};

	const advance = (): void => {
		if ( ended || index >= TOTAL ) {
			return;
		}
		index += 1;
		if ( 'snap' === steps[ index ]?.id ) {
			// A window already against that edge would not move, and a
			// card whose "Do it for me" changes nothing reads as broken.
			const win = deps.windowManager.getById( openedId );
			if ( win?.isSnapped?.() ) {
				win.unsnap?.();
			}
		}
		paint();
	};

	/**
	 * Put the desk back. The tour opens windows to demonstrate with, and
	 * on a first boot leaving them all up is the opposite of the fresh
	 * start it just finished describing. Only what the tour opened
	 * itself, so a window the user already had is never taken away.
	 */
	const tidyUp = (): void => {
		if ( paletteOpened ) {
			try {
				deps.closePalette();
			} catch {
				/* the tour is over; a palette left open is not worth a throw */
			}
		}
		for ( const id of openedByTour ) {
			try {
				deps.closeWindow( id );
			} catch {
				/* same */
			}
		}
		openedByTour.clear();
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
			removeAction( HOOKS.WINDOW_REOPENED, NS );
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
				// The user is finished with the tour, however they said so.
				// A restart or a teardown is not finished: leave the desk.
				tidyUp();
			}
		},
	};
	current = handle;

	// ---- Step signals ------------------------------------------------
	// Step 1 is satisfied by a window ARRIVING, which is two signals,
	// not one: a fresh open, and a reopen when that screen was already
	// on the desk. The dock tile calls `open()` either way, and the
	// manager answers an already-open singleton with `WINDOW_REOPENED`
	// instead, so listening only for `WINDOW_OPENED` left "Do it for
	// me" dead for anyone who had Posts open when they took the tour.
	// Not `WINDOW_FOCUSED`: the manager's own note says it double-fires
	// on alt-tab and never fires when the window is already focused.
	const windowArrived = (
		detail: { windowId?: string } | undefined,
		wasOpened: boolean,
	): void => {
		if ( 'open-window' !== steps[ index ]?.id ) {
			return;
		}
		if ( ignoreWindowId && detail?.windowId === ignoreWindowId ) {
			ignoreWindowId = '';
			return;
		}
		openedId = typeof detail?.windowId === 'string' ? detail.windowId : '';
		// A reopen means the screen was already on the desk, so it is the
		// user's window and the tour does not close it at the end.
		if ( wasOpened && openedId ) {
			openedByTour.add( openedId );
		}
		advance();
	};
	addAction< [ { windowId?: string } ] >( HOOKS.WINDOW_OPENED, NS, ( detail ) =>
		windowArrived( detail, true ),
	);
	addAction< [ { windowId?: string } ] >( HOOKS.WINDOW_REOPENED, NS, ( detail ) =>
		windowArrived( detail, false ),
	);
	addAction( HOOKS.SNAP_ZONE_COMMITTED, NS, () => {
		if ( 'snap' === steps[ index ]?.id ) {
			advance();
		}
	} );
	document.addEventListener(
		'os-palette-opened',
		() => {
			paletteOpened = true;
			if ( 'palette' === steps[ index ]?.id ) {
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
