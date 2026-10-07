import '../ui/components/os-modal/os-modal';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-textarea/os-textarea';
import '../ui/components/os-button/os-button';
import '../ui/components/os-segmented/os-segmented';
import { showToast } from '../toast';
import { formatBytes } from './format-bytes';
import {
	uploadFile,
	UploadAbortedError,
	UploadCancelledError,
} from './upload';
import { uploadFileToDesktop } from './desktop-upload';
import {
	ensureUploadPath,
	listFolders,
	listPlacements,
} from '../desktop-files/rest';
import {
	ingestCreatedFolders,
	setFolderPlacements,
	setFolders,
} from '../desktop-files/store';
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

	filesUrl?: string;
	storage?: DesktopStorageConfig;

	forceDesktop?: boolean;

	preferDesktop?: boolean;

	emptyDirs?: string[];

	mediaMaxBytes?: number;
}

function snapToGrid( x: number, y: number ): { x: number; y: number } {
	const col = Math.max( 0, Math.round( ( x - 16 ) / 96 ) );
	const row = Math.max( 0, Math.round( ( y - 16 ) / 110 ) );
	return { x: 16 + col * 96, y: 16 + row * 110 };
}

const MEDIA_KIND_RE = /^(image|video|audio)\//;

export function resolveDefaultDestination( opts: {
	desktopAllowed: boolean;
	surface: DropContext[ 'surface' ];
	folderId?: number;
	forceDesktop?: boolean;
	preferDesktop?: boolean;
	mimes: string[];
} ): Destination {
	if ( ! opts.desktopAllowed ) {
		return 'media';
	}
	if ( opts.forceDesktop || opts.preferDesktop ) {
		return 'desktop';
	}
	if ( opts.surface === 'window' || opts.surface === 'iframe' ) {
		return 'media';
	}
	if ( ( opts.folderId ?? 0 ) > 0 ) {
		return 'desktop';
	}
	const allMedia =
		opts.mimes.length > 0 &&
		opts.mimes.every( ( m ) => MEDIA_KIND_RE.test( m ) );
	return allMedia ? 'media' : 'desktop';
}

let activeDialog: {
	replace: ( next: OpenDialogArgs ) => void;
} | null = null;

