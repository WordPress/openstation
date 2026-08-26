/**
 * OpenStation — "New folder" inline dialog.
 *
 * Replaces the placeholder `window.prompt` from the wallpaper
 * context menu's "Create folder" item. Mounts a small modal
 * with a focused text input, Cancel / Create buttons, Enter to
 * submit, Escape to cancel. The modal is rendered into a
 * top-level overlay that traps clicks and dims the rest of
 * the desktop with a backdrop.
 *
 * The overlay + surface are vanilla DOM; the controls inside it are
 * `<os-text-field>` and `<os-button>`, same as the sibling
 * `url-dialog`. That is not a stylistic preference — a raw
 * `<input type="text">` in the parent shell is reachable by core's
 * `forms.css`, whose `input[type="text"] { background-color: #fff;
 * color: #1e1e1e }` weighs (0,1,1) and outranks any single class of
 * ours. The rename field came out as a white core-chrome box on the
 * dialog's dark surface, and because the dialog pre-selects the name
 * on open, the selected text was painted by the shell's
 * `::selection` — near-white ink on a pale lavender wash over white,
 * i.e. all but unreadable at the exact moment the user is meant to
 * read it. Shadow DOM ends both problems structurally: core's sheet
 * cannot reach in, and the field resolves the palette instead.
 *
 * Plugins that want a richer affordance can replace it via the
 * `os.files.create-folder.dialog` filter (returns `false` to
 * suppress the built-in dialog and own the flow).
 */

import { applyFilters, doAction } from '../hooks';
// Registered globally by the lazy shell-overlays bundle — see
// src/shell-overlays/entry.ts.
import { focusField, readFieldValue, setControlDisabled } from './dialog-fields';

const ROOT_CLASS = 'os-create-folder-dialog';

export interface CreateFolderDialogOptions {
	/** Initial value of the input. Default `'Untitled folder'`. */
	initialName?: string;
	/** Called with the trimmed name when the user submits. May return a Promise. */
	onSubmit: ( name: string ) => Promise< unknown > | unknown;
	/** Optional cancel callback. */
	onCancel?: () => void;
	/**
	 * Heading copy for the dialog. Defaults to `'New folder'`.
	 * Pass a different string when reusing the dialog for rename
	 * flows so screen readers and the visible heading match.
	 */
	title?: string;
	/**
	 * Label above the input. Defaults to `'Folder name'`.
	 */
	label?: string;
	/**
	 * Primary button copy. Defaults to `'Create'`. Use `'Rename'`
	 * (or any verb that reads correctly with the new title) when
	 * the dialog is acting as a rename modal.
	 */
	submitLabel?: string;
}

let active: HTMLElement | null = null;

/** Whether a dialog is currently mounted. */
export function isCreateFolderDialogOpen(): boolean {
	return active !== null;
}

/** Close the active dialog (no-op when nothing is open). */
export function closeCreateFolderDialog(): void {
	if ( ! active ) {
		return;
	}
	active.dispatchEvent( new CustomEvent( 'create-folder-dialog-closed' ) );
	active.remove();
	active = null;
	doAction( 'os.files.create-folder.closed', {} );
}

/**
 * Open the "New folder" dialog. Resolves when the user has
 * either submitted a name (and `onSubmit` resolved) or cancelled.
 */
