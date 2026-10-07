import '../ui/components/os-coachmark/os-coachmark';
import '../ui/components/os-key/os-key';
import {
	COACHMARK_EXIT_MS,
	type OsCoachmark,
	type OsCoachmarkPlacement,
} from '../ui/components/os-coachmark/os-coachmark';
import { __, sprintf } from '../i18n';
import { addAction, HOOKS, removeAction } from '../hooks';
import { trackedFetch } from '../tracked-fetch';

import {
	SHELL_TOUR_DONE_SLUG,
	SHELL_TOUR_INTRO_SLUG,
	SHELL_TOUR_SKIPPED_SLUG,
	SHELL_TOUR_START_EVENT,
} from './constants';

export { SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT };

const NS = 'openstation/shell-tour';

const DOCK_TILE_SELECTORS = [
	'.os-dock [data-nav-id="menu-posts"]',
	'.os-dock [data-nav-id="desktop-mode-posts"]',
	'.os-dock .os-dock__item',
];

const TARGET_WAIT_MS = 8000;

const SHORTCUT_LABEL =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad|iPod/i.test( navigator.platform || navigator.userAgent || '' )
		? '⌘K'
		: 'Ctrl+K';

export interface ShellTourWindowLike {
	readonly id: string;
	readonly element: HTMLElement;

	snapTo( zone: 'left' | 'right' ): void;

	isSnapped?(): boolean;
	unsnap?(): void;
}

export interface ShellTourDeps {

	config: { seenIntrosUrl?: string; restNonce?: string };

	windowManager: { getById( id: string ): ShellTourWindowLike | undefined };

	openPalette: () => void;

	openFallbackWindow: () => void;

	openLayoutSettings: () => { windowId: string; wasAlreadyOpen: boolean };

	findLayoutTarget: () => Element | null;

	closeWindow: ( id: string ) => void;

	closePalette: () => void;

	mio?: {
		size: () => number;
		summon: () => void;
		follow: ( point: { x: number; y: number } | null ) => void;
		release: () => void;
	};

	refreshDesktopIcons?: () => void;

	findAssistant?: () => Element | null;

	host?: HTMLElement;
}

export type ShellTourEndReason = 'done' | 'skip' | 'escape' | 'restart' | 'teardown';

export interface ShellTourHandle {

	readonly step: number;
	end( reason: ShellTourEndReason ): void;
}

type StepId = 'menus' | 'layout' | 'open-window' | 'snap' | 'palette' | 'done';

interface StepDef {
	id: StepId;
	heading: string;
	body: () => Node[];

	primary: string | ( () => string );

	placement?: OsCoachmarkPlacement;

	speaker?: boolean;
	secondary: string;
	anchor: () => Element | null;

	doIt: () => boolean;
}

let current: ShellTourHandle | null = null;

async function markSeen( config: ShellTourDeps[ 'config' ], slug: string ): Promise< void > {
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
				body: JSON.stringify( { slug } ),
			},
			{ source: 'desktop-mode/shell-tour', silent: true },
		);
	} catch {

	}
}

