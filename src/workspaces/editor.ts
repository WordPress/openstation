/**
 * The workspace editor — one modal, four decisions.
 *
 * Name, layout, which apps show, and what the desk opens with. That is
 * the whole of {@link import('./types').WorkspaceProfile}, and the
 * editor is deliberately a flat form over it rather than a wizard: a
 * workspace is a thing you adjust twenty times, not a thing you set up
 * once.
 *
 * ## It takes data, not the shell
 *
 * Every input arrives through {@link WorkspaceEditorOptions} and every
 * output leaves through `onSave`. The editor never imports the window
 * manager, the navigation, or the settings store — which is what lets
 * it live in its own lazy bundle without any of the cross-bundle
 * module-state hazards that come with reaching for a singleton (see
 * `docs/examples/shared-store.md` for the general shape of that trap).
 *
 * ## The apps list
 *
 * Controls are in the list but permanently checked and disabled, with
 * a line saying why. Hiding them is refused structurally in
 * `visibility.ts`; showing them here as simply absent would leave the
 * user hunting for the Trash they cannot find a switch for.
 */

// Component classes, imported for their side-effect registration.
// This module only ever ships inside the lazy editor bundle, so the
// weight never reaches `desktop.min.js`.
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-button/os-button';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-select/os-select';
import '../ui/components/os-checkbox/os-checkbox';
import '../ui/components/os-switch/os-switch';

import { __, sprintf } from '../i18n';
import type { NavKind } from '../nav/types';
import type {
	WorkspaceAppearance,
	WorkspaceLayoutId,
	WorkspacePreset,
	WorkspaceProfile,
} from './types';
import { WORKSPACE_LAYOUTS } from './types';

/** One row in the apps checklist. */
export interface WorkspaceEditorApp {
	id: string;
	title: string;
	kind: NavKind;
	locked?: boolean;
}

export interface WorkspaceEditorOptions {
	desktopId: string;
	label: string;
	profile: WorkspaceProfile;
	apps: WorkspaceEditorApp[];
	/** Every registered widget, for the column checklist. */
	widgets: Array< { id: string; label: string } >;
	/**
	 * The user's own widget column — the starting point when the
	 * workspace takes one over.
	 */
	enabledWidgetIds: string[];
	presets: WorkspacePreset[];
	/** Commit. Called once, with the whole result. */
	onSave: ( next: { label: string; profile: WorkspaceProfile } ) => void;
	/** Re-run the arrangement now, without closing. */
	onApplyLayout?: ( layout: WorkspaceLayoutId ) => void;
	/**
	 * The windows open on this desk right now, as a launch list.
	 * Backs "Open with the windows I have now" — the desktop-OS
	 * gesture of saving an arrangement you arrived at by working.
	 */
	onCaptureWindows?: () => WorkspaceProfile[ 'windows' ];
	/** Open the launch list now, even though it has already run. */
	onOpenWindows?: () => void;
	/**
	 * The shell's current appearance, as a workspace patch. Backs "Use
	 * the look I have now" — a workspace's look is picked in
	 * Preferences, on the desk, seeing it, and captured from there.
	 */
	onCaptureAppearance?: () => WorkspaceAppearance;
	/** Delete the desktop. Omitted when it is the last one. */
	onDelete?: () => void;
}

const ROOT_CLASS = 'os-workspace-editor';

/** Human labels for the layout picker. */
function layoutLabel( id: WorkspaceLayoutId ): string {
	switch ( id ) {
		case 'cascade':
			return __( 'Cascade — staggered, same size' );
		case 'tile':
			return __( 'Tile — a uniform grid' );
		case 'columns':
			return __( 'Columns — full height, side by side' );
		case 'focus':
			return __( 'Focus — one leading, the rest in the margin' );
		case 'free':
		default:
			return __( 'Free — nothing is moved' );
	}
}

