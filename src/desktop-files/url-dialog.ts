/**
 * Desktop Mode — "New web link / window" dialog.
 *
 * Two-field modal (name + URL) used by the wallpaper context menu's
 * "New" submenu. Title / labels / submit copy are configurable so
 * the same dialog renders for both `link` (opens in browser) and
 * `embed` (opens in iframe window) flows.
 *
 * Mirrors the create-folder dialog's structure (overlay, focused
 * input, Escape/Enter, busy state, error) so the shell's two
 * built-in modals feel identical. Built on the framework's
 * `<wpd-text-field>` so it inherits keyboard nav, focus styling,
 * and color-scheme tokens for free.
 */

import { applyFilters, doAction } from '../hooks';
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.

const ROOT_CLASS = 'desktop-mode-url-dialog';

export interface UrlDialogOptions {
	/** Heading copy. */
	title: string;
	/** Helper line below the heading. Optional. */
	description?: string;
	/** Label for the name input. Defaults to 'Name'. */
	nameLabel?: string;
	/** Label for the URL input. Defaults to 'URL'. */
	urlLabel?: string;
	/** Initial name. */
	initialName?: string;
	/** Initial URL. */
	initialUrl?: string;
	/** Submit button copy. Defaults to 'Create'. */
	submitLabel?: string;
	/** Called with `{ name, url }` on submit. May return a Promise. */
	onSubmit: ( values: { name: string; url: string } ) => Promise< unknown > | unknown;
	/** Optional cancel callback. */
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
	doAction( 'desktop-mode.files.url-dialog.closed', {} );
}

/** Open the dialog. */
export function openUrlDialog( options: UrlDialogOptions ): void {
	closeUrlDialog();

	// Plugins can short-circuit by returning `false`.
	const decision = applyFilters< unknown, [ UrlDialogOptions ] >(
		'desktop-mode.files.url-dialog',
		null,
		options,
	);
	if ( decision === false ) {
		return;
	}

	const overlay = document.createElement( 'div' );
	overlay.className = `${ ROOT_CLASS }__overlay desktop-mode-create-folder-dialog__overlay`;
	overlay.setAttribute( 'role', 'presentation' );

	const dialog = document.createElement( 'div' );
	dialog.className = `${ ROOT_CLASS } desktop-mode-create-folder-dialog`;
	dialog.setAttribute( 'role', 'dialog' );
	dialog.setAttribute( 'aria-modal', 'true' );
	dialog.setAttribute( 'aria-labelledby', `${ ROOT_CLASS }-title` );

	const title = document.createElement( 'h2' );
	title.id = `${ ROOT_CLASS }-title`;
	title.className = 'desktop-mode-create-folder-dialog__title';
	title.textContent = options.title;
	dialog.appendChild( title );

	if ( options.description ) {
		const desc = document.createElement( 'p' );
		desc.className = `${ ROOT_CLASS }__description`;
		desc.textContent = options.description;
		dialog.appendChild( desc );
	}

	const nameField = document.createElement( 'wpd-text-field' );
	nameField.setAttribute( 'label', options.nameLabel ?? 'Name' );
	nameField.setAttribute( 'value', options.initialName ?? '' );
	nameField.setAttribute( 'placeholder', 'My web app' );
	nameField.setAttribute( 'autocomplete', 'off' );
	dialog.appendChild( nameField );

	const urlField = document.createElement( 'wpd-text-field' );
	urlField.setAttribute( 'label', options.urlLabel ?? 'URL' );
	urlField.setAttribute( 'value', options.initialUrl ?? 'https://' );
	urlField.setAttribute( 'placeholder', 'https://example.com' );
	urlField.setAttribute( 'type', 'url' );
	urlField.setAttribute( 'autocomplete', 'off' );
	dialog.appendChild( urlField );

	const error = document.createElement( 'p' );
	error.className = 'desktop-mode-create-folder-dialog__error';
	error.hidden = true;
	error.setAttribute( 'role', 'alert' );
	dialog.appendChild( error );

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-create-folder-dialog__actions';

	const cancel = document.createElement( 'button' );
	cancel.type = 'button';
	cancel.className =
		'desktop-mode-create-folder-dialog__btn desktop-mode-create-folder-dialog__btn--secondary';
	cancel.textContent = 'Cancel';

	const submit = document.createElement( 'button' );
	submit.type = 'button';
	submit.className =
		'desktop-mode-create-folder-dialog__btn desktop-mode-create-folder-dialog__btn--primary';
	submit.textContent = options.submitLabel ?? 'Create';

	actions.appendChild( cancel );
	actions.appendChild( submit );
	dialog.appendChild( actions );

	overlay.appendChild( dialog );
	document.body.appendChild( overlay );
	active = overlay;

	// Focus the name field on open. Web components upgrade async,
	// so we wait a tick before reaching for the inner native input.
	queueMicrotask( () => {
		const input = nameField.shadowRoot?.querySelector< HTMLInputElement >( 'input' );
		input?.focus();
		input?.select();
	} );

	doAction( 'desktop-mode.files.url-dialog.opened', {} );

	const readValue = ( field: HTMLElement ): string => {
		const v = ( field as unknown as { value?: string } ).value;
		if ( typeof v === 'string' ) {
			return v;
		}
		return field.shadowRoot?.querySelector< HTMLInputElement >( 'input' )?.value ?? '';
	};

	const setBusy = ( busy: boolean ): void => {
		( nameField as unknown as { disabled: boolean } ).disabled = busy;
		( urlField as unknown as { disabled: boolean } ).disabled = busy;
		cancel.disabled = busy;
		submit.disabled = busy;
		dialog.classList.toggle( 'desktop-mode-create-folder-dialog--busy', busy );
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
		const url = readValue( urlField ).trim();
		if ( ! url ) {
			showError( 'Please enter a URL.' );
			return;
		}
		// Coerce bare hostnames into a fully-qualified https:// URL.
		const finalUrl = /^[a-z][a-z0-9+\-.]*:/i.test( url ) ? url : `https://${ url }`;
		try {
			// Validate by parsing.
			// eslint-disable-next-line no-new
			new URL( finalUrl );
		} catch {
			showError( 'That doesn\'t look like a valid URL.' );
			return;
		}
		const name = readValue( nameField ).trim();
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

	// Submit on Enter from either field; Escape cancels.
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
