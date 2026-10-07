import { applyFilters, doAction } from '../hooks';
import { isMobileStamped } from '../mode/stamp';
import { showToast } from '../toast';
import { FILE_DROP_HOOKS } from './hooks';
import { collectDroppedTree, snapshotEntries } from './traversal';
import type {
	DesktopStorageConfig,
	DropConfig,
	DropContext,
	DropFileEntry,
	DropRejection,
	DropDialogFields,
} from './types';

interface SentinelHost {
	__openStationOsFileDropMounted?: MountedManager;
}

export const IFRAME_PASSTHROUGH_SELECTORS = [
	'.components-drop-zone',
	'[data-drop-zone]',
	'.uploader-window',
	'.media-frame-content',
];

export function dragHasFiles( ev: DragEvent ): boolean {
	const types = ev.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	const list = types as unknown as {
		includes?: ( s: string ) => boolean;
		contains?: ( s: string ) => boolean;
		length: number;
		[ i: number ]: string;
	};
	if ( typeof list.includes === 'function' ) {
		return list.includes( 'Files' );
	}
	if ( typeof list.contains === 'function' ) {
		return list.contains( 'Files' );
	}
	for ( let i = 0; i < list.length; i++ ) {
		if ( list[ i ] === 'Files' ) {
			return true;
		}
	}
	return false;
}

export function windowIdFromElement( el: Element | null ): string | undefined {
	const root = el?.closest?.( '.os-window' ) as HTMLElement | null;
	if ( ! root ) {
		return undefined;
	}
	const m = /^wp-window-(.+)$/.exec( root.id || '' );
	return m ? m[ 1 ] : undefined;
}

function resolveWindowIdFromSource(
	source: MessageEventSource | null,
): string | undefined {
	if ( ! source ) {
		return undefined;
	}
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const f of Array.from( iframes ) ) {
		if ( f.contentWindow === source ) {
			const fromRoot = windowIdFromElement( f );
			if ( fromRoot ) {
				return fromRoot;
			}
			const host = f.closest( '[data-window-id]' );
			return host?.getAttribute( 'data-window-id' ) || undefined;
		}
	}
	return undefined;
}

interface MountOptions {
	config: DropConfig;
	mediaUrl: string;
	restNonce: string;

	filesUrl?: string;

	storage?: DesktopStorageConfig;

	openDialog: (
		entries: DropFileEntry[],
		ctx: DropContext,
		extra?: { forceDesktop?: boolean; emptyDirs?: string[] },
	) => Promise< void >;
}

interface MountedManager {
	dispose: () => void;
}

