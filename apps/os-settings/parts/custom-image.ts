/**
 * Your own image — the drawer behind the dashed wallpaper tile. Two
 * sources: "Upload new" (drag-drop + file picker, absent when the
 * user cannot upload) and "Media Library" (a paginated REST grid with
 * search + the HD filter). Both talk to `wp/v2/media` through
 * `ctx.fetch`, so the nonce rides along and the window's activity dot
 * shows the request.
 */

import { __, html, sprintf } from '@openstation/app';
import {
	CUSTOM_IMAGE_ID,
	HD_MIN_HEIGHT,
	HD_MIN_WIDTH,
	MEDIA_PER_PAGE,
	SEARCH_DEBOUNCE_MS,
	getDefaultWallpaperId,
} from '../../../src/settings/constants';
import type { OsSettingsState } from '../../../src/settings/types';
import { settings, update } from './store';
import { extraOf, pickedChecked, pickedValue, uiOf, type Ctx, type Section } from './types';

/**
 * Subset of the REST media item we actually use. `_fields` on the
 * request narrows the payload to match so we're not shipping 60kb of
 * Gutenberg-specific metadata for a picker.
 */
export interface MediaItem {
	id: number;
	source_url: string;
	alt_text: string;
	title: { rendered: string };
	media_details: {
		width: number;
		height: number;
		sizes?: Record<
			string,
			{ source_url: string; width: number; height: number } | undefined
		>;
	};
}

/**
 * A safe filename for the Content-Disposition header on upload:
 * anything outside `[A-Za-z0-9._-]` becomes a dash.
 */
function sanitizeFilename( name: string ): string {
	const cleaned = name.replace( /[^a-zA-Z0-9._-]+/g, '-' ).replace( /^-+|-+$/g, '' );
	return cleaned || 'wallpaper';
}

/**
 * Sanity-check a REST media item before showing it in the picker:
 * drops entries missing a URL, an id, or zero-sized media_details
 * (usually broken uploads).
 */
function isUsableImage( item: MediaItem ): boolean {
	if ( ! item || typeof item.id !== 'number' || ! item.source_url ) {
		return false;
	}
	const d = item.media_details;
	return !! d && typeof d.width === 'number' && typeof d.height === 'number' && d.width > 0 && d.height > 0;
}

/** Plain text out of a REST `title.rendered`, entities and tags included. */
function stripHtml( markup: string ): string {
	if ( ! markup ) {
		return '';
	}
	const el = document.createElement( 'div' );
	el.innerHTML = markup;
	return el.textContent?.trim() || '';
}

// -------------------------------------------------------------- REST

async function errorMessage( response: Response, fallback: string ): Promise< string > {
	try {
		const data = ( await response.json() ) as { message?: unknown };
		if ( data && typeof data.message === 'string' ) {
			return data.message;
		}
	} catch {
		/* keep the fallback */
	}
	return fallback;
}

async function fetchMediaPage(
	ctx: Ctx,
	page: number,
	search: string,
	hdOnly: boolean,
): Promise< { items: MediaItem[]; totalPages: number } > {
	const url = new URL( extraOf( ctx ).mediaUrl );
	url.searchParams.set( 'media_type', 'image' );
	url.searchParams.set( 'per_page', String( MEDIA_PER_PAGE ) );
	url.searchParams.set( 'page', String( page ) );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'desc' );
	url.searchParams.set( '_fields', 'id,source_url,alt_text,title,media_details' );
	if ( search ) {
		url.searchParams.set( 'search', search );
	}
	if ( hdOnly ) {
		url.searchParams.set( 'openstation_min_width', String( HD_MIN_WIDTH ) );
		url.searchParams.set( 'openstation_min_height', String( HD_MIN_HEIGHT ) );
	}
	const response = await ctx.fetch( url.toString() );
	if ( ! response.ok ) {
		throw new Error( await errorMessage( response, `HTTP ${ response.status }` ) );
	}
	const totalPagesHeader = response.headers.get( 'X-WP-TotalPages' );
	const totalPages = totalPagesHeader ? parseInt( totalPagesHeader, 10 ) : 1;
	const items = ( await response.json() ) as MediaItem[];
	return { items: items.filter( isUsableImage ), totalPages: totalPages || 1 };
}

/**
 * A raw binary body with `Content-Disposition: attachment` — the
 * simplest shape WordPress accepts.
 */
