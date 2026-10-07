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

import {
	createWallpaperPreviewManager,
	type WallpaperPreviewManager,
} from '../wallpapers/preview-manager';
import type { NavKind } from '../nav/types';
import type {
	WorkspaceAppearance,
	WorkspaceLaunch,
	WorkspaceLayoutId,
	WorkspacePreset,
	WorkspaceProfile,
} from './types';
import { blankWorkspaceProfile, WORKSPACE_LAYOUTS } from './types';

export interface WorkspaceWizardApp {
	id: string;
	title: string;
	kind: NavKind;
	locked?: boolean;

	url?: string;

	windowId?: string;
}

export interface WorkspaceWizardWidget {
	id: string;
	label: string;
	description?: string;
}

export interface WorkspaceWizardWallpaper {
	id: string;
	label: string;
	preview: string;
}

export interface WorkspaceWizardAccent {
	id: string;
	label: string;
	value: string;
}

export interface WorkspaceWizardResult {
	label: string;

	profile: WorkspaceProfile | null;

	preset?: string;
}

export interface WorkspaceWizardOptions {
	mode: 'create' | 'edit';

	desktopId?: string;

	label?: string;

	profile?: WorkspaceProfile;
	presets: WorkspacePreset[];
	apps: WorkspaceWizardApp[];
	widgets: WorkspaceWizardWidget[];

	enabledWidgetIds: string[];
	wallpapers: WorkspaceWizardWallpaper[];
	accents: WorkspaceWizardAccent[];

	resolvePreset: ( preset: WorkspacePreset ) => WorkspaceProfile;

	captureAppearance: () => WorkspaceAppearance;

	captureWindows?: () => WorkspaceLaunch[];

	onCreate?: ( result: WorkspaceWizardResult ) => void;

	onSave?: ( result: WorkspaceWizardResult ) => void;

	onDelete?: () => void;
}

const ROOT_CLASS = 'os-workspace-wizard';

const BLANK = 'blank';

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

let activeCleanup: ( () => void ) | null = null;

export function closeWorkspaceWizard(): void {
	activeCleanup?.();
	activeCleanup = null;
	active?.remove();
	active = null;
}

export function openWorkspaceWizard( options: WorkspaceWizardOptions ): void {
	closeWorkspaceWizard();

	const isEdit = 'edit' === options.mode;
	const steps: StepId[] = isEdit
		? [ 'name', 'apps', 'widgets', 'look', 'windows' ]
		: [ 'start', 'name', 'apps', 'widgets', 'look', 'windows' ];

	let label = options.label ?? '';
	let draft = cloneProfile( options.profile ?? blankWorkspaceProfile() );

	let start = BLANK;

	let customized = isEdit;
	let stepIndex = 0;

	let previews: WallpaperPreviewManager | null = null;
	const disposePreviews = (): void => {
		previews?.dispose();
		previews = null;
	};

	const modal = el( 'os-modal', ROOT_CLASS );
	modal.setAttribute( 'size', 'lg' );
	modal.setAttribute(
		'title',
		isEdit ? __( 'Edit workspace' ) : __( 'New workspace' ),
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

			if ( i !== stepIndex ) {
				step.setAttribute( 'interactive', '' );
				step.addEventListener( 'os-step-click', () => go( i ) );
			}
			trail.appendChild( step );
		} );
	};

	const renderStart = (): void => {
		pane.appendChild( heading( __( 'What is this workspace for?' ) ) );
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
		): void => {
			const card = el( 'os-card', `${ ROOT_CLASS }__card` );
			card.setAttribute( 'interactive', '' );
			card.setAttribute( 'compact', '' );

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
			__( 'Blank workspace' ),
			__( 'Just a new, empty desk. You can customize it later if you want.' ),
		);
		for ( const preset of options.presets ) {
			addCard( preset.id, preset.icon, preset.label, preset.description );
		}
		paintSelected();
		pane.appendChild( grid );
	};

	const renderName = (): void => {
		pane.appendChild(
			heading(
				__( 'Name it' ),
				__( 'The name goes on its tile in Workspaces. The glyph and colour are how you tell it apart from the others at a glance.' ),
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

		const icons = el( 'os-swatch-grid', `${ ROOT_CLASS }__icons` );
		icons.setAttribute( 'label', __( 'Glyph' ) );
		icons.setAttribute( 'mode', 'row' );
		for ( const icon of ICONS ) {
			const sw = el( 'os-swatch', `${ ROOT_CLASS }__icon-swatch` );
			sw.setAttribute( 'value', icon.id );
			sw.setAttribute( 'label', icon.label );
			sw.setAttribute( 'size', 'small' );

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
			note: __( 'OpenStation’s own controls — Workspaces, System, Trash, Exit — always stay, so a desk can never be one you cannot leave.' ),
			isOn: () => 'only' === draft.apps.mode,
			setOn: ( on ) => {
				draft.apps.mode = on ? 'only' : 'all';

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

			walls.setAttribute( 'columns', '6' );
			for ( const w of options.wallpapers ) {
				const sw = el( 'os-swatch' );
				sw.setAttribute( 'value', w.id );
				sw.setAttribute( 'label', w.label );
				sw.setAttribute( 'variant', 'wallpaper' );
				sw.setAttribute( 'preview', w.preview );

				sw.dataset.wallpaperId = w.id;
				if ( a.wallpaper === w.id ) {
					sw.setAttribute( 'selected', '' );
				}

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
				draft.appearance = options.captureAppearance();
			}
			paint();
		} );
		paint();
		pane.appendChild( pickers );
	};

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
					hint(
						options.captureWindows
							? __( 'Nothing yet — add an app below, or capture the windows you have open.' )
							: __( 'Nothing yet — add an app below.' ),
					),
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

				const entry: WorkspaceLaunch = { match: app.id, title: app.title };
				if ( app.url ) {
					entry.url = app.url;
				}
				draft.windows = [ ...draft.windows, entry ];

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

				draft.provisioned = true;
				paintChips();
			} );
			actions.appendChild( capture );
			pane.appendChild( actions );
		}
	};

	const RENDER: Record< StepId, () => void > = {
		start: renderStart,
		name: renderName,
		apps: renderApps,
		widgets: renderWidgets,
		look: renderLook,
		windows: renderWindows,
	};

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

		if ( ! last ) {
			const next = el( 'os-button' );
			next.setAttribute( 'variant', 'secondary' );
			next.textContent = onStart ? __( 'Customize' ) : __( 'Next' );
			next.addEventListener( 'click', () => go( stepIndex + 1 ) );
			footer.appendChild( next );
		}

		primary = el( 'os-button' );
		primary.setAttribute( 'variant', 'primary' );
		if ( isEdit ) {
			primary.textContent = __( 'Save' );
		} else if ( onStart && start !== BLANK ) {
			primary.textContent = __( 'Create from template' );
		} else {
			primary.textContent = __( 'Create workspace' );
		}
		primary.addEventListener( 'click', commit );
		footer.appendChild( primary );
	};

	const go = ( index: number ): void => {
		const leaving = steps[ stepIndex ];

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

	if ( ! isEdit ) {
		requestAnimationFrame( () =>
			( primary?.shadowRoot?.querySelector( 'button' ) ?? primary )?.focus(),
		);
	}
}