export function mountOsFileDropManager( opts: MountOptions ): MountedManager {
	const host = window as unknown as SentinelHost;
	if ( host.__openStationOsFileDropMounted ) {
		return host.__openStationOsFileDropMounted;
	}
	if ( ! opts.config.enabled || isMobileStamped() ) {
		return mountNoOp();
	}

	const overlayEl = ensureDropOverlay();
	let dragDepth = 0;
	let dragWatchdog: ReturnType< typeof setTimeout > | null = null;

	const resetOverlay = (): void => {
		dragDepth = 0;
		overlayEl.classList.remove( 'is-active' );
		if ( dragWatchdog !== null ) {
			clearTimeout( dragWatchdog );
			dragWatchdog = null;
		}
	};

	const bumpWatchdog = (): void => {
		if ( dragWatchdog !== null ) {
			clearTimeout( dragWatchdog );
		}

		dragWatchdog = setTimeout( resetOverlay, 250 );
	};

	const onDragEnter = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}
		ev.preventDefault();
		dragDepth++;
		overlayEl.classList.add( 'is-active' );
		bumpWatchdog();
	};

	const onDragOver = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}

		if ( ev.defaultPrevented ) {
			resetOverlay();
			return;
		}
		ev.preventDefault();
		if ( ev.dataTransfer ) {
			ev.dataTransfer.dropEffect = 'copy';
		}
		bumpWatchdog();
	};

	const onDragLeave = (): void => {
		dragDepth = Math.max( 0, dragDepth - 1 );
		if ( dragDepth === 0 ) {
			overlayEl.classList.remove( 'is-active' );
		}
	};

	const onDrop = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}

		if ( ev.defaultPrevented ) {
			resetOverlay();
			return;
		}
		ev.preventDefault();
		resetOverlay();

		const entries = snapshotEntries( ev.dataTransfer?.items );
		const ctx = classifyDropTarget( ev );
		if ( entries.some( ( e ) => e.isDirectory ) ) {
			void handleTreeDrop( entries, ctx, opts );
			return;
		}
		const files = ev.dataTransfer?.files
			? Array.from( ev.dataTransfer.files )
			: [];
		if ( files.length === 0 ) {
			return;
		}
		void handleFiles( files, ctx, opts );
	};

	const onDragEnd = (): void => resetOverlay();
	const onVisibilityChange = (): void => {
		if ( document.visibilityState === 'hidden' ) {
			resetOverlay();
		}
	};

	const onIframeMessage = ( ev: MessageEvent ): void => {
		if ( ev.origin !== window.location.origin ) {
			return;
		}
		const data = ev.data as
			| {
					type?: string;
					files?: File[];
					windowId?: string;
					x?: number;
					y?: number;
				}
			| null;
		if ( ! data || data.type !== 'os-file-drop' ) {
			return;
		}
		if ( ! Array.isArray( data.files ) || data.files.length === 0 ) {
			return;
		}

		const files = data.files.filter( ( f ): f is File => f instanceof File );
		if ( files.length === 0 ) {
			return;
		}

		const windowId = resolveWindowIdFromSource( ev.source );
		if ( ! windowId ) {
			return;
		}
		const ctx: DropContext = {
			surface: 'iframe',
			windowId,
			x: typeof data.x === 'number' ? data.x : 0,
			y: typeof data.y === 'number' ? data.y : 0,
		};

		dragDepth = 0;
		overlayEl.classList.remove( 'is-active' );
		void handleFiles( files, ctx, opts );
	};

	window.addEventListener( 'dragenter', onDragEnter );
	window.addEventListener( 'dragover', onDragOver );
	window.addEventListener( 'dragleave', onDragLeave );
	window.addEventListener( 'drop', onDrop );
	window.addEventListener( 'dragend', onDragEnd );
	document.addEventListener( 'visibilitychange', onVisibilityChange );
	window.addEventListener( 'blur', onDragEnd );
	window.addEventListener( 'message', onIframeMessage );

	const manager: MountedManager = {
		dispose: (): void => {
			window.removeEventListener( 'dragenter', onDragEnter );
			window.removeEventListener( 'dragover', onDragOver );
			window.removeEventListener( 'dragleave', onDragLeave );
			window.removeEventListener( 'drop', onDrop );
			window.removeEventListener( 'dragend', onDragEnd );
			document.removeEventListener(
				'visibilitychange',
				onVisibilityChange,
			);
			window.removeEventListener( 'blur', onDragEnd );
			window.removeEventListener( 'message', onIframeMessage );
			overlayEl.remove();
			delete ( window as unknown as SentinelHost )
				.__openStationOsFileDropMounted;
		},
	};
	host.__openStationOsFileDropMounted = manager;
	return manager;
}

function ensureDropOverlay(): HTMLElement {
	const existing = document.querySelector( '.os-drop-overlay' );
	if ( existing ) {
		return existing as HTMLElement;
	}
	const el = document.createElement( 'div' );
	el.className = 'os-drop-overlay';
	el.setAttribute( 'aria-hidden', 'true' );
	el.style.cssText = [
		'position:fixed',
		'inset:0',
		'pointer-events:none',
		'z-index:200',
		'opacity:0',
		'transition:opacity 120ms ease',
		'background:radial-gradient(circle at center, rgba(34,113,177,0.18) 0%, rgba(34,113,177,0.06) 60%, transparent 100%)',
		'box-shadow:inset 0 0 0 3px rgba(34,113,177,0.55)',
	].join( ';' );
	const label = document.createElement( 'div' );
	label.style.cssText = [
		'position:absolute',
		'top:50%',
		'left:50%',
		'transform:translate(-50%,-50%)',
		'padding:14px 22px',
		'border-radius:12px',
		'background:rgba(20,20,24,0.78)',
		'color:#fff',
		'font:600 14px/1.2 -apple-system,BlinkMacSystemFont,sans-serif',
		'letter-spacing:0.02em',
	].join( ';' );
	label.textContent = 'Drop to upload';
	el.appendChild( label );
	document.body.appendChild( el );
	const style = document.createElement( 'style' );
	style.textContent =
		'.os-drop-overlay.is-active{opacity:1!important;}';
	document.head.appendChild( style );
	return el;
}

function mountNoOp(): MountedManager {
	const cancel = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}

		const target = ev.target as Element | null;
		if (
			target?.closest &&
			IFRAME_PASSTHROUGH_SELECTORS.some( ( s ) => target.closest( s ) )
		) {
			return;
		}
		ev.preventDefault();
	};
	window.addEventListener( 'dragover', cancel );
	window.addEventListener( 'drop', cancel );
	const host = window as unknown as SentinelHost;
	const manager: MountedManager = {
		dispose: (): void => {
			window.removeEventListener( 'dragover', cancel );
			window.removeEventListener( 'drop', cancel );
			delete host.__openStationOsFileDropMounted;
		},
	};
	host.__openStationOsFileDropMounted = manager;
	return manager;
}