async function uploadImage( ctx: Ctx, file: File ): Promise< { id: number; url: string } > {
	const response = await ctx.fetch( extraOf( ctx ).mediaUrl, {
		method: 'POST',
		headers: {
			'Content-Type': file.type,
			'Content-Disposition': `attachment; filename="${ sanitizeFilename( file.name ) }"`,
		},
		body: file,
	} );
	if ( ! response.ok ) {
		throw new Error(
			await errorMessage( response, `Upload failed (HTTP ${ response.status }).` ),
		);
	}
	const data = ( await response.json() ) as { id: number; source_url: string };
	return { id: data.id, url: data.source_url };
}

// ------------------------------------------------------------ upload

function choose( item: { id: number; url: string } ): void {
	update( { customImage: item, wallpaper: CUSTOM_IMAGE_ID } );
}

async function handleImageFile( ctx: Ctx, file: File ): Promise< void > {
	const lib = uiOf( ctx ).library;
	const fail = ( message: string ): void => {
		lib.uploadError = message;
		ctx.repaint();
		window.setTimeout( () => {
			lib.uploadError = '';
			ctx.repaint();
		}, 4000 );
	};
	if ( ! file.type.startsWith( 'image/' ) ) {
		fail( __( 'That file isn’t an image.' ) );
		return;
	}
	lib.uploading = true;
	ctx.repaint();
	try {
		choose( await uploadImage( ctx, file ) );
	} catch ( err ) {
		fail( err instanceof Error ? err.message : __( 'Upload failed.' ) );
	} finally {
		lib.uploading = false;
		ctx.repaint();
	}
}

/** What the upload tile shows: a status, the Remove button, or the prompt. */
function tileBody( uploading: boolean, hasImage: boolean, onRemove: ( e: Event ) => void ) {
	if ( uploading ) {
		return html`<span class="os-settings__upload-status">${ __( 'Uploading…' ) }</span>`;
	}
	if ( hasImage ) {
		return html`<os-button
			variant="danger"
			class="os-settings__upload-remove"
			aria-label=${ __( 'Remove custom image' ) }
			@click=${ onRemove }
		>${ __( 'Remove' ) }</os-button>`;
	}
	return html`<div class="os-settings__upload-inner">
		<span class="os-settings__upload-plus" aria-hidden="true">+</span>
		<span class="os-settings__upload-prompt">${ __( 'Drop an image here, or click to upload' ) }</span>
		<span class="os-settings__upload-hint">${ __( 'JPEG, PNG, or WebP · goes straight to your Media Library' ) }</span>
	</div>`;
}

const uploadPane: Section = ( s, ctx ) => {
	const lib = uiOf( ctx ).library;
	const hasImage = !! s.customImage;
	const classes = [ 'os-settings__upload-tile' ];
	if ( hasImage ) {
		classes.push( 'os-settings__upload-tile--filled' );
	}
	if ( lib.dragover ) {
		classes.push( 'os-settings__upload-tile--dragover' );
	}
	if ( lib.uploading ) {
		classes.push( 'os-settings__upload-tile--busy' );
	}
	const fileInput = (): HTMLInputElement | null =>
		ctx.root.querySelector< HTMLInputElement >( '[data-os-upload-input]' );
	const onRemove = ( e: Event ): void => {
		e.stopPropagation();
		// If the image was the active wallpaper, fall back to the
		// default preset so the user isn't left with an unreadable
		// blank desktop the moment they hit remove.
		update( {
			customImage: null,
			...( s.wallpaper === CUSTOM_IMAGE_ID ? { wallpaper: getDefaultWallpaperId() } : {} ),
		} );
	};
	const onClick = (): void => {
		if ( lib.uploading ) {
			return;
		}
		if ( s.customImage ) {
			update( { wallpaper: CUSTOM_IMAGE_ID } );
			return;
		}
		fileInput()?.click();
	};
	const onFile = ( e: Event ): void => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[ 0 ];
		if ( file ) {
			void handleImageFile( ctx, file );
		}
		// Clear so re-picking the same file fires `change` again.
		input.value = '';
	};
	const setDragover = ( on: boolean ): void => {
		if ( lib.dragover !== on ) {
			lib.dragover = on;
			ctx.repaint();
		}
	};
	return html`
		<input
			type="file"
			accept="image/*"
			class="os-settings__file-input"
			data-os-upload-input
			@change=${ onFile }
		/>
		<div
			class=${ classes.join( ' ' ) }
			data-wallpaper-id=${ CUSTOM_IMAGE_ID }
			aria-pressed=${ s.wallpaper === CUSTOM_IMAGE_ID ? 'true' : 'false' }
			aria-label=${ hasImage ? __( 'Custom image wallpaper' ) : __( 'Upload a wallpaper image' ) }
			style=${ hasImage ? `background-image: url("${ encodeURI( s.customImage!.url ) }")` : '' }
			@click=${ onClick }
			@dragover=${ ( e: DragEvent ) => {
				e.preventDefault();
				setDragover( true );
			} }
			@dragleave=${ () => setDragover( false ) }
			@drop=${ ( e: DragEvent ) => {
				e.preventDefault();
				setDragover( false );
				const file = e.dataTransfer?.files?.[ 0 ];
				if ( file ) {
					void handleImageFile( ctx, file );
				}
			} }
		>
			${ tileBody( lib.uploading, hasImage, onRemove ) }
			${ lib.uploadError
				? html`<span class="os-settings__upload-error" role="status">${ lib.uploadError }</span>`
				: '' }
		</div>
	`;
};