/** Human name for an appearance key, for the "This desk sets:" line. */
function appearanceLabel( key: string ): string {
	switch ( key ) {
		case 'wallpaper':
		case 'wallpaperSettings':
		case 'customGradient':
		case 'customImage':
			return __( 'wallpaper' );
		case 'accent':
		case 'customAccent':
			return __( 'accent' );
		case 'desktopTheme':
			return __( 'theme' );
		case 'desktopLayout':
		case 'dockPlacement':
		case 'dockSize':
		case 'dockBehavior':
		case 'sideDockBehavior':
			return __( 'dock' );
		case 'windowRadius':
		case 'windowReveal':
		case 'unfocusEffect':
			return __( 'windows' );
		case 'adminBarMode':
			return __( 'admin bar' );
		default:
			return key;
	}
}

let active: HTMLElement | null = null;

/** Close the open editor, if any. */
export function closeWorkspaceEditor(): void {
	active?.remove();
	active = null;
}

/**
 * Open the editor.
 *
 * Edits a working copy and commits it in one write on Save, so
 * Cancel — and the Escape key, and a click on the scrim — genuinely
 * discard. A form that wrote through on every keystroke would have no
 * Cancel to offer.
 */
export function openWorkspaceEditor( options: WorkspaceEditorOptions ): void {
	closeWorkspaceEditor();

	let label = options.label;
	// Deep enough: `apps.ids` is the only nested array the form writes.
	const sourceWidgets = options.profile.widgets;
	const draft: WorkspaceProfile = {
		...options.profile,
		apps: { ...options.profile.apps, ids: [ ...options.profile.apps.ids ] },
		widgets: {
			mode: sourceWidgets?.mode ?? 'all',
			ids: [ ...( sourceWidgets?.ids ?? [] ) ],
		},
		appearance: { ...( options.profile.appearance ?? {} ) },
		windows: options.profile.windows.map( ( w ) => ( { ...w } ) ),
	};

	const modal = document.createElement( 'os-modal' );
	modal.className = ROOT_CLASS;
	modal.setAttribute( 'size', 'lg' );
	modal.setAttribute( 'title', __( 'Workspace' ) );
	modal.setAttribute( 'open', '' );

	const body = document.createElement( 'div' );
	body.className = `${ ROOT_CLASS }__body`;
	modal.appendChild( body );

	// --- Name -----------------------------------------------------
	const nameField = document.createElement( 'os-text-field' );
	nameField.setAttribute( 'label', __( 'Name' ) );
	nameField.setAttribute( 'value', label );
	nameField.addEventListener( 'os-input-change', ( e: Event ) => {
		label = ( e as CustomEvent< { value: string } > ).detail.value;
	} );
	body.appendChild( nameField );

	// --- Layout ---------------------------------------------------
	const layoutSelect = document.createElement( 'os-select' );
	layoutSelect.setAttribute( 'label', __( 'Layout' ) );
	for ( const id of WORKSPACE_LAYOUTS ) {
		const opt = document.createElement( 'os-option' );
		opt.setAttribute( 'value', id );
		opt.textContent = layoutLabel( id );
		layoutSelect.appendChild( opt );
	}
	layoutSelect.setAttribute( 'value', draft.layout );
	layoutSelect.addEventListener( 'os-pick', ( e: Event ) => {
		draft.layout = ( e as CustomEvent< { value: string } > ).detail
			.value as WorkspaceLayoutId;
	} );
	body.appendChild( layoutSelect );

	if ( options.onApplyLayout ) {
		const applyNow = document.createElement( 'os-button' );
		applyNow.setAttribute( 'variant', 'ghost' );
		applyNow.textContent = __( 'Arrange the windows now' );
		applyNow.addEventListener( 'click', () => {
			options.onApplyLayout?.( draft.layout );
		} );
		body.appendChild( applyNow );
	}

	// --- Apps -----------------------------------------------------
	const appsSection = document.createElement( 'div' );
	appsSection.className = `${ ROOT_CLASS }__apps`;

	const onlyToggle = document.createElement( 'os-switch' );
	onlyToggle.setAttribute( 'label', __( 'Show only the apps I pick' ) );
	if ( 'only' === draft.apps.mode ) {
		onlyToggle.setAttribute( 'checked', '' );
	}
	appsSection.appendChild( onlyToggle );

	const hint = document.createElement( 'p' );
	hint.className = `${ ROOT_CLASS }__hint`;
	hint.textContent = __(
		'OpenStation’s own controls — Overview, System, Trash, Exit — always stay, so a workspace can never be one you cannot leave.',
	);
	appsSection.appendChild( hint );

	const list = document.createElement( 'div' );
	list.className = `${ ROOT_CLASS }__app-list`;
	appsSection.appendChild( list );

	const renderApps = (): void => {
		const only = 'only' === draft.apps.mode;
		list.replaceChildren();
		list.hidden = ! only;
		if ( ! only ) {
			return;
		}
		const picked = new Set( draft.apps.ids );
		for ( const app of options.apps ) {
			const forced = 'control' === app.kind || !! app.locked;
			const row = document.createElement( 'os-checkbox' );
			row.setAttribute( 'block', '' );
			row.setAttribute( 'value', app.id );
			row.setAttribute( 'label', app.title );
			if ( forced || picked.has( app.id ) ) {
				row.setAttribute( 'checked', '' );
			}
			if ( forced ) {
				row.setAttribute( 'disabled', '' );
			} else {
				row.addEventListener( 'os-checkbox-change', ( e: Event ) => {
					const on = ( e as CustomEvent< { checked: boolean } > )
						.detail.checked;
					// Filtered on both branches: turning one back on
					// must not append a second copy of an id already in
					// the list.
					const without = draft.apps.ids.filter(
						( id ) => id !== app.id,
					);
					draft.apps.ids = on ? [ ...without, app.id ] : without;
				} );
			}
			list.appendChild( row );
		}
	};

	onlyToggle.addEventListener( 'os-switch-change', ( e: Event ) => {
		const on = ( e as CustomEvent< { checked: boolean } > ).detail.checked;
		draft.apps.mode = on ? 'only' : 'all';
		// Turning narrowing on for the first time starts from what is
		// on screen right now rather than from nothing: an empty list
		// would blank the rails the instant the switch was flipped, and
		// the user would be rebuilding their desk to get back to where
		// they started.
		if ( on && draft.apps.ids.length === 0 ) {
			draft.apps.ids = options.apps
				.filter( ( app ) => 'control' !== app.kind && ! app.locked )
				.map( ( app ) => app.id );
		}
		renderApps();
	} );
	renderApps();
	body.appendChild( appsSection );

	// --- Widgets --------------------------------------------------
	// Same two-part shape as the apps list — a mode switch plus a
	// checklist — because it is the same decision in a different
	// register: what belongs on this desk.
	if ( options.widgets.length > 0 ) {
		const widgetsSection = document.createElement( 'div' );
		widgetsSection.className = `${ ROOT_CLASS }__apps`;

		const widgetToggle = document.createElement( 'os-switch' );
		widgetToggle.setAttribute(
			'label',
			__( 'Give this workspace its own widgets' ),
		);
		if ( 'only' === draft.widgets?.mode ) {
			widgetToggle.setAttribute( 'checked', '' );
		}
		widgetsSection.appendChild( widgetToggle );

		const widgetHint = document.createElement( 'p' );
		widgetHint.className = `${ ROOT_CLASS }__hint`;
		widgetHint.textContent = __(
			'Off, this desk shows the widget column you built. On, it shows exactly these — and your own column comes back the moment you leave.',
		);
		widgetsSection.appendChild( widgetHint );

		const widgetList = document.createElement( 'div' );
		widgetList.className = `${ ROOT_CLASS }__app-list`;
		widgetsSection.appendChild( widgetList );

		const renderWidgets = (): void => {
			const only = 'only' === draft.widgets?.mode;
			widgetList.replaceChildren();
			widgetList.hidden = ! only;
			if ( ! only ) {
				return;
			}
			const picked = new Set( draft.widgets?.ids ?? [] );
			for ( const widget of options.widgets ) {
				const row = document.createElement( 'os-checkbox' );
				row.setAttribute( 'block', '' );
				row.setAttribute( 'value', widget.id );
				row.setAttribute( 'label', widget.label );
				if ( picked.has( widget.id ) ) {
					row.setAttribute( 'checked', '' );
				}
				row.addEventListener( 'os-checkbox-change', ( e: Event ) => {
					const on = ( e as CustomEvent< { checked: boolean } > )
						.detail.checked;
					const without = ( draft.widgets?.ids ?? [] ).filter(
						( id ) => id !== widget.id,
					);
					draft.widgets = {
						mode: 'only',
						ids: on ? [ ...without, widget.id ] : without,
					};
				} );
				widgetList.appendChild( row );
			}
		};

		widgetToggle.addEventListener( 'os-switch-change', ( e: Event ) => {
			const on = ( e as CustomEvent< { checked: boolean } > ).detail
				.checked;
			// Turning it on starts from the column the user already
			// has, not from nothing: an empty list would blank the
			// widgets in front of them the instant the switch flipped.
			const ids =
				on && ( draft.widgets?.ids.length ?? 0 ) === 0
					? options.enabledWidgetIds.slice()
					: draft.widgets?.ids ?? [];
			draft.widgets = { mode: on ? 'only' : 'all', ids };
			renderWidgets();
		} );
		renderWidgets();
		body.appendChild( widgetsSection );
	}

	// --- Appearance -----------------------------------------------
	// One switch and one button, not a second Preferences panel. A
	// workspace's look is picked the way every look is picked — in
	// Preferences, on the desk, seeing it — and captured from there.
	// Rebuilding the wallpaper picker, the accent grid and the theme
	// library inside a modal would be a worse copy of a surface that
	// already exists.
	if ( options.onCaptureAppearance ) {
		const lookSection = document.createElement( 'div' );
		lookSection.className = `${ ROOT_CLASS }__apps`;

		const lookToggle = document.createElement( 'os-switch' );
		lookToggle.setAttribute( 'label', __( 'Give this workspace its own look' ) );
		if ( Object.keys( draft.appearance ?? {} ).length > 0 ) {
			lookToggle.setAttribute( 'checked', '' );
		}
		lookSection.appendChild( lookToggle );

		const lookHint = document.createElement( 'p' );
		lookHint.className = `${ ROOT_CLASS }__hint`;
		const renderLook = (): void => {
			// Deduped: four wallpaper-ish keys are one thing the user
			// changed, and "wallpaper, wallpaper, wallpaper" reads as a
			// bug rather than as detail.
			const names = [
				...new Set(
					Object.keys( draft.appearance ?? {} ).map(
						appearanceLabel,
					),
				),
			];
			if ( names.length === 0 ) {
				lookHint.textContent = __(
					'Off, this desk looks the way you set the shell up. On, it keeps the wallpaper, accent, theme and dock you give it — and yours come back when you leave.',
				);
				return;
			}
			lookHint.textContent = sprintf(
				// translators: %s is a comma-separated list of setting names.
				__(
					'This desk sets: %s. Your own settings come back when you leave it.',
				),
				names.join( ', ' ),
			);
		};
		renderLook();
		lookSection.appendChild( lookHint );

		const lookActions = document.createElement( 'div' );
		lookActions.className = `${ ROOT_CLASS }__opens-actions`;
		const capture = document.createElement( 'os-button' );
		capture.setAttribute( 'variant', 'ghost' );
		capture.textContent = __( 'Use the look I have now' );
		capture.addEventListener( 'click', () => {
			draft.appearance = options.onCaptureAppearance?.() ?? {};
			lookToggle.setAttribute( 'checked', '' );
			renderLook();
		} );
		lookActions.appendChild( capture );
		lookSection.appendChild( lookActions );

		lookToggle.addEventListener( 'os-switch-change', ( e: Event ) => {
			const on = ( e as CustomEvent< { checked: boolean } > ).detail
				.checked;
			if ( ! on ) {
				draft.appearance = {};
				renderLook();
				return;
			}
			// On with nothing stored yet starts from what is on screen,
			// which is the only starting point that does not change the
			// desk out from under the user at the moment they flip it.
			if ( Object.keys( draft.appearance ?? {} ).length === 0 ) {
				draft.appearance = options.onCaptureAppearance?.() ?? {};
			}
			renderLook();
		} );
		body.appendChild( lookSection );
	}

	// --- Opens with -----------------------------------------------
	const opensSection = document.createElement( 'div' );
	opensSection.className = `${ ROOT_CLASS }__opens`;

	const opens = document.createElement( 'p' );
	opens.className = `${ ROOT_CLASS }__hint`;
	const renderOpens = (): void => {
		if ( draft.windows.length === 0 ) {
			opens.textContent = __(
				'Opens with nothing — this desk starts empty.',
			);
			return;
		}
		const names = draft.windows
			.map( ( w ) => w.title || w.match )
			.join( ', ' );
		// translators: %s is a comma-separated list of app names.
		opens.textContent = sprintf( __( 'Opens with: %s' ), names );
	};
	renderOpens();
	opensSection.appendChild( opens );

	const opensActions = document.createElement( 'div' );
	opensActions.className = `${ ROOT_CLASS }__opens-actions`;

	if ( options.onCaptureWindows ) {
		const capture = document.createElement( 'os-button' );
		capture.setAttribute( 'variant', 'ghost' );
		capture.textContent = __( 'Use the windows I have open now' );
		capture.addEventListener( 'click', () => {
			draft.windows = options.onCaptureWindows?.() ?? [];
			// The captured windows are already on screen, so the launch
			// list has nothing left to do on the next entry. Marking it
			// run is what stops the workspace opening a second copy of
			// everything the moment the user switches away and back.
			draft.provisioned = true;
			renderOpens();
		} );
		opensActions.appendChild( capture );
	}

	if ( options.onOpenWindows ) {
		const reopen = document.createElement( 'os-button' );
		reopen.setAttribute( 'variant', 'ghost' );
		reopen.textContent = __( 'Open them now' );
		reopen.addEventListener( 'click', () => options.onOpenWindows?.() );
		opensActions.appendChild( reopen );
	}

	if ( opensActions.childElementCount > 0 ) {
		opensSection.appendChild( opensActions );
	}
	body.appendChild( opensSection );

	if ( draft.preset ) {
		const from = options.presets.find( ( p ) => p.id === draft.preset );
		if ( from ) {
			const provenance = document.createElement( 'p' );
			provenance.className = `${ ROOT_CLASS }__hint`;
			provenance.textContent = sprintf(
				// translators: %s is a workspace template name.
				__( 'Created from the %s template.' ),
				from.label,
			);
			body.appendChild( provenance );
		}
	}

	// --- Footer ---------------------------------------------------
	const footer = document.createElement( 'div' );
	footer.slot = 'footer';
	footer.className = `${ ROOT_CLASS }__footer`;

	if ( options.onDelete ) {
		const del = document.createElement( 'os-button' );
		del.setAttribute( 'variant', 'danger' );
		del.textContent = __( 'Delete workspace' );
		del.addEventListener( 'click', () => {
			options.onDelete?.();
			closeWorkspaceEditor();
		} );
		footer.appendChild( del );
	}

	const cancel = document.createElement( 'os-button' );
	cancel.setAttribute( 'variant', 'secondary' );
	cancel.textContent = __( 'Cancel' );
	cancel.addEventListener( 'click', closeWorkspaceEditor );
	footer.appendChild( cancel );

	const save = document.createElement( 'os-button' );
	save.setAttribute( 'variant', 'primary' );
	save.textContent = __( 'Save' );
	save.addEventListener( 'click', () => {
		options.onSave( { label, profile: draft } );
		closeWorkspaceEditor();
	} );
	footer.appendChild( save );
	modal.appendChild( footer );

	modal.addEventListener( 'os-modal-cancel', closeWorkspaceEditor );

	document.body.appendChild( modal );
	active = modal;
}