export function classifyDropTarget(

	ev: Pick< DragEvent, 'clientX' | 'clientY' | 'target' >,
): DropContext {
	const x = ev.clientX;
	const y = ev.clientY;
	let node: Element | null = ev.target as Element | null;
	while ( node && node !== document.body ) {
		if (
			node.classList.contains( 'os-file-tile' ) &&
			( node as HTMLElement ).dataset.fileType === 'folder'
		) {
			const tileRef = Number(
				( node as HTMLElement ).dataset.fileRef ?? 0,
			);
			if ( Number.isFinite( tileRef ) && tileRef > 0 ) {
				return { surface: 'folder', folderId: tileRef, x, y };
			}
		}
		if ( node.tagName === 'IFRAME' ) {
			return {
				surface: 'iframe',
				windowId: windowIdFromElement( node ),
				x,
				y,
			};
		}
		if (
			node.classList.contains( 'os-window' ) ||
			node.hasAttribute( 'data-window-id' )
		) {
			const windowId =
				windowIdFromElement( node ) ??
				( node.getAttribute( 'data-window-id' ) || undefined );

			const folderMatch = windowId
				? /^os-folder-(\d+)/.exec( windowId )
				: null;
			if ( folderMatch ) {
				return {
					surface: 'folder',
					folderId: Number( folderMatch[ 1 ] ),
					windowId,
					x,
					y,
				};
			}
			return { surface: 'window', windowId, x, y };
		}
		if ( ( node as HTMLElement ).dataset?.folderId !== undefined ) {
			const folderId = Number(
				( node as HTMLElement ).dataset.folderId,
			);
			if ( Number.isFinite( folderId ) && folderId > 0 ) {
				return { surface: 'folder', folderId, x, y };
			}
			return { surface: 'wallpaper', x, y };
		}
		if (
			node.id === 'os-wallpaper' ||
			node.classList.contains( 'os-wallpaper' ) ||
			node.classList.contains( 'os-desktop' )
		) {
			return { surface: 'wallpaper', x, y };
		}
		node = node.parentElement;
	}
	return { surface: 'unknown', x, y };
}

export async function handleFiles(
	rawFiles: File[],
	ctx: DropContext,
	opts: MountOptions,
): Promise< void > {
	const detected = applyFilters(
		FILE_DROP_HOOKS.FILES_DETECTED,
		rawFiles,
		ctx,
	) as File[];
	if ( ! Array.isArray( detected ) || detected.length === 0 ) {
		return;
	}

	const { accepted, rejected } = partitionByPolicy(
		detected,
		opts.config,
	);

	if ( rejected.length > 0 ) {
		doAction( FILE_DROP_HOOKS.FILES_REJECTED, {
			rejections: rejected,
			context: ctx,
		} );
		showToast( {
			message:
				rejected.length === 1
					? rejected[ 0 ].message
					: `${ rejected.length } files couldn't be uploaded.`,
		} );
	}

	if ( accepted.length === 0 ) {
		return;
	}

	const entries: DropFileEntry[] = accepted.map( ( { file, mime } ) => {
		const base: DropFileEntry = {
			file,
			mime,
			fields: defaultFields( file, mime ),
		};
		const filtered = applyFilters(
			FILE_DROP_HOOKS.DIALOG_FIELDS,
			base,
			ctx,
		);

		if (
			! filtered ||
			typeof filtered !== 'object' ||
			! ( 'fields' in filtered ) ||
			typeof ( filtered as DropFileEntry ).fields !== 'object'
		) {
			return base;
		}
		return filtered as DropFileEntry;
	} );

	await opts.openDialog( entries, ctx );
}