// ----------------------------------------------------------- library

function visibleLibraryItems( s: OsSettingsState, items: MediaItem[] ): MediaItem[] {
	if ( ! s.libraryHdOnly ) {
		return items;
	}
	return items.filter(
		( it ) => it.media_details.width >= HD_MIN_WIDTH && it.media_details.height >= HD_MIN_HEIGHT,
	);
}

/** Fetch the next page into the library state. */
export async function loadNextPage( ctx: Ctx ): Promise< void > {
	const lib = uiOf( ctx ).library;
	if ( lib.loading || ( lib.totalPages > 0 && lib.page >= lib.totalPages ) ) {
		return;
	}
	lib.loading = true;
	lib.error = '';
	ctx.repaint();
	try {
		const result = await fetchMediaPage( ctx, lib.page + 1, lib.query, settings().libraryHdOnly );
		lib.page += 1;
		lib.totalPages = result.totalPages;
		lib.loaded = lib.loaded.concat( result.items );
	} catch ( err ) {
		lib.error =
			err instanceof Error
				? sprintf(
					/* translators: %s: the browser-supplied error message. */
					__( 'Couldn’t load your media: %s' ),
					err.message,
				)
				: __( 'Couldn’t load your media.' );
	} finally {
		lib.loading = false;
		ctx.repaint();
	}
}

/** Start over — a new query, or the HD filter flipped. */
function resetAndReload( ctx: Ctx ): void {
	const lib = uiOf( ctx ).library;
	lib.page = 0;
	lib.totalPages = 0;
	lib.loaded = [];
	void loadNextPage( ctx );
}

const libraryTile = ( s: OsSettingsState, item: MediaItem ) => {
	const isSelected = s.wallpaper === CUSTOM_IMAGE_ID && s.customImage?.id === item.id;
	const sizes = item.media_details.sizes || {};
	const thumbUrl =
		sizes.medium?.source_url ||
		sizes.thumbnail?.source_url ||
		sizes.large?.source_url ||
		item.source_url;
	const altOrTitle =
		item.alt_text || stripHtml( item.title?.rendered || '' ) || `Image #${ item.id }`;
	return html`<button
		type="button"
		class=${ isSelected
			? 'os-settings__library-tile os-settings__library-tile--selected'
			: 'os-settings__library-tile' }
		data-media-id=${ String( item.id ) }
		aria-pressed=${ isSelected ? 'true' : 'false' }
		aria-label=${ altOrTitle }
		title=${ altOrTitle }
		style=${ `background-image: url("${ encodeURI( thumbUrl ) }")` }
		@click=${ () => choose( { id: item.id, url: item.source_url } ) }
	>
		<span class="os-settings__library-tile-dims">${ item.media_details.width }×${ item.media_details.height }</span>
	</button>`;
};