export function openCreateFolderDialog( options: CreateFolderDialogOptions ): void {
	closeCreateFolderDialog();

	// Plugins can short-circuit the built-in dialog and own the
	// UX by registering a filter that returns `false`. Any other
	// return value is ignored — the contract is presence-based.
	const decision = applyFilters< unknown, [ CreateFolderDialogOptions ] >(
		'os.files.create-folder.dialog',
		null,
		options,
	);
	if ( decision === false ) {
		return;
	}

	const initial = ( options.initialName ?? 'Untitled folder' ).trim();

	const overlay = document.createElement( 'div' );
	overlay.className = `${ ROOT_CLASS }__overlay`;
	overlay.setAttribute( 'role', 'presentation' );

	const dialog = document.createElement( 'div' );
	dialog.className = ROOT_CLASS;
	dialog.setAttribute( 'role', 'dialog' );
	dialog.setAttribute( 'aria-modal', 'true' );
	dialog.setAttribute( 'aria-labelledby', `${ ROOT_CLASS }-title` );

	const title = document.createElement( 'h2' );
	title.id = `${ ROOT_CLASS }-title`;
	title.className = `${ ROOT_CLASS }__title`;
	title.textContent = options.title ?? 'New folder';
	dialog.appendChild( title );

	// The field carries its own label, so there is no sibling
	// `<label for>` — the component pairs them inside its shadow root.
	const field = document.createElement( 'os-text-field' );
	field.className = `${ ROOT_CLASS }__field`;
	field.id = `${ ROOT_CLASS }-input`;
	field.setAttribute( 'label', options.label ?? 'Folder name' );
	field.setAttribute( 'value', initial );
	field.setAttribute( 'autocomplete', 'off' );
	// `spellcheck` is an inherited content attribute, so declaring it
	// on the host reaches the input inside the shadow root — a folder
	// name is not prose and should not get a red squiggle.
	field.setAttribute( 'spellcheck', 'false' );
	dialog.appendChild( field );

	const error = document.createElement( 'p' );
	error.className = `${ ROOT_CLASS }__error`;
	error.hidden = true;
	error.setAttribute( 'role', 'alert' );
	dialog.appendChild( error );

	const actions = document.createElement( 'div' );
	actions.className = `${ ROOT_CLASS }__actions`;

	const cancel = document.createElement( 'os-button' );
	cancel.className = `${ ROOT_CLASS }__btn ${ ROOT_CLASS }__btn--secondary`;
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = 'Cancel';

	const submit = document.createElement( 'os-button' );
	submit.className = `${ ROOT_CLASS }__btn ${ ROOT_CLASS }__btn--primary`;
	submit.setAttribute( 'variant', 'primary' );
	submit.textContent = options.submitLabel ?? 'Create';

	actions.appendChild( cancel );
	actions.appendChild( submit );
	dialog.appendChild( actions );

	overlay.appendChild( dialog );
	document.body.appendChild( overlay );
	active = overlay;

	// Focus and select the initial name so the user can type
	// straight over it — same pattern as macOS Finder's
	// "untitled folder" affordance.
	focusField( field );

	doAction( 'os.files.create-folder.opened', {} );

	const setBusy = ( busy: boolean ): void => {
		setControlDisabled( field, busy );
		setControlDisabled( cancel, busy );
		setControlDisabled( submit, busy );
		dialog.classList.toggle( `${ ROOT_CLASS }--busy`, busy );
	};

	const showError = ( msg: string ): void => {
		error.textContent = msg;
		error.hidden = false;
	};

	const doCancel = (): void => {
		closeCreateFolderDialog();
		options.onCancel?.();
	};

	const doSubmit = async (): Promise< void > => {
		const name = readFieldValue( field ).trim();
		if ( ! name ) {
			showError( 'Please enter a name.' );
			focusField( field );
			return;
		}
		error.hidden = true;
		setBusy( true );
		try {
			await options.onSubmit( name );
			closeCreateFolderDialog();
		} catch ( err ) {
			setBusy( false );
			showError(
				err instanceof Error
					? err.message
					: 'Could not create the folder.',
			);
			focusField( field );
		}
	};

	cancel.addEventListener( 'click', () => doCancel() );
	submit.addEventListener( 'click', () => void doSubmit() );

	overlay.addEventListener( 'click', ( e: MouseEvent ) => {
		if ( e.target === overlay ) {
			doCancel();
		}
	} );

	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			doCancel();
		} else if ( e.key === 'Enter' && ! e.isComposing ) {
			e.preventDefault();
			void doSubmit();
		}
	};
	dialog.addEventListener( 'keydown', onKey );

	overlay.addEventListener( 'create-folder-dialog-closed', () => {
		dialog.removeEventListener( 'keydown', onKey );
	} );
}