export async function handleTreeDrop(
	entries: FileSystemEntry[],
	ctx: DropContext,
	opts: MountOptions,
): Promise< void > {
	if ( ! opts.storage?.canUpload || ! opts.filesUrl ) {
		showToast( {
			message: 'Folder uploads need desktop storage, which is not available for your account.',
		} );
		return;
	}
	const tree = await collectDroppedTree( entries );
	const detected = applyFilters(
		FILE_DROP_HOOKS.FILES_DETECTED,
		tree.files.map( ( t ) => t.file ),
		ctx,
	) as File[];
	if ( ! Array.isArray( detected ) ) {
		return;
	}
	const detectedSet = new Set( detected );
	const kept = tree.files.filter( ( t ) => detectedSet.has( t.file ) );
	if ( kept.length === 0 && tree.emptyDirs.length === 0 ) {
		return;
	}

	const { accepted, rejected } = partitionByPolicy(
		kept.map( ( t ) => t.file ),
		opts.config,
	);
	if ( rejected.length > 0 ) {
		doAction( FILE_DROP_HOOKS.FILES_REJECTED, {
			rejections: rejected,
			context: ctx,
		} );
		showToast( {
			message:
				rejected.length === 1
					? rejected[ 0 ].message
					: `${ rejected.length } files couldn't be uploaded.`,
		} );
	}
	const relByFile = new Map( kept.map( ( t ) => [ t.file, t.relativePath ] ) );
	const entriesForDialog: DropFileEntry[] = accepted.map( ( { file, mime } ) => ( {
		file,
		mime,
		fields: defaultFields( file, mime ),
		relativePath: relByFile.get( file ) ?? '',
	} ) );
	if ( entriesForDialog.length === 0 && tree.emptyDirs.length === 0 ) {
		return;
	}
	await opts.openDialog( entriesForDialog, ctx, {
		forceDesktop: true,
		emptyDirs: tree.emptyDirs,
	} );
}

export function partitionByPolicy(
	files: File[],
	config: DropConfig,
): { accepted: { file: File; mime: string }[]; rejected: DropRejection[] } {
	const accepted: { file: File; mime: string }[] = [];
	const rejected: DropRejection[] = [];
	for ( const file of files ) {
		if ( file.size === 0 ) {
			rejected.push( {
				file,
				reason: 'empty',
				message: `“${ file.name }” is empty.`,
			} );
			continue;
		}
		if ( config.maxSize > 0 && file.size > config.maxSize ) {
			rejected.push( {
				file,
				reason: 'size',
				message: `“${ file.name }” exceeds the ${ formatBytes(
					config.maxSize,
				) } upload limit.`,
			} );
			continue;
		}
		const mime = resolveAllowedMime(
			file,
			config.allowedMimes,
			config.extToMime,
		);
		if ( ! mime ) {
			rejected.push( {
				file,
				reason: 'mime',
				message: `“${ file.name }” is not an allowed file type.`,
			} );
			continue;
		}
		accepted.push( { file, mime } );
	}
	return { accepted, rejected };
}

export function resolveAllowedMime(
	file: File,
	allowedMimes: string[],
	extToMime?: Record< string, string >,
): string | null {
	if ( allowedMimes.length === 0 ) {
		return null;
	}
	const lower = file.type.toLowerCase();
	if ( lower && allowedMimes.includes( lower ) ) {
		return lower;
	}

	const ext = extensionOf( file.name );
	if ( ! ext ) {
		return null;
	}
	if ( extToMime ) {
		for ( const [ key, mime ] of Object.entries( extToMime ) ) {
			if ( key.split( '|' ).includes( ext ) && allowedMimes.includes( mime ) ) {
				return mime;
			}
		}
		return null;
	}
	const guess = EXTENSION_GUESSES[ ext ];
	if ( guess && allowedMimes.includes( guess ) ) {
		return guess;
	}
	return null;
}

const EXTENSION_GUESSES: Record< string, string > = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	heif: 'image/heif',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	pdf: 'application/pdf',
};

function extensionOf( name: string ): string {
	const dot = name.lastIndexOf( '.' );
	if ( dot < 0 ) {
		return '';
	}
	return name.slice( dot + 1 ).toLowerCase();
}

export function defaultFields(
	file: File,
	mime: string,
): DropDialogFields {
	const safeName = sanitizeFilename( file.name );
	const ext = extensionOf( safeName );
	const stem = ext
		? safeName.slice( 0, safeName.length - ext.length - 1 )
		: safeName;
	const title = humanize( stem );
	return {
		title,
		altText: mime.startsWith( 'image/' ) ? title : '',
		caption: '',
		description: '',
		filename: safeName,
	};
}

export function sanitizeFilename( name: string ): string {
	const cleaned = name
		.replace( /[\\/]/g, '-' )

		.replace( /[\x00-\x1f\x7f]/g, '' )
		.replace( /\s+/g, ' ' )
		.replace( / *- */g, '-' )
		.replace( /-+/g, '-' )
		.trim()
		.replace( /^[-.]+|[-.]+$/g, '' );
	return cleaned || 'upload';
}

export function humanize( stem: string ): string {
	const spaced = stem.replace( /[-_]+/g, ' ' ).trim();
	if ( ! spaced ) {
		return 'Upload';
	}
	return spaced.charAt( 0 ).toUpperCase() + spaced.slice( 1 );
}

function formatBytes( bytes: number ): string {
	if ( bytes >= 1024 * 1024 ) {
		return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 0 ) } MB`;
	}
	if ( bytes >= 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 0 ) } KB`;
	}
	return `${ bytes } B`;
}