const libraryPane: Section = ( s, ctx ) => {
	const lib = uiOf( ctx ).library;
	const visible = visibleLibraryItems( s, lib.loaded );
	const hiddenByHd = lib.loaded.length - visible.length;
	const parts = [
		/* translators: %d: the number of media items currently visible. */
		sprintf( __( 'Showing %d' ), visible.length ),
	];
	if ( s.libraryHdOnly && hiddenByHd > 0 ) {
		/* translators: %d: the number of images filtered out by the HD toggle. */
		parts.push( sprintf( __( '%d hidden by HD filter' ), hiddenByHd ) );
	}
	const onSearch = ( e: Event ): void => {
		const value = ( e.target as HTMLInputElement ).value;
		if ( lib.searchTimer !== null ) {
			window.clearTimeout( lib.searchTimer );
		}
		lib.searchTimer = window.setTimeout( () => {
			lib.searchTimer = null;
			lib.query = value.trim();
			resetAndReload( ctx );
		}, SEARCH_DEBOUNCE_MS );
	};
	const onHdToggle = ( e: Event ): void => {
		// A setting, but nothing for the store to paint: the list is
		// re-fetched here, reading the value the store now holds.
		update( { libraryHdOnly: pickedChecked( e ) } );
		resetAndReload( ctx );
	};
	const grid = (): unknown => {
		if ( lib.error ) {
			return html`<p class="os-settings__library-error">${ lib.error }</p>`;
		}
		if ( lib.loading && lib.page === 0 ) {
			return Array.from(
				{ length: 8 },
				() => html`<div class="os-settings__library-tile os-settings__library-tile--skeleton"></div>`,
			);
		}
		if ( visible.length === 0 && ! lib.loading ) {
			return html`<p class="os-settings__library-empty">
				${ s.libraryHdOnly
					? __( 'No HD images found. Try unchecking the filter, or upload a larger image.' )
					: __( 'No images in your Media Library yet.' ) }
			</p>`;
		}
		return visible.map( ( item ) => libraryTile( s, item ) );
	};
	return html`
		<div class="os-settings__library">
			<div class="os-settings__library-toolbar">
				<input
					type="search"
					class="os-settings__library-search"
					placeholder=${ __( 'Search your media' ) }
					aria-label=${ __( 'Search media' ) }
					@input=${ onSearch }
				/>
				<os-checkbox-label
					label=${ sprintf(
						/* translators: 1: the HD minimum width in px, 2: the minimum height. */
						__( 'Only HD (≥%1$d×%2$d)' ),
						HD_MIN_WIDTH,
						HD_MIN_HEIGHT,
					) }
					?checked=${ s.libraryHdOnly }
					@os-checkbox-change=${ onHdToggle }
				></os-checkbox-label>
			</div>
			<div class="os-settings__library-grid">${ grid() }</div>
			<div class="os-settings__library-footer">
				<span class="os-settings__library-meta">${ parts.join( ' · ' ) }</span>
				<os-button
					variant="ghost"
					?hidden=${ lib.totalPages > 0 && lib.page >= lib.totalPages }
					?disabled=${ lib.loading }
					@click=${ () => void loadNextPage( ctx ) }
				>${ __( 'Load more' ) }</os-button>
			</div>
		</div>
	`;
};

// ------------------------------------------------------------ section

/** Which source the drawer shows; Upload when the user may upload. */
export function imageSource( ctx: Ctx ): 'upload' | 'library' {
	const ui = uiOf( ctx );
	if ( ui.imageSource ) {
		return ui.imageSource;
	}
	return ctx.data.canUpload ? 'upload' : 'library';
}

/**
 * The library fetches on first sight, not at mount: most sessions
 * never open the drawer. Called after every paint.
 */
export function syncLibrary( ctx: Ctx ): void {
	const ui = uiOf( ctx );
	if ( ! ui.imagePickerOpen || imageSource( ctx ) !== 'library' ) {
		return;
	}
	const lib = ui.library;
	if ( lib.page === 0 && ! lib.loading && ! lib.error ) {
		void loadNextPage( ctx );
	}
}

export const customImageSection: Section = ( s, ctx ) => {
	const canUpload = ctx.data.canUpload;
	const source = imageSource( ctx );
	const onTabChange = ( e: Event ): void => {
		const value = pickedValue( e );
		if ( value === 'upload' || value === 'library' ) {
			uiOf( ctx ).imageSource = value;
			ctx.repaint();
		}
	};
	// No heading. "Use your own image" is the dashed tile in the grid
	// above that opens this, and repeating it here names the same
	// thing twice within 40px.
	return html`
		<div class="os-settings__uploader">
			${ canUpload
				? html`<os-tabs value=${ source } label=${ __( 'Image source' ) } @os-tab-change=${ onTabChange }>
					<os-tab value="upload">${ __( 'Upload new' ) }</os-tab>
					<os-tab value="library">${ __( 'Media Library' ) }</os-tab>
				</os-tabs>`
				: '' }
			<div class="os-settings__tab-pane">
				${ source === 'upload' ? uploadPane( s, ctx ) : libraryPane( s, ctx ) }
			</div>
		</div>
	`;
};
