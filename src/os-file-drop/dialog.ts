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
import '../ui/components/wpd-segmented/wpd-segmented';
import { showToast } from '../toast';
import { formatBytes } from './format-bytes';
import {
	uploadFile,
	UploadAbortedError,
	UploadCancelledError,
} from './upload';
import { uploadFileToDesktop } from './desktop-upload';
import { ensureUploadPath } from '../desktop-files/rest';
import type {
	DesktopStorageConfig,
	DropContext,
	DropFileEntry,
	DropDialogFields,
} from './types';

type Destination = 'desktop' | 'media';

interface OpenDialogArgs {
	entries: DropFileEntry[];
	context: DropContext;
	mediaUrl: string;
	restNonce: string;
	/** Files REST base — enables the desktop-storage destination. */
	filesUrl?: string;
	storage?: DesktopStorageConfig;
	/** Folder drops: the Media Library has no tree concept. */
	forceDesktop?: boolean;
	/** Empty directories from a tree drop, created after the files. */
	emptyDirs?: string[];
}

/** Grid math mirrored from `src/desktop-files/grid.ts` (16/96/110). */
function snapToGrid( x: number, y: number ): { x: number; y: number } {
	const col = Math.max( 0, Math.round( ( x - 16 ) / 96 ) );
	const row = Math.max( 0, Math.round( ( y - 16 ) / 110 ) );
	return { x: 16 + col * 96, y: 16 + row * 110 };
}

