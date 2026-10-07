import { applyFilters, doAction } from '../hooks';

import { focusField, readFieldValue, setControlDisabled } from './dialog-fields';

const ROOT_CLASS = 'os-url-dialog';

export interface UrlDialogOptions {

	title: string;

	description?: string;

	nameLabel?: string;

	urlLabel?: string;

	initialName?: string;

	initialUrl?: string;

	submitLabel?: string;

	onSubmit: ( values: { name: string; url: string } ) => Promise< unknown > | unknown;

	onCancel?: () => void;
}

let active: HTMLElement | null = null;

export function isUrlDialogOpen(): boolean {
	return active !== null;
}

export function closeUrlDialog(): void {
	if ( ! active ) {
		return;
	}
	active.dispatchEvent( new CustomEvent( 'url-dialog-closed' ) );
	active.remove();
	active = null;
	doAction( 'os.files.url-dialog.closed', {} );
}

export function openUrlDialog( options: UrlDialogOptions ): void {
	closeUrlDialog();

	const decision = applyFilters< unknown, [ UrlDialogOptions ] >(
		'os.files.url-dialog',
		null,
		options,
	);
	if ( decision === false ) {
		return;
	}

	const overlay = document.createElement( 'div' );
	overlay.className = `${ ROOT_CLASS }__overlay os-create-folder-dialog__overlay`;
	overlay.setAttribute( 'role', 'presentation' );

	const dialog = document.createElement( 'div' );
	dialog.className = `${ ROOT_CLASS } os-create-folder-dialog`;
	dialog.setAttribute( 'role', 'dialog' );
	dialog.setAttribute( 'aria-modal', 'true' );
	dialog.setAttribute( 'aria-labelledby', `${ ROOT_CLASS }-title` );

	const title = document.createElement( 'h2' );
	title.id = `${ ROOT_CLASS }-title`;
	title.className = 'os-create-folder-dialog__title';
	title.textContent = options.title;
	dialog.appendChild( title );

	if ( options.description ) {
		const desc = document.createElement( 'p' );
		desc.className = `${ ROOT_CLASS }__description`;
		desc.textContent = options.description;
		dialog.appendChild( desc );
	}

	const nameField = document.createElement( 'os-text-field' );
	nameField.className = 'os-create-folder-dialog__field';
	nameField.setAttribute( 'label', options.nameLabel ?? 'Name' );
	nameField.setAttribute( 'value', options.initialName ?? '' );
	nameField.setAttribute( 'placeholder', 'My web app' );
	nameField.setAttribute( 'autocomplete', 'off' );
	dialog.appendChild( nameField );

	const urlField = document.createElement( 'os-text-field' );
	urlField.className = 'os-create-folder-dialog__field';
	urlField.setAttribute( 'label', options.urlLabel ?? 'URL' );
	urlField.setAttribute( 'value', options.initialUrl ?? 'https://' );
	urlField.setAttribute( 'placeholder', 'https://example.com' );
	urlField.setAttribute( 'type', 'url' );
	urlField.setAttribute( 'autocomplete', 'off' );
	dialog.appendChild( urlField );

	const error = document.createElement( 'p' );
	error.className = 'os-create-folder-dialog__error';
	error.hidden = true;
	error.setAttribute( 'role', 'alert' );
	dialog.appendChild( error );

	const actions = document.createElement( 'div' );
	actions.className = 'os-create-folder-dialog__actions';

	const cancel = document.createElement( 'os-button' );
	cancel.className =
		'os-create-folder-dialog__btn os-create-folder-dialog__btn--secondary';
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = 'Cancel';

	const submit = document.createElement( 'os-button' );
	submit.className =
		'os-create-folder-dialog__btn os-create-folder-dialog__btn--primary';
	submit.setAttribute( 'variant', 'primary' );
	submit.textContent = options.submitLabel ?? 'Create';

	actions.appendChild( cancel );
	actions.appendChild( submit );
	dialog.appendChild( actions );

	overlay.appendChild( dialog );
	document.body.appendChild( overlay );
	active = overlay;

	focusField( nameField );

	doAction( 'os.files.url-dialog.opened', {} );

	const setBusy = ( busy: boolean ): void => {
		setControlDisabled( nameField, busy );
		setControlDisabled( urlField, busy );
		setControlDisabled( cancel, busy );
		setControlDisabled( submit, busy );
		dialog.classList.toggle( 'os-create-folder-dialog--busy', busy );
	};

	const showError = ( msg: string ): void => {
		error.textContent = msg;
		error.hidden = false;
	};

	const doCancel = (): void => {
		closeUrlDialog();
		options.onCancel?.();
	};

	const doSubmit = async (): Promise< void > => {
		const url = readFieldValue( urlField ).trim();
		if ( ! url ) {
			showError( 'Please enter a URL.' );
			return;
		}

		const finalUrl = /^[a-z][a-z0-9+\-.]*:/i.test( url ) ? url : `https://${ url }`;
		try {
			new URL( finalUrl );
		} catch {
			showError( 'That doesn\'t look like a valid URL.' );
			return;
		}
		const name = readFieldValue( nameField ).trim();
		error.hidden = true;
		setBusy( true );
		try {
			await options.onSubmit( { name, url: finalUrl } );
			closeUrlDialog();
		} catch ( err ) {
			setBusy( false );
			showError( err instanceof Error ? err.message : 'Could not save.' );
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

	overlay.addEventListener( 'url-dialog-closed', () => {
		dialog.removeEventListener( 'keydown', onKey );
	} );
}
