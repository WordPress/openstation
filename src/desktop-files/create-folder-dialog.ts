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
 * The dialog is intentionally framework-free — vanilla DOM, no
 * Web Component dependency — so it works as a building block
 * before the Phase-6 share dialog UI lands. Plugins that want
 * a richer affordance can replace it via the
 * `os.files.create-folder.dialog` filter (returns
 * `false` to suppress the built-in dialog and own the flow).
 */

import { applyFilters, doAction } from '../hooks';

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

	const label = document.createElement( 'label' );
	label.className = `${ ROOT_CLASS }__label`;
	label.htmlFor = `${ ROOT_CLASS }-input`;
	label.textContent = options.label ?? 'Folder name';
	dialog.appendChild( label );

	const input = document.createElement( 'input' );
	input.type = 'text';
	input.id = `${ ROOT_CLASS }-input`;
	input.className = `${ ROOT_CLASS }__input`;
	input.value = initial;
	input.setAttribute( 'autocomplete', 'off' );
	input.setAttribute( 'spellcheck', 'false' );
	dialog.appendChild( input );

	const error = document.createElement( 'p' );
	error.className = `${ ROOT_CLASS }__error`;
	error.hidden = true;
	error.setAttribute( 'role', 'alert' );
	dialog.appendChild( error );

	const actions = document.createElement( 'div' );
	actions.className = `${ ROOT_CLASS }__actions`;

	const cancel = document.createElement( 'button' );
	cancel.type = 'button';
	cancel.className = `${ ROOT_CLASS }__btn ${ ROOT_CLASS }__btn--secondary`;
	cancel.textContent = 'Cancel';

	const submit = document.createElement( 'button' );
	submit.type = 'button';
	submit.className = `${ ROOT_CLASS }__btn ${ ROOT_CLASS }__btn--primary`;
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
	input.focus();
	input.select();

	doAction( 'os.files.create-folder.opened', {} );

	const setBusy = ( busy: boolean ): void => {
		input.disabled = busy;
		cancel.disabled = busy;
		submit.disabled = busy;
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
		const name = input.value.trim();
		if ( ! name ) {
			showError( 'Please enter a name.' );
			input.focus();
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
			input.focus();
			input.select();
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
