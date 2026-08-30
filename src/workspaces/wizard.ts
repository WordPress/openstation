/**
 * The workspace wizard — the one door to a new desk.
 *
 * Opened by the `+` in the overview top bar, and by **Edit** under a
 * tile. It replaces two things that used to compete for the same job:
 * a dropdown that created desks from templates, and a `+` that
 * created a blank one without asking. One door, and it is the obvious
 * one.
 *
 * ## The escape hatch is the first thing on screen
 *
 * Most of the time a user pressing `+` wants a new desk and nothing
 * else. So the first step, **Start**, has a **Blank desktop** card
 * preselected and the **Create** button focused: `+` then Enter is a
 * plain new desk, the same two gestures it was before the wizard
 * existed. Picking a template and pressing Create is a desk from that
 * template, exactly as the dropdown did. **Customize** is the only
 * route into the remaining steps, and on every one of them Create is
 * still in the footer — the wizard can be left at any point with
 * whatever has been set so far. Nobody is walked through five steps
 * to get an empty desk.
 *
 * ## It takes data, not the shell
 *
 * Everything the wizard shows arrives through
 * {@link WorkspaceWizardOptions} — apps, widgets, wallpapers, accents,
 * templates — and everything it decides leaves through `onCreate` /
 * `onSave`. It imports no store and reads no module state, which is
 * what lets it live in its own lazy bundle without the cross-bundle
 * hazards described in `docs/examples/shared-store.md`. The one
 * computation it cannot do alone — reading a template against the
 * live navigation — is injected as `resolvePreset`.
 *
 * ## Edit is the same wizard without Start
 *
 * A workspace is a thing adjusted twenty times, not set up once, so
 * editing must not feel like a different tool. The same steps, the
 * same panes, Save where Create was, and a Delete in the corner.
 */

// Component classes, imported for their side-effect registration.
// This module only ever ships inside the lazy wizard bundle, so the
// weight never reaches `desktop.min.js`.
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-button/os-button';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-checkbox/os-checkbox';
import '../ui/components/os-switch/os-switch';
import '../ui/components/os-steps/os-steps';
import '../ui/components/os-card/os-card';
import '../ui/components/os-grid/os-grid';
import '../ui/components/os-swatch/os-swatch';
import '../ui/components/os-swatch-grid/os-swatch-grid';
import '../ui/components/os-segmented/os-segmented';
import '../ui/components/os-chip/os-chip';
import '../ui/components/os-icon/os-icon';
import '../ui/components/os-color-field/os-color-field';
import '../ui/components/os-select/os-select';

import { __ } from '../i18n';
// The live-preview manager the Preferences wallpaper grid uses. Safe
// to share with this bundle: the wallpaper registry and the per-
// wallpaper settings it reads both live in a `createSharedStore`, so
// the copy compiled here sees the shell's own defs.
import {
	createWallpaperPreviewManager,
	type WallpaperPreviewManager,
} from '../settings/sections/wallpaper-previews';
import type { NavKind } from '../nav/types';
import type {
	WorkspaceAppearance,
	WorkspaceLaunch,
	WorkspaceLayoutId,
	WorkspacePreset,
	WorkspaceProfile,
} from './types';
import { blankWorkspaceProfile, WORKSPACE_LAYOUTS } from './types';

/**
 * One row in the apps checklist — and, when it opens something, one
 * option in the Windows step's "Add a window" picker.
 */
export interface WorkspaceWizardApp {
	id: string;
	title: string;
	kind: NavKind;
	locked?: boolean;
	/** Admin URL the app opens, for an iframe window. */
	url?: string;
	/** Native window id the app opens, when it opens one. */
	windowId?: string;
}

/** One row in the widgets checklist. */
export interface WorkspaceWizardWidget {
	id: string;
	label: string;
	description?: string;
}

/** One wallpaper swatch. `preview` is a CSS background value. */
export interface WorkspaceWizardWallpaper {
	id: string;
	label: string;
	preview: string;
}

/** One accent swatch. `value` is `#rrggbb`. */
export interface WorkspaceWizardAccent {
	id: string;
	label: string;
	value: string;
}

/** What the wizard hands back when the user commits. */
export interface WorkspaceWizardResult {
	label: string;
	/**
	 * `null` for a plain Space — a blank start the user did not
	 * customize. A desk with no profile behaves exactly as one did
	 * before workspaces existed, which is what "just a new desktop"
	 * should mean.
	 */
	profile: WorkspaceProfile | null;
	/**
	 * Set when the user pressed Create on a template WITHOUT
	 * customizing it. The shell then creates from the preset id, so
	 * the `os.workspaces.profile` filter runs exactly as it would have
	 * from the old dropdown.
	 */
	preset?: string;
}