export async function openUploadDialog( args: OpenDialogArgs ): Promise< void > {
	if ( args.entries.length === 0 && ! args.emptyDirs?.length ) {
		return;
	}
	const desktopAllowed = !! ( args.storage?.canUpload && args.filesUrl );
	// Destination default follows the drop surface: WordPress admin
	// windows (Media, Posts, Pages, …) mean Media Library; the desk,
	// folder surfaces, and anything unclassified mean Desktop
	// storage. Folder drops additionally target THAT folder via
	// `context.folderId`.
	const isWpWindow =
		args.context.surface === 'window' || args.context.surface === 'iframe';
	let destination: Destination =
		desktopAllowed && ( args.forceDesktop || ! isWpWindow )
			? 'desktop'
			: 'media';

	const modal = document.createElement( 'wpd-modal' );
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'md' );
	document.body.appendChild( modal );

	const count = args.entries.length;
	const syncTitle = (): void => {
		let target = 'Media Library';
		if ( destination === 'desktop' ) {
			target = ( args.context.folderId ?? 0 ) > 0 ? 'this folder' : 'Desktop';
		}
		let title = `Upload ${ count } files to ${ target }`;
		if ( count === 0 ) {
			// Pure empty-dirs tree drop — matches the "Create
			// folders" primary button.
			title = ( args.context.folderId ?? 0 ) > 0
				? 'Create folders in this folder'
				: 'Create folders on Desktop';
		} else if ( count === 1 ) {
			title = `Upload to ${ target }`;
		}
		modal.setAttribute( 'title', title );
	};
	syncTitle();

	const draft: DropDialogFields[] = args.entries.map( ( entry ) => ( {
		...entry.fields,
	} ) );

	const renderBody = (): void => {
		modal.innerHTML = '';

		// Destination selector — only when both sinks are viable.
		// Folder drops force desktop storage (no selector).
		if ( desktopAllowed && ! args.forceDesktop ) {
			const destWrap = document.createElement( 'div' );
			destWrap.style.cssText =
				'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
			const destLabel = document.createElement( 'span' );
			destLabel.textContent = 'Upload to';
			destLabel.style.cssText = 'font-weight:600;';
			destWrap.appendChild( destLabel );

			const segmented = document.createElement( 'wpd-segmented' );
			segmented.setAttribute( 'value', destination );
			segmented.setAttribute( 'label', 'Destination' );
			segmented.style.setProperty( '--wpd-segmented-bg', 'rgba(255,255,255,0.06)' );
			const segDesktop = document.createElement( 'wpd-segment' );
			segDesktop.setAttribute( 'value', 'desktop' );
			segDesktop.textContent = 'Desktop';
			segmented.appendChild( segDesktop );
			const segMedia = document.createElement( 'wpd-segment' );
			segMedia.setAttribute( 'value', 'media' );
			segMedia.textContent = 'Media Library';
			segmented.appendChild( segMedia );
			segmented.addEventListener( 'wpd-pick', ( e ) => {
				const detail = ( e as CustomEvent< { value: Destination } > ).detail;
				destination = detail.value;
				syncTitle();
				renderBody();
			} );
			destWrap.appendChild( segmented );
			modal.appendChild( destWrap );
		} else if ( args.forceDesktop ) {
			const note = document.createElement( 'div' );
			note.style.cssText = 'opacity:0.7;font-size:12px;margin-bottom:14px;';
			note.textContent =
				'Folder uploads land in your desktop storage, preserving the folder structure.';
			modal.appendChild( note );
		}

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
		if ( args.entries.length === 0 ) {
			upload.textContent = 'Create folders'; // Pure empty-dirs tree drop.
		} else {
			upload.textContent =
				args.entries.length === 1
					? 'Upload'
					: `Upload ${ args.entries.length } files`;
		}
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

		if ( destination === 'desktop' ) {
			// Desktop storage keeps only the filename — title / alt /
			// caption / description are Media Library metadata.
			if ( entry.relativePath ) {
				const path = document.createElement( 'div' );
				path.textContent = entry.relativePath;
				path.style.cssText = 'opacity:0.55;font-size:12px;';
				wrap.appendChild( path );
			}
			wrap.appendChild(
				textField( 'Filename', fields.filename, ( v ) => ( fields.filename = v ) ),
			);
			return wrap;
		}

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
		const total = args.entries.length;
		let successes = 0;
		let failures = 0;
		let cancelled = 0;
		// Per-file failure messages — kept for single-file batches
		// where the summary toast doesn't carry the error detail.
		const failureDetails: string[] = [];
		// Desktop destination: place the FIRST flat file at the
		// snapped drop point; every other file omits coords so the
		// server picks the next free grid slot (no origin stacking).
		const parentId = args.context.folderId ?? 0;
		let firstFlatPlaced = false;
		// NOTE: sequential `await` — uploads run one at a time on
		// purpose. The HUD assumes one active progress bar per
		// `UPLOAD_STARTED` and won't reconcile concurrent streams
		// (the per-file state is keyed by `File`, but the panel's
		// "Uploading N of M…" header reads from a single counter).
		// Parallelising here would also let a 10-file batch swamp
		// the WordPress process pool / fpm workers on shared hosts.
		// If a future change introduces a concurrency knob, the HUD
		// header logic and the rate-limit story both need a look.
		for ( let i = 0; i < total; i++ ) {
			const entry = args.entries[ i ];
			try {
				if ( destination === 'desktop' && args.filesUrl ) {
					const isFlat = ! entry.relativePath;
					const coords =
						isFlat &&
						! firstFlatPlaced &&
						args.context.surface === 'wallpaper'
							? snapToGrid( args.context.x, args.context.y )
							: undefined;
					if ( coords ) {
						firstFlatPlaced = true;
					}
					await uploadFileToDesktop( {
						file: entry.file,
						mime: entry.mime,
						fields: draft[ i ],
						context: args.context,
						filesUrl: args.filesUrl,
						restNonce: args.restNonce,
						parentId,
						relativePath: entry.relativePath ?? '',
						coords,
					} );
				} else {
					await uploadFile( {
						file: entry.file,
						mime: entry.mime,
						fields: draft[ i ],
						context: args.context,
						mediaUrl: args.mediaUrl,
						restNonce: args.restNonce,
					} );
				}
				successes++;
			} catch ( err ) {
				if ( err instanceof UploadCancelledError ) {
					// Plugin filter blocked it — count as a soft skip
					// alongside user cancellations so the summary
					// reads consistently.
					cancelled++;
					continue;
				}
				if ( err instanceof UploadAbortedError ) {
					// User cancelled mid-flight via the HUD button.
					cancelled++;
					continue;
				}
				failures++;
				const message =
					err instanceof Error ? err.message : 'Upload failed.';
				failureDetails.push( `“${ entry.file.name }” — ${ message }` );
			}
		}
		// Empty directories from a tree drop — created after the
		// files so shared path segments already exist and dedupe.
		if ( destination === 'desktop' && args.emptyDirs?.length ) {
			for ( const dir of args.emptyDirs ) {
				try {
					await ensureUploadPath( parentId, dir );
				} catch {
					// Non-fatal: the tree's files made it; an empty
					// stub folder failing is cosmetic.
				}
			}
		}
		modal.remove();
		showBatchSummaryToast( {
			total,
			successes,
			failures,
			cancelled,
			failureDetails,
			destination,
		} );
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

interface BatchSummaryArgs {
	total: number;
	successes: number;
	failures: number;
	cancelled: number;
	failureDetails: string[];
	destination: Destination;
}

/**
 * One-line summary toast for the end of a batch. The phrasing
 * adapts to what actually happened:
 *
 *   - All succeeded → "Uploaded N files to Media Library."
 *   - All cancelled → "All uploads cancelled."
 *   - All failed → either the lone error or "N uploads failed."
 *   - Mixed → "Uploaded N. Cancelled X. Failed Y." (only the
 *     non-zero clauses appear, so two-state batches stay short).
 *
 * Single-file batches keep the existing "<file> — <error>" toast
 * for failures because there's no other way to surface the
 * server's message.
 */
function showBatchSummaryToast( args: BatchSummaryArgs ): void {
	const { total, successes, failures, cancelled, failureDetails } = args;
	const target =
		args.destination === 'desktop' ? 'your desktop' : 'Media Library';

	// Empty batch — a pure empty-dirs tree drop still deserves an ack.
	if ( total === 0 ) {
		if ( args.destination === 'desktop' ) {
			showToast( { message: 'Folder created on your desktop.' } );
		}
		return;
	}

	// Single-file batch — preserve the original tight feedback:
	// one toast that either confirms or carries the server error.
	if ( total === 1 ) {
		if ( successes === 1 ) {
			showToast( { message: `Uploaded to ${ target }.` } );
		} else if ( failures === 1 && failureDetails[ 0 ] ) {
			showToast( { message: failureDetails[ 0 ] } );
		} else if ( cancelled === 1 ) {
			showToast( { message: 'Upload cancelled.' } );
		}
		return;
	}

	// Single-state shortcuts.
	if ( successes === total ) {
		showToast( {
			message: `Uploaded ${ successes } files to ${ target }.`,
		} );
		return;
	}
	if ( cancelled === total ) {
		showToast( { message: 'All uploads cancelled.' } );
		return;
	}
	if ( failures === total ) {
		showToast( {
			message:
				failures === 1 && failureDetails[ 0 ]
					? failureDetails[ 0 ]
					: `${ failures } uploads failed.`,
		} );
		return;
	}

	// Mixed result — assemble the non-zero clauses.
	const parts: string[] = [];
	if ( successes > 0 ) {
		parts.push(
			`Uploaded ${ successes } file${ successes === 1 ? '' : 's' }.`,
		);
	}
	if ( cancelled > 0 ) {
		parts.push( `Cancelled ${ cancelled }.` );
	}
	if ( failures > 0 ) {
		parts.push( `Failed ${ failures }.` );
	}
	showToast( { message: parts.join( ' ' ) } );
}