async function recordOutcome( deps: ShellTourDeps, finished: boolean ): Promise< void > {
	await markSeen( deps.config, SHELL_TOUR_INTRO_SLUG );
	await markSeen( deps.config, finished ? SHELL_TOUR_DONE_SLUG : SHELL_TOUR_SKIPPED_SLUG );
	deps.refreshDesktopIcons?.();
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

export function isShellTourRunning(): boolean {
	return current !== null;
}

export function endShellTour(): void {
	current?.end( 'teardown' );
}

export function startShellTour( deps: ShellTourDeps ): ShellTourHandle {
	current?.end( 'restart' );

	const controller = new AbortController();
	const { signal } = controller;
	const mark = document.createElement( 'os-coachmark' ) as OsCoachmark;
	mark.className = 'os-shell-tour';

	const mio = deps.mio && deps.mio.size() > 0 ? deps.mio : null;
	const speakerSize = mio ? String( mio.size() ) : '';
	if ( speakerSize ) {
		mark.setAttribute( 'speaker-size', speakerSize );
	}
	( deps.host ?? document.body ).appendChild( mark );

	let index = 0;
	let openedId = '';

	let owedWindowId = '';

	let layoutShown = false;

	let layoutWindowId = '';

	let paletteOpened = false;

	let tourAskedForWindow = false;

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

			primary: () => ( layoutShown ? __( 'Next' ) : __( 'Show me' ) ),
			secondary: __( 'Skip tour' ),

			anchor: () => deps.findLayoutTarget() ?? findDockRail(),
			doIt: () => {
				if ( layoutShown ) {
					if ( layoutWindowId ) {
						const landed = !! deps.windowManager.getById( layoutWindowId );
						owedWindowId = landed ? '' : layoutWindowId;
						deps.closeWindow( layoutWindowId );
						if ( landed ) {
							openedByTour.delete( layoutWindowId );
						}
					}
					return true;
				}

				const pointedAt = deps.findLayoutTarget();
				const { windowId, wasAlreadyOpen } = deps.openLayoutSettings();
				layoutWindowId = windowId;
				if ( windowId && ! wasAlreadyOpen ) {
					openedByTour.add( windowId );
				}
				layoutShown = true;

				paint();
				followTarget( 'layout', deps.findLayoutTarget, pointedAt );

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
				tourAskedForWindow = true;
				const tile = findDockTile();
				if ( tile ) {
					( tile.querySelector< HTMLElement >( '.os-dock__item-primary' ) ?? tile ).click();
				} else {
					deps.openFallbackWindow();
				}

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
				deps.windowManager.getById( openedId )?.snapTo( 'left' );

				return true;
			},
		},
		{
			id: 'palette',
			heading: __( 'Find anything' ),
			body: () => {
				const p = document.createElement( 'p' );

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

			anchor: () => deps.findAssistant?.() ?? null,
			placement: 'bottom',
			speaker: false,
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
			mark.setAttribute(
				'counter-label',

				sprintf( __( '%1$d of %2$d' ), index + 1, TOTAL ),
			);
		} else {
			mark.removeAttribute( 'step' );
			mark.removeAttribute( 'total' );
			mark.removeAttribute( 'counter-label' );
		}
		mark.setAttribute(
			'primary-label',
			'function' === typeof step.primary ? step.primary() : step.primary,
		);
		mark.setAttribute( 'secondary-label', step.secondary );
		if ( step.placement ) {
			mark.setAttribute( 'placement', step.placement );
		} else {
			mark.removeAttribute( 'placement' );
		}
		if ( speakerSize && false !== step.speaker ) {
			mark.setAttribute( 'speaker-size', speakerSize );
		} else {
			mark.removeAttribute( 'speaker-size' );
		}
		mark.replaceChildren( ...step.body() );
		mark.anchor = step.anchor();
		mark.setAttribute( 'open', '' );
	};

	const followTarget = (
		id: StepId,
		find: () => Element | null,
		previous: Element | null,
		deadline = performance.now() + TARGET_WAIT_MS,
	): void => {
		if ( ended || id !== steps[ index ]?.id ) {
			return;
		}
		const target = find();
		if ( target && target !== previous ) {
			paint();
			return;
		}
		if ( performance.now() < deadline ) {
			requestAnimationFrame( () => followTarget( id, find, previous, deadline ) );
		}
	};

	const advance = (): void => {
		if ( ended || index >= TOTAL ) {
			return;
		}
		index += 1;
		if ( 'snap' === steps[ index ]?.id ) {
			const win = deps.windowManager.getById( openedId );
			if ( win?.isSnapped?.() ) {
				win.unsnap?.();
			}
		}
		paint();
		if ( 'done' === steps[ index ]?.id && deps.findAssistant ) {
			followTarget( 'done', deps.findAssistant, mark.anchor );
		}
	};

	const tidyUp = (): void => {
		if ( paletteOpened ) {
			try {
				deps.closePalette();
			} catch {

			}
		}
		for ( const id of openedByTour ) {
			try {
				deps.closeWindow( id );
			} catch {

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

			mark.removeAttribute( 'open' );
			window.setTimeout( () => mark.remove(), COACHMARK_EXIT_MS + 40 );
			if ( current === handle ) {
				current = null;
			}

			if ( reason !== 'restart' ) {
				mio?.release();
			}
			if ( reason === 'done' || reason === 'skip' || reason === 'escape' ) {
				void recordOutcome( deps, reason === 'done' );

				tidyUp();
			}
		},
	};
	current = handle;

	const windowArrived = (
		detail: { windowId?: string } | undefined,
		wasOpened: boolean,
	): void => {
		if ( 'open-window' !== steps[ index ]?.id ) {
			return;
		}
		if ( owedWindowId && detail?.windowId === owedWindowId ) {
			owedWindowId = '';
			return;
		}
		openedId = typeof detail?.windowId === 'string' ? detail.windowId : '';

		if ( tourAskedForWindow && wasOpened && openedId ) {
			openedByTour.add( openedId );
		}
		tourAskedForWindow = false;
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

	if ( mio ) {
		mark.addEventListener(
			'os-coachmark-speaker',
			( e ) => mio.follow( ( e as CustomEvent< { x: number; y: number } > ).detail ),
			{ signal },
		);
		mio.summon();
	}

	paint();
	return handle;
}
