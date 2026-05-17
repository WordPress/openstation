/**
 * OS-file drop manager — upload confirmation dialog.
 *
 * Renders a `<wpd-modal>` with one editable form per dropped
 * file. Every field arrives pre-filled with a sensible default
 * (see `defaultFields()` in `manager.ts`) but is fully editable.
 *
 * The dialog drives the upload loop itself — it doesn't hand
 * the result back to the manager. This keeps the per-file
 * progress + error state local to the dialog (the manager is
 * stateless between drops).
 *
 * @since 0.30.0
 */

import '../ui/components/wpd-modal/wpd-modal';
import '../ui/components/wpd-text-field/wpd-text-field';
import '../ui/components/wpd-textarea/wpd-textarea';
import '../ui/components/wpd-button/wpd-button';
import { showToast } from '../toast';
import { uploadFile, UploadCancelledError } from './upload';
import type {
	DropContext,
	DropFileEntry,
	DropDialogFields,
} from './types';

interface OpenDialogArgs {
	entries: DropFileEntry[];
	context: DropContext;
	mediaUrl: string;
	restNonce: string;
}

export async function openUploadDialog( args: OpenDialogArgs ): Promise< void > {
	if ( args.entries.length === 0 ) {
		return;
	}
	const modal = document.createElement( 'wpd-modal' );
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'md' );
	modal.setAttribute(
		'title',
		args.entries.length === 1
			? 'Upload to Media Library'
			: `Upload ${ args.entries.length } files to Media Library`,
	);
	document.body.appendChild( modal );

	const draft: DropDialogFields[] = args.entries.map( ( entry ) => ( {
		...entry.fields,
	} ) );

	const renderBody = (): void => {
		modal.innerHTML = '';
		const list = document.createElement( 'div' );
		list.style.cssText =
			'display:flex;flex-direction:column;gap:18px;max-height:60vh;overflow:auto;padding-right:6px;';
		args.entries.forEach( ( entry, i ) => {
			list.appendChild( renderEntry( entry, draft[ i ], i + 1 ) );
		} );
		modal.appendChild( list );

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );
		footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

		const cancel = document.createElement( 'wpd-button' );
		cancel.setAttribute( 'variant', 'secondary' );
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', () => {
			modal.remove();
		} );

		const upload = document.createElement( 'wpd-button' );
		upload.setAttribute( 'variant', 'primary' );
		upload.textContent =
			args.entries.length === 1 ? 'Upload' : `Upload ${ args.entries.length } files`;
		upload.addEventListener( 'click', () => {
			void runUploads( upload, cancel );
		} );

		footer.appendChild( cancel );
		footer.appendChild( upload );
		modal.appendChild( footer );
	};

	const renderEntry = (
		entry: DropFileEntry,
		fields: DropDialogFields,
		index: number,
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.style.cssText =
			'display:flex;flex-direction:column;gap:8px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;';
		const heading = document.createElement( 'div' );
		heading.style.cssText =
			'display:flex;gap:10px;align-items:center;font-weight:600;';
		const tag = document.createElement( 'span' );
		tag.textContent = args.entries.length === 1 ? '' : `#${ index } · `;
		tag.style.opacity = '0.6';
		const fname = document.createElement( 'span' );
		fname.textContent = entry.file.name;
		fname.style.cssText =
			'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const size = document.createElement( 'span' );
		size.textContent = `${ entry.mime || 'unknown' } · ${ formatBytes(
			entry.file.size,
		) }`;
		size.style.cssText = 'opacity:0.6;font-size:12px;';
		heading.appendChild( tag );
		heading.appendChild( fname );
		heading.appendChild( size );
		wrap.appendChild( heading );

		wrap.appendChild( textField( 'Title', fields.title, ( v ) => ( fields.title = v ) ) );
		wrap.appendChild( textField( 'Filename', fields.filename, ( v ) => ( fields.filename = v ) ) );
		if ( entry.mime.startsWith( 'image/' ) ) {
			wrap.appendChild(
				textField( 'Alt text', fields.altText, ( v ) => ( fields.altText = v ) ),
			);
		}
		wrap.appendChild( textField( 'Caption', fields.caption, ( v ) => ( fields.caption = v ) ) );
		wrap.appendChild(
			textareaField( 'Description', fields.description, ( v ) => ( fields.description = v ) ),
		);
		return wrap;
	};

	const runUploads = async (
		uploadBtn: HTMLElement,
		cancelBtn: HTMLElement,
	): Promise< void > => {
		( uploadBtn as unknown as { disabled: boolean } ).disabled = true;
		( cancelBtn as unknown as { disabled: boolean } ).disabled = true;
		uploadBtn.textContent = 'Uploading…';
		let successes = 0;
		let failures = 0;
		for ( let i = 0; i < args.entries.length; i++ ) {
			const entry = args.entries[ i ];
			try {
				await uploadFile( {
					file: entry.file,
					mime: entry.mime,
					fields: draft[ i ],
					context: args.context,
					mediaUrl: args.mediaUrl,
					restNonce: args.restNonce,
				} );
				successes++;
			} catch ( err ) {
				if ( err instanceof UploadCancelledError ) {
					// Filter chose to cancel — treat as a soft win.
					continue;
				}
				failures++;
				const message =
					err instanceof Error ? err.message : 'Upload failed.';
				showToast( {
					message: `“${ entry.file.name }” — ${ message }`,
				} );
			}
		}
		modal.remove();
		if ( successes > 0 && failures === 0 ) {
			showToast( {
				message:
					successes === 1
						? 'Uploaded to Media Library.'
						: `Uploaded ${ successes } files to Media Library.`,
			} );
		}
	};

	renderBody();
	await new Promise< void >( ( resolve ) => {
		modal.addEventListener( 'wpd-modal-cancel', () => {
			modal.remove();
			resolve();
		} );
		// Resolve when the modal leaves the DOM.
		const observer = new MutationObserver( () => {
			if ( ! modal.isConnected ) {
				observer.disconnect();
				resolve();
			}
		} );
		observer.observe( document.body, { childList: true, subtree: true } );
	} );
}

function textField(
	label: string,
	value: string,
	onChange: ( v: string ) => void,
): HTMLElement {
	const el = document.createElement( 'wpd-text-field' );
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', value );
	el.addEventListener( 'input', () => {
		const v = ( el as unknown as { value?: string } ).value;
		if ( typeof v === 'string' ) {
			onChange( v );
		}
	} );
	return el;
}

function textareaField(
	label: string,
	value: string,
	onChange: ( v: string ) => void,
): HTMLElement {
	const el = document.createElement( 'wpd-textarea' );
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', value );
	el.setAttribute( 'rows', '3' );
	el.addEventListener( 'input', () => {
		const v = ( el as unknown as { value?: string } ).value;
		if ( typeof v === 'string' ) {
			onChange( v );
		}
	} );
	return el;
}

function formatBytes( bytes: number ): string {
	if ( bytes >= 1024 * 1024 ) {
		return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
	}
	if ( bytes >= 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 0 ) } KB`;
	}
	return `${ bytes } B`;
}