export interface WorkspaceWizardOptions {
	mode: 'create' | 'edit';
	/** The desk being edited. Ignored in create mode. */
	desktopId?: string;
	/** Initial name. Empty in create mode means "auto-number it". */
	label?: string;
	/** Initial profile. Edit mode; create mode starts blank. */
	profile?: WorkspaceProfile;
	presets: WorkspacePreset[];
	apps: WorkspaceWizardApp[];
	widgets: WorkspaceWizardWidget[];
	/** The user's own widget column — the starting point when a desk takes one over. */
	enabledWidgetIds: string[];
	wallpapers: WorkspaceWizardWallpaper[];
	accents: WorkspaceWizardAccent[];
	/** Read a template against the live navigation. */
	resolvePreset: ( preset: WorkspacePreset ) => WorkspaceProfile;
	/** The shell's current appearance, as a workspace patch. */
	captureAppearance: () => WorkspaceAppearance;
	/** The windows open on the desk, as a launch list. Edit mode. */
	captureWindows?: () => WorkspaceLaunch[];
	/** Commit. Create mode. */
	onCreate?: ( result: WorkspaceWizardResult ) => void;
	/** Commit. Edit mode. */
	onSave?: ( result: WorkspaceWizardResult ) => void;
	/** Delete the desk. Edit mode; omitted when it is the last one. */
	onDelete?: () => void;
}

const ROOT_CLASS = 'os-workspace-wizard';

/** The value of the Start card that means "no template". */
const BLANK = 'blank';

/**
 * Glyphs a desk can wear. A curated dozen rather than every dashicon:
 * the picker has to fit in a modal and read at a glance, and a desk's
 * glyph is a category, not an illustration.
 */
const ICONS: ReadonlyArray< { id: string; label: string } > = [
	{ id: 'dashicons-desktop', label: 'Desktop' },
	{ id: 'dashicons-cart', label: 'Cart' },
	{ id: 'dashicons-welcome-learn-more', label: 'Learning' },
	{ id: 'dashicons-edit-page', label: 'Writing' },
	{ id: 'dashicons-admin-users', label: 'People' },
	{ id: 'dashicons-chart-bar', label: 'Analytics' },
	{ id: 'dashicons-admin-comments', label: 'Conversations' },
	{ id: 'dashicons-megaphone', label: 'Marketing' },
	{ id: 'dashicons-format-image', label: 'Media' },
	{ id: 'dashicons-admin-tools', label: 'Tools' },
	{ id: 'dashicons-portfolio', label: 'Projects' },
	{ id: 'dashicons-groups', label: 'Community' },
];

type StepId = 'start' | 'name' | 'apps' | 'widgets' | 'look' | 'windows';

const STEP_TITLES: Record< StepId, () => string > = {
	start: () => __( 'Start' ),
	name: () => __( 'Name' ),
	apps: () => __( 'Apps' ),
	widgets: () => __( 'Widgets' ),
	look: () => __( 'Look' ),
	windows: () => __( 'Windows' ),
};

/** Human labels for the layout picker. */
function layoutLabel( id: WorkspaceLayoutId ): string {
	switch ( id ) {
		case 'cascade':
			return __( 'Cascade' );
		case 'tile':
			return __( 'Tile' );
		case 'columns':
			return __( 'Columns' );
		case 'focus':
			return __( 'Focus' );
		case 'free':
		default:
			return __( 'Free' );
	}
}

function layoutHint( id: WorkspaceLayoutId ): string {
	switch ( id ) {
		case 'cascade':
			return __( 'Staggered, every window the same size.' );
		case 'tile':
			return __( 'A uniform grid covering the desk.' );
		case 'columns':
			return __( 'Full-height columns, side by side — for things you compare.' );
		case 'focus':
			return __( 'One window leading, the rest stacked in the margin — for the thing you are working on.' );
		case 'free':
		default:
			return __( 'Nothing is moved. Windows land where they land.' );
	}
}

/**
 * Whether a profile says nothing a plain Space would not — the test
 * for handing back `null` instead of a workspace.
 */
function isBlankProfile( p: WorkspaceProfile ): boolean {
	return (
		'all' === p.apps.mode &&
		( ! p.widgets || 'all' === p.widgets.mode ) &&
		Object.keys( p.appearance ?? {} ).length === 0 &&
		p.windows.length === 0 &&
		'free' === p.layout &&
		'dashicons-desktop' === p.icon &&
		'' === p.color
	);
}

/** Deep-enough copy of a profile for a working draft. */
function cloneProfile( p: WorkspaceProfile ): WorkspaceProfile {
	return {
		...p,
		apps: { ...p.apps, ids: [ ...p.apps.ids ] },
		widgets: {
			mode: p.widgets?.mode ?? 'all',
			ids: [ ...( p.widgets?.ids ?? [] ) ],
		},
		appearance: { ...( p.appearance ?? {} ) },
		windows: p.windows.map( ( w ) => ( { ...w } ) ),
	};
}

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className?: string,
): HTMLElementTagNameMap[ K ];
function el( tag: string, className?: string ): HTMLElement;
function el( tag: string, className?: string ): HTMLElement {
	const node = document.createElement( tag );
	if ( className ) {
		node.className = className;
	}
	return node;
}

