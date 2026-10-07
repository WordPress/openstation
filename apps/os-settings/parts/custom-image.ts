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
import { restErrorFromResponse } from '../../../src/core/api-client';
import { describeRestFailure } from '../../../src/core/rest-failure';
import { settings, update } from './store';
import { extraOf, pickedChecked, pickedValue, uiOf, type Ctx, type Section } from './types';

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

function sanitizeFilename( name: string ): string {
	const cleaned = name.replace( /[^a-zA-Z0-9._-]+/g, '-' ).replace( /^-+|-+$/g, '' );
	return cleaned || 'wallpaper';
}

function isUsableImage( item: MediaItem ): boolean {
	if ( ! item || typeof item.id !== 'number' || ! item.source_url ) {
		return false;
	}
	const d = item.media_details;
	return !! d && typeof d.width === 'number' && typeof d.height === 'number' && d.width > 0 && d.height > 0;
}

function stripHtml( markup: string ): string {
	if ( ! markup ) {
		return '';
	}
	const el = document.createElement( 'div' );
	el.innerHTML = markup;
	return el.textContent?.trim() || '';
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
		throw await restErrorFromResponse( response );
	}
	const totalPagesHeader = response.headers.get( 'X-WP-TotalPages' );
	const totalPages = totalPagesHeader ? parseInt( totalPagesHeader, 10 ) : 1;
	const items = ( await response.json() ) as MediaItem[];
	return { items: items.filter( isUsableImage ), totalPages: totalPages || 1 };
}

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
		throw await restErrorFromResponse( response );
	}
	const data = ( await response.json() ) as { id: number; source_url: string };
	return { id: data.id, url: data.source_url };
}

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
		fail( describeRestFailure( err, { fallback: __( 'Upload failed.' ) } ).message );
	} finally {
		lib.uploading = false;
		ctx.repaint();
	}
}

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

function visibleLibraryItems( s: OsSettingsState, items: MediaItem[] ): MediaItem[] {
	if ( ! s.libraryHdOnly ) {
		return items;
	}
	return items.filter(
		( it ) => it.media_details.width >= HD_MIN_WIDTH && it.media_details.height >= HD_MIN_HEIGHT,
	);
}

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
		lib.error = describeRestFailure( err, {
			lead: __( 'Couldn’t load your media' ),
			fallback: __( 'Couldn’t load your media.' ),
		} ).message;
	} finally {
		lib.loading = false;
		ctx.repaint();
	}
}

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

		sprintf( __( 'Showing %d' ), visible.length ),
	];
	if ( s.libraryHdOnly && hiddenByHd > 0 ) {
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

export function imageSource( ctx: Ctx ): 'upload' | 'library' {
	const ui = uiOf( ctx );
	if ( ui.imageSource ) {
		return ui.imageSource;
	}
	return ctx.data.canUpload ? 'upload' : 'library';
}

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
