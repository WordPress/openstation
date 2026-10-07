import { applyFilters, doAction } from '../hooks';

import { focusField, readFieldValue, setControlDisabled } from './dialog-fields';

const ROOT_CLASS = 'os-create-folder-dialog';

export interface CreateFolderDialogOptions {

	initialName?: string;

	onSubmit: ( name: string ) => Promise< unknown > | unknown;

	onCancel?: () => void;

	title?: string;

	label?: string;

	submitLabel?: string;
}

let active: HTMLElement | null = null;

export function isCreateFolderDialogOpen(): boolean {
	return active !== null;
}

export function closeCreateFolderDialog(): void {
	if ( ! active ) {
		return;
	}
	active.dispatchEvent( new CustomEvent( 'create-folder-dialog-closed' ) );
	active.remove();
	active = null;
	doAction( 'os.files.create-folder.closed', {} );
}

export function openCreateFolderDialog( options: CreateFolderDialogOptions ): void {
	closeCreateFolderDialog();

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

	const field = document.createElement( 'os-text-field' );
	field.className = `${ ROOT_CLASS }__field`;
	field.id = `${ ROOT_CLASS }-input`;
	field.setAttribute( 'label', options.label ?? 'Folder name' );
	field.setAttribute( 'value', initial );
	field.setAttribute( 'autocomplete', 'off' );

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