function hint( text: string ): HTMLElement {
	const p = el( 'p', `${ ROOT_CLASS }__hint` );
	p.textContent = text;
	return p;
}

/**
 * A label sitting tight above a control that has none of its own —
 * a swatch row, a segmented bar, a chip list. The pane's own gap is
 * the step between *fields*; inside one, label and control are a
 * pair and read as one.
 */
function labelled( text: string, control: HTMLElement ): HTMLElement {
	const field = el( 'div', `${ ROOT_CLASS }__field` );
	const label = el( 'span', `${ ROOT_CLASS }__label` );
	label.textContent = text;
	field.appendChild( label );
	field.appendChild( control );
	return field;
}

function heading( text: string, sub?: string ): HTMLElement {
	const wrap = el( 'div', `${ ROOT_CLASS }__heading` );
	const h = el( 'h3', `${ ROOT_CLASS }__title` );
	h.textContent = text;
	wrap.appendChild( h );
	if ( sub ) {
		wrap.appendChild( hint( sub ) );
	}
	return wrap;
}

let active: HTMLElement | null = null;

/** Whatever the open wizard has to release before it goes. */
let activeCleanup: ( () => void ) | null = null;

/** Close the open wizard, if any. */
export function closeWorkspaceWizard(): void {
	activeCleanup?.();
	activeCleanup = null;
	active?.remove();
	active = null;
}

/**
 * Open the wizard.
 *
 * Edits a working draft and commits it in one call on Create / Save,
 * so Cancel, Escape and a click on the scrim genuinely discard.
 */