export async function openUploadDialog( args: OpenDialogArgs ): Promise< void > {
	if ( args.entries.length === 0 && ! args.emptyDirs?.length ) {
		return;
	}

	if ( activeDialog ) {
		activeDialog.replace( args );
		return;
	}
	const desktopAllowed = !! ( args.storage?.canUpload && args.filesUrl );
	let destination: Destination = resolveDefaultDestination( {
		desktopAllowed,
		surface: args.context.surface,
		folderId: args.context.folderId,
		forceDesktop: args.forceDesktop,
		preferDesktop: args.preferDesktop,
		mimes: args.entries.map( ( e ) => e.mime ),
	} );

	const modal = document.createElement( 'os-modal' );
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'md' );
	document.body.appendChild( modal );

	const syncTitle = (): void => {
		const count = args.entries.length;
		let target = 'Media Library';
		if ( destination === 'desktop' ) {
			target = ( args.context.folderId ?? 0 ) > 0 ? 'this folder' : 'Desktop';
		}
		let title = `Upload ${ count } files to ${ target }`;
		if ( count === 0 ) {
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

		if ( desktopAllowed && ! args.forceDesktop ) {
			const destWrap = document.createElement( 'div' );
			destWrap.style.cssText =
				'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
			const destLabel = document.createElement( 'span' );
			destLabel.textContent = 'Upload to';
			destLabel.style.cssText = 'font-weight:600;';
			destWrap.appendChild( destLabel );

			const segmented = document.createElement( 'os-segmented' );
			segmented.setAttribute( 'value', destination );
			segmented.setAttribute( 'label', 'Destination' );
			segmented.style.setProperty( '--os-ui-segmented-bg', 'rgba(255,255,255,0.06)' );
			const segDesktop = document.createElement( 'os-segment' );
			segDesktop.setAttribute( 'value', 'desktop' );
			segDesktop.textContent = 'Desktop';
			segmented.appendChild( segDesktop );
			const segMedia = document.createElement( 'os-segment' );
			segMedia.setAttribute( 'value', 'media' );
			segMedia.textContent = 'Media Library';
			segmented.appendChild( segMedia );
			segmented.addEventListener( 'os-pick', ( e ) => {
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

		const maxBytes =
			destination === 'desktop'
				? args.storage?.maxBytes ?? 0
				: args.mediaMaxBytes ?? 0;
		if ( maxBytes > 0 ) {
			const cap = document.createElement( 'div' );
			cap.className = 'os-upload-dialog__max-size';
			cap.style.cssText = 'opacity:0.6;font-size:12px;margin-bottom:14px;';
			cap.textContent = `Maximum file size: ${ formatBytes( maxBytes ) }`;
			modal.appendChild( cap );
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

		const cancel = document.createElement( 'os-button' );
		cancel.setAttribute( 'variant', 'secondary' );
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', () => {
			modal.remove();
		} );

		const upload = document.createElement( 'os-button' );
		upload.setAttribute( 'variant', 'primary' );
		if ( args.entries.length === 0 ) {
			upload.textContent = 'Create folders';
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
		if ( activeDialog === handle ) {
			activeDialog = null;
		}
		( uploadBtn as unknown as { disabled: boolean } ).disabled = true;
		( cancelBtn as unknown as { disabled: boolean } ).disabled = true;
		uploadBtn.textContent = 'Uploading…';
		const total = args.entries.length;
		let successes = 0;
		let failures = 0;
		let cancelled = 0;

		const failureDetails: string[] = [];

		const parentId = args.context.folderId ?? 0;
		let firstFlatPlaced = false;

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
					cancelled++;
					continue;
				}
				if ( err instanceof UploadAbortedError ) {
					cancelled++;
					continue;
				}
				failures++;
				const message =
					err instanceof Error ? err.message : 'Upload failed.';
				failureDetails.push( `“${ entry.file.name }” — ${ message }` );
			}
		}

		if ( destination === 'desktop' && args.emptyDirs?.length ) {
			for ( const dir of args.emptyDirs ) {
				try {
					const res = await ensureUploadPath( parentId, dir );

					ingestCreatedFolders( res.createdFolders, 'local' );
				} catch {

				}
			}
		}

		const createdFolders =
			args.entries.some( ( e ) => e.relativePath ) ||
			!! args.emptyDirs?.length;
		if ( destination === 'desktop' && createdFolders ) {
			try {
				const [ foldersRes, placementsRes ] = await Promise.all( [
					listFolders(),
					listPlacements( parentId ),
				] );
				setFolders( foldersRes.folders );
				setFolderPlacements( parentId, placementsRes.placements );
			} catch {

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

	const handle = {
		replace: ( next: OpenDialogArgs ): void => {
			args.entries = next.entries;
			args.emptyDirs = next.emptyDirs;
			args.forceDesktop = next.forceDesktop;
			args.preferDesktop = next.preferDesktop;
			args.context = next.context;
			args.mediaMaxBytes = next.mediaMaxBytes ?? args.mediaMaxBytes;
			draft.length = 0;
			for ( const entry of next.entries ) {
				draft.push( { ...entry.fields } );
			}

			destination = resolveDefaultDestination( {
				desktopAllowed,
				surface: next.context.surface,
				folderId: next.context.folderId,
				forceDesktop: next.forceDesktop,
				preferDesktop: next.preferDesktop,
				mimes: next.entries.map( ( e ) => e.mime ),
			} );
			syncTitle();
			renderBody();
		},
	};
	activeDialog = handle;

	renderBody();
	await new Promise< void >( ( resolve ) => {
		const finish = (): void => {
			if ( activeDialog === handle ) {
				activeDialog = null;
			}
			resolve();
		};
		modal.addEventListener( 'os-modal-cancel', () => {
			modal.remove();
			finish();
		} );

		const observer = new MutationObserver( () => {
			if ( ! modal.isConnected ) {
				observer.disconnect();
				finish();
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
	const el = document.createElement( 'os-text-field' );
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
	const el = document.createElement( 'os-textarea' );
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

function showBatchSummaryToast( args: BatchSummaryArgs ): void {
	const { total, successes, failures, cancelled, failureDetails } = args;
	const target =
		args.destination === 'desktop' ? 'your desktop' : 'Media Library';

	if ( total === 0 ) {
		if ( args.destination === 'desktop' ) {
			showToast( { message: 'Folder created on your desktop.' } );
		}
		return;
	}

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