export function openWorkspaceWizard( options: WorkspaceWizardOptions ): void {
	closeWorkspaceWizard();

	const isEdit = 'edit' === options.mode;
	const steps: StepId[] = isEdit
		? [ 'name', 'apps', 'widgets', 'look', 'windows' ]
		: [ 'start', 'name', 'apps', 'widgets', 'look', 'windows' ];

	// --- State ----------------------------------------------------
	let label = options.label ?? '';
	let draft = cloneProfile( options.profile ?? blankWorkspaceProfile() );
	/** Start-step pick: `BLANK` or a preset id. Create mode only. */
	let start = BLANK;
	/**
	 * Whether the user went past Start. Until they do, Create on a
	 * template means "from the preset, untouched", and the shell runs
	 * the profile filter exactly as the old dropdown did.
	 */
	let customized = isEdit;
	let stepIndex = 0;
	/**
	 * Live previews for the Look step's wallpaper tiles. WebGL contexts
	 * are a scarce per-page resource, so the manager exists only while
	 * that step is on screen and is disposed the moment it is not.
	 */
	let previews: WallpaperPreviewManager | null = null;
	const disposePreviews = (): void => {
		previews?.dispose();
		previews = null;
	};

	// --- Modal ----------------------------------------------------
	const modal = el( 'os-modal', ROOT_CLASS );
	modal.setAttribute( 'size', 'lg' );
	modal.setAttribute(
		'title',
		isEdit ? __( 'Edit workspace' ) : __( 'New desktop' ),
	);
	modal.setAttribute( 'open', '' );

	const body = el( 'div', `${ ROOT_CLASS }__body` );
	modal.appendChild( body );

	const trail = el( 'os-steps', `${ ROOT_CLASS }__trail` );
	trail.setAttribute( 'horizontal', '' );
	body.appendChild( trail );

	const pane = el( 'div', `${ ROOT_CLASS }__pane` );
	body.appendChild( pane );

	const footer = el( 'div', `${ ROOT_CLASS }__footer` );
	footer.slot = 'footer';
	modal.appendChild( footer );

	// --- Commit ---------------------------------------------------
	const commit = (): void => {
		const name = label.trim();
		if ( ! isEdit && ! customized && start !== BLANK ) {
			options.onCreate?.( { label: name, profile: null, preset: start } );
			closeWorkspaceWizard();
			return;
		}
		const result: WorkspaceWizardResult = {
			label: name,
			profile: isBlankProfile( draft ) ? null : draft,
		};
		if ( isEdit ) {
			options.onSave?.( result );
		} else {
			options.onCreate?.( result );
		}
		closeWorkspaceWizard();
	};

	// --- Trail ----------------------------------------------------
	const renderTrail = (): void => {
		trail.replaceChildren();
		steps.forEach( ( id, i ) => {
			const step = el( 'os-step' );
			step.setAttribute( 'title', STEP_TITLES[ id ]() );
			if ( i < stepIndex ) {
				step.setAttribute( 'done', '' );
			}
			if ( i === stepIndex ) {
				step.setAttribute( 'current', '' );
			}
			// A way back, never a way forward: skipping ahead past
			// Start would bypass the one decision the later steps
			// depend on.
			if ( i < stepIndex ) {
				step.setAttribute( 'interactive', '' );
				step.addEventListener( 'os-step-click', () => go( i ) );
			}
			trail.appendChild( step );
		} );
	};

	// --- Steps ----------------------------------------------------

	/** Start — blank, or one of the templates. */
	const renderStart = (): void => {
		pane.appendChild(
			heading(
				__( 'What is this desktop for?' ),
				__( 'A blank desktop is one click away. A template sets up the apps, widgets, look and windows for a job — and you can change any of it.' ),
			),
		);
		const grid = el( 'os-grid', `${ ROOT_CLASS }__cards` );
		grid.setAttribute( 'columns', '2' );
		grid.setAttribute( 'gap', '10' );

		const cards: Array< { id: string; node: HTMLElement } > = [];
		const paintSelected = (): void => {
			for ( const c of cards ) {
				c.node.toggleAttribute( 'selected', c.id === start );
			}
		};
		const addCard = (
			id: string,
			icon: string,
			title: string,
			desc: string,
			color: string,
		): void => {
			const card = el( 'os-card', `${ ROOT_CLASS }__card` );
			card.setAttribute( 'interactive', '' );
			card.setAttribute( 'compact', '' );
			if ( color ) {
				card.style.setProperty( '--os-workspace-accent', color );
			}
			const header = el( 'div', `${ ROOT_CLASS }__card-header` );
			header.slot = 'header';
			const glyph = el( 'os-icon', `${ ROOT_CLASS }__card-icon` );
			glyph.setAttribute( 'name', icon );
			glyph.setAttribute( 'size', '22' );
			header.appendChild( glyph );
			const t = el( 'strong' );
			t.textContent = title;
			header.appendChild( t );
			card.appendChild( header );
			const d = el( 'div', `${ ROOT_CLASS }__card-desc` );
			d.textContent = desc;
			card.appendChild( d );
			card.addEventListener( 'os-card-click', () => {
				// Click once to choose, again to go — activating the
				// card that is already chosen is the user saying "this
				// one", and Enter on it should not need a second trip
				// to the footer.
				if ( start === id ) {
					commit();
					return;
				}
				start = id;
				paintSelected();
				renderFooter();
			} );
			cards.push( { id, node: card } );
			grid.appendChild( card );
		};

		addCard(
			BLANK,
			'dashicons-desktop',
			__( 'Blank desktop' ),
			__( 'Just a new, empty desk. Turn it into a workspace later if you like.' ),
			'',
		);
		for ( const preset of options.presets ) {
			addCard(
				preset.id,
				preset.icon,
				preset.label,
				preset.description,
				preset.color,
			);
		}
		paintSelected();
		pane.appendChild( grid );
	};

	/** Name, glyph and colour. */
	const renderName = (): void => {
		pane.appendChild(
			heading(
				__( 'Name it' ),
				__( 'The name goes on its overview tile. The glyph and colour are how you tell it apart from the others at a glance.' ),
			),
		);
		const field = el( 'os-text-field' );
		field.setAttribute( 'label', __( 'Name' ) );
		field.setAttribute( 'value', label );
		field.setAttribute(
			'placeholder',
			isEdit ? '' : __( 'Leave empty to number it' ),
		);
		field.addEventListener( 'os-input-change', ( e: Event ) => {
			label = ( e as CustomEvent< { value: string } > ).detail.value;
		} );
		field.addEventListener( 'os-submit', () => commit() );
		pane.appendChild( field );

		// `mode="row"` + `size="small"`: a flex row of fixed chips. The
		// grid's default mode is `1fr` columns, which is right for
		// wallpapers and wrong here — a glyph is a 28px choice, and a
		// column that grows to 180px turns it into a billboard.
		const icons = el( 'os-swatch-grid', `${ ROOT_CLASS }__icons` );
		icons.setAttribute( 'label', __( 'Glyph' ) );
		icons.setAttribute( 'mode', 'row' );
		for ( const icon of ICONS ) {
			const sw = el( 'os-swatch', `${ ROOT_CLASS }__icon-swatch` );
			sw.setAttribute( 'value', icon.id );
			sw.setAttribute( 'label', icon.label );
			sw.setAttribute( 'size', 'small' );
			// The accent variant is the rounded square every other
			// pickable thing in the kit is; the plain small size is a
			// disc, which reads as a legend rather than a choice.
			sw.setAttribute( 'variant', 'accent' );
			sw.setAttribute( 'preview', 'transparent' );
			if ( draft.icon === icon.id ) {
				sw.setAttribute( 'selected', '' );
			}
			const glyph = el( 'os-icon' );
			glyph.setAttribute( 'name', icon.id );
			glyph.setAttribute( 'size', '16' );
			sw.appendChild( glyph );
			sw.addEventListener( 'os-pick', () => {
				draft.icon = icon.id;
				for ( const s of Array.from( icons.children ) ) {
					s.toggleAttribute(
						'selected',
						s.getAttribute( 'value' ) === icon.id,
					);
				}
			} );
			icons.appendChild( sw );
		}
		pane.appendChild( labelled( __( 'Glyph' ), icons ) );

		const colors = el( 'os-swatch-grid', `${ ROOT_CLASS }__colors` );
		colors.setAttribute( 'label', __( 'Colour' ) );
		colors.setAttribute( 'mode', 'row' );
		const paintColors = (): void => {
			for ( const s of Array.from( colors.children ) ) {
				s.toggleAttribute(
					'selected',
					s.getAttribute( 'value' ) === ( draft.color || 'none' ),
				);
			}
		};
		const none = el( 'os-swatch' );
		none.setAttribute( 'value', 'none' );
		none.setAttribute( 'label', __( 'No colour' ) );
		none.setAttribute( 'size', 'small' );
		none.setAttribute( 'variant', 'accent' );
		none.setAttribute( 'preview', 'transparent' );
		none.addEventListener( 'os-pick', () => {
			draft.color = '';
			paintColors();
		} );
		colors.appendChild( none );
		for ( const accent of options.accents ) {
			const sw = el( 'os-swatch' );
			sw.setAttribute( 'value', accent.value );
			sw.setAttribute( 'label', accent.label );
			sw.setAttribute( 'size', 'small' );
			sw.setAttribute( 'variant', 'accent' );
			sw.setAttribute( 'preview', accent.value );
			sw.addEventListener( 'os-pick', () => {
				draft.color = accent.value;
				paintColors();
			} );
			colors.appendChild( sw );
		}
		paintColors();
		pane.appendChild( labelled( __( 'Colour' ), colors ) );

		const custom = el( 'os-color-field' );
		custom.setAttribute( 'label', __( 'Or any colour' ) );
		custom.setAttribute( 'value', draft.color || '#f252fc' );
		custom.addEventListener( 'os-color-change', ( e: Event ) => {
			draft.color = ( e as CustomEvent< { value: string } > ).detail.value;
			paintColors();
		} );
		pane.appendChild( custom );
	};

	/**
	 * A "mode switch + checklist" pane, shared by Apps and Widgets:
	 * the same decision in two registers — what belongs on this desk.
	 */
	const renderChecklist = ( cfg: {
		title: string;
		sub: string;
		switchLabel: string;
		note: string;
		isOn: () => boolean;
		setOn: ( on: boolean ) => void;
		rows: Array< { id: string; label: string; forced?: boolean } >;
		has: ( id: string ) => boolean;
		toggle: ( id: string, on: boolean ) => void;
	} ): void => {
		pane.appendChild( heading( cfg.title, cfg.sub ) );
		const toggle = el( 'os-switch' );
		toggle.setAttribute( 'label', cfg.switchLabel );
		if ( cfg.isOn() ) {
			toggle.setAttribute( 'checked', '' );
		}
		pane.appendChild( toggle );
		pane.appendChild( hint( cfg.note ) );

		const list = el( 'div', `${ ROOT_CLASS }__list` );
		const paint = (): void => {
			list.replaceChildren();
			list.hidden = ! cfg.isOn();
			if ( ! cfg.isOn() ) {
				return;
			}
			for ( const row of cfg.rows ) {
				const box = el( 'os-checkbox' );
				box.setAttribute( 'block', '' );
				box.setAttribute( 'value', row.id );
				box.setAttribute( 'label', row.label );
				if ( row.forced || cfg.has( row.id ) ) {
					box.setAttribute( 'checked', '' );
				}
				if ( row.forced ) {
					box.setAttribute( 'disabled', '' );
				} else {
					box.addEventListener( 'os-checkbox-change', ( e: Event ) => {
						cfg.toggle(
							row.id,
							( e as CustomEvent< { checked: boolean } > ).detail
								.checked,
						);
					} );
				}
				list.appendChild( box );
			}
		};
		toggle.addEventListener( 'os-switch-change', ( e: Event ) => {
			cfg.setOn(
				( e as CustomEvent< { checked: boolean } > ).detail.checked,
			);
			paint();
		} );
		paint();
		pane.appendChild( list );
	};

	const renderApps = (): void => {
		renderChecklist( {
			title: __( 'Which apps show here?' ),
			sub: __( 'Narrow the dock to the apps this desk is about. Everything else is still there — on your other desks, and the moment you leave this one.' ),
			switchLabel: __( 'Show only the apps I pick' ),
			note: __( 'OpenStation’s own controls — Overview, System, Trash, Exit — always stay, so a desk can never be one you cannot leave.' ),
			isOn: () => 'only' === draft.apps.mode,
			setOn: ( on ) => {
				draft.apps.mode = on ? 'only' : 'all';
				// Starting from what is on screen, not from nothing: an
				// empty list would blank the rails the instant the
				// switch flipped.
				if ( on && draft.apps.ids.length === 0 ) {
					draft.apps.ids = options.apps
						.filter( ( a ) => 'control' !== a.kind && ! a.locked )
						.map( ( a ) => a.id );
				}
			},
			rows: options.apps.map( ( a ) => ( {
				id: a.id,
				label: a.title,
				forced: 'control' === a.kind || !! a.locked,
			} ) ),
			has: ( id ) => draft.apps.ids.includes( id ),
			toggle: ( id, on ) => {
				const without = draft.apps.ids.filter( ( x ) => x !== id );
				draft.apps.ids = on ? [ ...without, id ] : without;
			},
		} );
	};

	const renderWidgets = (): void => {
		if ( options.widgets.length === 0 ) {
			pane.appendChild(
				heading(
					__( 'Widgets' ),
					__( 'No widgets are registered on this site yet.' ),
				),
			);
			return;
		}
		renderChecklist( {
			title: __( 'Which widgets sit on it?' ),
			sub: __( 'A desk can carry its own widget column — drafts and a timer where you write, traffic where you sell.' ),
			switchLabel: __( 'Give this desk its own widgets' ),
			note: __( 'Off, it shows the column you built. On, it shows exactly these — and yours comes back when you leave.' ),
			isOn: () => 'only' === draft.widgets?.mode,
			setOn: ( on ) => {
				const ids =
					on && ( draft.widgets?.ids.length ?? 0 ) === 0
						? options.enabledWidgetIds.slice()
						: draft.widgets?.ids ?? [];
				draft.widgets = { mode: on ? 'only' : 'all', ids };
			},
			rows: options.widgets.map( ( w ) => ( { id: w.id, label: w.label } ) ),
			has: ( id ) => !! draft.widgets?.ids.includes( id ),
			toggle: ( id, on ) => {
				const without = ( draft.widgets?.ids ?? [] ).filter(
					( x ) => x !== id,
				);
				draft.widgets = { mode: 'only', ids: on ? [ ...without, id ] : without };
			},
		} );
	};

	/** Wallpaper, accent, dock — a real picker, not a form. */
	const renderLook = (): void => {
		pane.appendChild(
			heading(
				__( 'How does it look?' ),
				__( 'A desk can wear its own wallpaper, accent and dock. Your own settings come back the moment you leave it.' ),
			),
		);
		const own = (): boolean =>
			Object.keys( draft.appearance ?? {} ).length > 0;

		const toggle = el( 'os-switch' );
		toggle.setAttribute( 'label', __( 'Give this desk its own look' ) );
		if ( own() ) {
			toggle.setAttribute( 'checked', '' );
		}
		pane.appendChild( toggle );

		const pickers = el( 'div', `${ ROOT_CLASS }__pickers` );
		const paint = (): void => {
			pickers.replaceChildren();
			pickers.hidden = ! own();
			if ( ! own() ) {
				return;
			}
			const a = draft.appearance ?? {};

			const useNow = el( 'os-button' );
			useNow.setAttribute( 'variant', 'ghost' );
			useNow.textContent = __( 'Use the look I have now' );
			useNow.addEventListener( 'click', () => {
				draft.appearance = options.captureAppearance();
				paint();
			} );
			pickers.appendChild( useNow );

			const walls = el( 'os-swatch-grid', `${ ROOT_CLASS }__wallpapers` );
			walls.setAttribute( 'label', __( 'Wallpaper' ) );
			// Six across, not four: the modal is narrower than the
			// Preferences panel, and a wallpaper tile here is a
			// swatch to recognise, not a preview to study.
			walls.setAttribute( 'columns', '6' );
			for ( const w of options.wallpapers ) {
				const sw = el( 'os-swatch' );
				sw.setAttribute( 'value', w.id );
				sw.setAttribute( 'label', w.label );
				sw.setAttribute( 'variant', 'wallpaper' );
				sw.setAttribute( 'preview', w.preview );
				// What the preview manager keys on.
				sw.dataset.wallpaperId = w.id;
				if ( a.wallpaper === w.id ) {
					sw.setAttribute( 'selected', '' );
				}
				// The name, on the tile — a swatch of a gradient says
				// nothing about which gradient it is. Same caption the
				// Preferences grid paints.
				const name = el( 'span', `${ ROOT_CLASS }__swatch-label` );
				name.textContent = w.label;
				sw.appendChild( name );
				sw.addEventListener( 'os-pick', () => {
					draft.appearance = { ...draft.appearance, wallpaper: w.id };
					paint();
				} );
				walls.appendChild( sw );
			}
			pickers.appendChild( labelled( __( 'Wallpaper' ), walls ) );
			// A canvas wallpaper (the living tree, the snow) renders its
			// own moving preview into the tile, exactly as it does in
			// Preferences; a CSS one keeps its `preview` background.
			// Same manager, same cap on live contexts.
			previews ??= createWallpaperPreviewManager( pickers );
			previews.sync();

			const accents = el( 'os-swatch-grid', `${ ROOT_CLASS }__accents` );
			accents.setAttribute( 'label', __( 'Accent' ) );
			accents.setAttribute( 'mode', 'row' );
			for ( const c of options.accents ) {
				const sw = el( 'os-swatch' );
				sw.setAttribute( 'value', c.id );
				sw.setAttribute( 'label', c.label );
				sw.setAttribute( 'size', 'small' );
				sw.setAttribute( 'variant', 'accent' );
				sw.setAttribute( 'preview', c.value );
				if ( a.accent === c.id ) {
					sw.setAttribute( 'selected', '' );
				}
				sw.addEventListener( 'os-pick', () => {
					draft.appearance = { ...draft.appearance, accent: c.id };
					paint();
				} );
				accents.appendChild( sw );
			}
			pickers.appendChild( labelled( __( 'Accent' ), accents ) );

			const dock = el( 'os-segmented' );
			dock.setAttribute( 'label', __( 'Dock' ) );
			for ( const [ id, text ] of [
				[ 'static', __( 'Always visible' ) ],
				[ 'dynamic', __( 'Folds away until reached for' ) ],
			] ) {
				const seg = el( 'os-segment' );
				seg.setAttribute( 'value', id );
				seg.textContent = text;
				dock.appendChild( seg );
			}
			dock.setAttribute( 'value', String( a.dockBehavior ?? 'static' ) );
			dock.addEventListener( 'os-pick', ( e: Event ) => {
				draft.appearance = {
					...draft.appearance,
					dockBehavior: ( e as CustomEvent< { value: string } > ).detail
						.value,
				};
			} );
			pickers.appendChild( labelled( __( 'Dock' ), dock ) );
		};
		toggle.addEventListener( 'os-switch-change', ( e: Event ) => {
			const on = ( e as CustomEvent< { checked: boolean } > ).detail.checked;
			if ( ! on ) {
				draft.appearance = {};
			} else if ( ! own() ) {
				// On with nothing stored yet starts from what is on
				// screen, the only start that does not change the desk
				// out from under the user at the moment they flip it.
				draft.appearance = options.captureAppearance();
			}
			paint();
		} );
		paint();
		pane.appendChild( pickers );
	};

	/** Launch list and arrangement. */
	const renderWindows = (): void => {
		pane.appendChild(
			heading(
				__( 'What does it open with?' ),
				__( 'The windows this desk opens the first time you enter it, and how they are arranged.' ),
			),
		);

		const layout = el( 'os-segmented' );
		layout.setAttribute( 'label', __( 'Arrangement' ) );
		for ( const id of WORKSPACE_LAYOUTS ) {
			const seg = el( 'os-segment' );
			seg.setAttribute( 'value', id );
			seg.textContent = layoutLabel( id );
			layout.appendChild( seg );
		}
		layout.setAttribute( 'value', draft.layout );
		const layoutHintEl = hint( layoutHint( draft.layout ) );
		layout.addEventListener( 'os-pick', ( e: Event ) => {
			draft.layout = ( e as CustomEvent< { value: string } > ).detail
				.value as WorkspaceLayoutId;
			layoutHintEl.textContent = layoutHint( draft.layout );
		} );
		const layoutField = labelled( __( 'Arrangement' ), layout );
		layoutField.appendChild( layoutHintEl );
		pane.appendChild( layoutField );

		const chips = el( 'div', `${ ROOT_CLASS }__chips` );
		const paintChips = (): void => {
			chips.replaceChildren();
			if ( draft.windows.length === 0 ) {
				chips.appendChild(
					hint( __( 'Nothing yet — add an app below, or capture the windows you have open.' ) ),
				);
				return;
			}
			draft.windows.forEach( ( w, i ) => {
				const chip = el( 'os-chip' );
				chip.setAttribute( 'label', w.title || w.match );
				chip.setAttribute( 'dismissible', '' );
				chip.addEventListener( 'os-chip-dismiss', () => {
					draft.windows = draft.windows.filter( ( _, j ) => j !== i );
					paintChips();
				} );
				chips.appendChild( chip );
			} );
		};
		paintChips();
		pane.appendChild( labelled( __( 'Opens with' ), chips ) );

		// Add a window: every app that opens something, as a picker.
		// Picking one appends it and the picker goes back to its
		// placeholder, so adding three is three picks, not three picks
		// and three resets.
		const openable = options.apps.filter( ( a ) => a.url || a.windowId );
		if ( openable.length > 0 ) {
			const add = el( 'os-select' );
			add.setAttribute( 'label', __( 'Add a window' ) );
			add.setAttribute( 'placeholder', __( 'Choose an app…' ) );
			for ( const app of openable ) {
				const opt = el( 'os-option' );
				opt.setAttribute( 'value', app.id );
				opt.textContent = app.title;
				add.appendChild( opt );
			}
			add.addEventListener( 'os-pick', ( e: Event ) => {
				const id = ( e as CustomEvent< { value: string } > ).detail.value;
				const app = openable.find( ( a ) => a.id === id );
				if ( ! app ) {
					return;
				}
				// `match` is the app's own id: a list built here is
				// about THIS install, so an id is the exact answer. A
				// native window carries no url and reopens through the
				// registry.
				const entry: WorkspaceLaunch = { match: app.id, title: app.title };
				if ( app.url ) {
					entry.url = app.url;
				}
				draft.windows = [ ...draft.windows, entry ];
				// The user added a window they want opened; the desk has
				// something new to provision on the next entry.
				draft.provisioned = false;
				paintChips();
				add.removeAttribute( 'value' );
			} );
			pane.appendChild( add );
		}

		if ( options.captureWindows ) {
			const actions = el( 'div', `${ ROOT_CLASS }__actions` );
			const capture = el( 'os-button' );
			capture.setAttribute( 'variant', 'ghost' );
			capture.textContent = __( 'Use the windows I have open now' );
			capture.addEventListener( 'click', () => {
				draft.windows = options.captureWindows?.() ?? [];
				// Those windows are already on screen; marking the list
				// run stops the desk opening a second copy of everything
				// on the next entry.
				draft.provisioned = true;
				paintChips();
			} );
			actions.appendChild( capture );
			pane.appendChild( actions );
		}
		// No "Open them now" or "Arrange now" here: both act on the desk
		// BEHIND a modal, where the result is invisible until the modal
		// closes and looks, from inside it, like a button that does
		// nothing. Restore under the tile is that action, done where it
		// can be seen.
	};

	const RENDER: Record< StepId, () => void > = {
		start: renderStart,
		name: renderName,
		apps: renderApps,
		widgets: renderWidgets,
		look: renderLook,
		windows: renderWindows,
	};

	// --- Footer ---------------------------------------------------
	let primary: HTMLElement | null = null;

	const renderFooter = (): void => {
		footer.replaceChildren();
		const current = steps[ stepIndex ];
		const onStart = 'start' === current;
		const last = stepIndex === steps.length - 1;

		if ( isEdit && options.onDelete ) {
			const del = el( 'os-button' );
			del.setAttribute( 'variant', 'danger' );
			del.textContent = __( 'Delete workspace' );
			del.addEventListener( 'click', () => {
				options.onDelete?.();
				closeWorkspaceWizard();
			} );
			footer.appendChild( del );
		}

		const spacer = el( 'span', `${ ROOT_CLASS }__spacer` );
		footer.appendChild( spacer );

		const cancel = el( 'os-button' );
		cancel.setAttribute( 'variant', 'secondary' );
		cancel.textContent = __( 'Cancel' );
		cancel.addEventListener( 'click', closeWorkspaceWizard );
		footer.appendChild( cancel );

		if ( stepIndex > 0 ) {
			const back = el( 'os-button' );
			back.setAttribute( 'variant', 'secondary' );
			back.textContent = __( 'Back' );
			back.addEventListener( 'click', () => go( stepIndex - 1 ) );
			footer.appendChild( back );
		}

		// Create / Save is on EVERY step. It is the escape hatch: the
		// wizard can be left at any point with whatever has been set.
		primary = el( 'os-button' );
		primary.setAttribute( 'variant', 'primary' );
		if ( isEdit ) {
			primary.textContent = __( 'Save' );
		} else if ( onStart && start === BLANK ) {
			primary.textContent = __( 'Create desktop' );
		} else if ( onStart ) {
			primary.textContent = __( 'Create from template' );
		} else {
			primary.textContent = __( 'Create workspace' );
		}
		primary.addEventListener( 'click', commit );
		footer.appendChild( primary );

		if ( ! last ) {
			const next = el( 'os-button' );
			next.setAttribute( 'variant', 'secondary' );
			next.textContent = onStart ? __( 'Customize' ) : __( 'Next' );
			next.addEventListener( 'click', () => go( stepIndex + 1 ) );
			footer.appendChild( next );
		}
	};

	// --- Navigation -----------------------------------------------
	const go = ( index: number ): void => {
		const leaving = steps[ stepIndex ];
		// Crossing out of Start reads the chosen template into the
		// draft — once. From here on the desk is the user's, and going
		// back to Start and forward again must not wipe their edits.
		if ( 'start' === leaving && index > 0 && ! customized ) {
			customized = true;
			if ( start !== BLANK ) {
				const preset = options.presets.find( ( p ) => p.id === start );
				if ( preset ) {
					draft = cloneProfile( options.resolvePreset( preset ) );
					if ( ! label ) {
						label = preset.defaultLabel ?? preset.label;
					}
				}
			}
		}
		stepIndex = Math.max( 0, Math.min( steps.length - 1, index ) );
		// Whatever the previous step mounted is gone with its DOM; the
		// preview manager is told, so its WebGL contexts go too.
		disposePreviews();
		pane.replaceChildren();
		RENDER[ steps[ stepIndex ] ]();
		renderTrail();
		renderFooter();
	};

	modal.addEventListener( 'os-modal-cancel', closeWorkspaceWizard );

	document.body.appendChild( modal );
	active = modal;
	activeCleanup = disposePreviews;
	go( 0 );

	// The primary action takes focus on open: `+` then Enter is a
	// blank desktop, and a user who has not read the dialog gets the
	// thing they most likely wanted. The modal's own focus trap
	// would otherwise land on the first card, which is the same
	// choice one keystroke further away.
	if ( ! isEdit ) {
		requestAnimationFrame( () =>
			( primary?.shadowRoot?.querySelector( 'button' ) ?? primary )?.focus(),
		);
	}
}
