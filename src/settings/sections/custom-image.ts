/**
 * Custom-image section — the "Or use your own image" block beneath the
 * wallpaper swatch grid. Two tabs: "Upload new" (drag-drop + file
 * picker, disabled when the current user can't upload) and "Media
 * Library" (paginated REST grid with search + HD filter).
 */

import { __, sprintf } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	CUSTOM_IMAGE_ID,
	DEFAULT_WALLPAPER_ID,
	HD_MIN_HEIGHT,
	HD_MIN_WIDTH,
	SEARCH_DEBOUNCE_MS,
} from '../constants';
import { fetchMediaPage, uploadImage } from '../media-api';
import type { MediaItem, OsSettingsState, SettingsCtx } from '../types';
import { stripHtml } from '../utils';
import {
	refreshWallpaperPressedState,
	registerCustomImageIfPresent,
	selectWallpaper,
} from './wallpaper';

export function buildCustomImageSection(
	ctx: SettingsCtx,
	body: HTMLElement,
): HTMLElement {
	type TabKey = 'upload' | 'library';
	const tabDefs: { key: TabKey; label: string; render: () => void }[] = [];
	const pane = document.createElement( 'div' );
	pane.className = 'desktop-mode-os-settings__tab-pane';

	if ( ctx.config.canUpload ) {
		tabDefs.push( {
			key: 'upload',
			label: __( 'Upload new' ),
			render: () => renderUploadPane( ctx, pane, body ),
		} );
	}
	tabDefs.push( {
		key: 'library',
		label: __( 'Media Library' ),
		render: () => renderLibraryPane( ctx, pane, body ),
	} );

	const initialKey = tabDefs[ 0 ].key;
	const onTabChange = ( e: Event ): void => {
		const key = ( e as CustomEvent ).detail.value as TabKey;
		tabDefs.find( ( t ) => t.key === key )?.render();
	};

	const wrap = document.createElement( 'div' );
	render(
		html`
			<div class="desktop-mode-os-settings__uploader">
				<h4 class="desktop-mode-os-settings__uploader-heading">
					${ __( 'Or use your own image' ) }
				</h4>
				${ tabDefs.length > 1
		? html`<wpd-tabs
							value=${ initialKey }
							label=${ __( 'Image source' ) }
							@wpd-tab-change=${ onTabChange }
						>
							${ tabDefs.map(
		( def ) => html`<wpd-tab value=${ def.key }
									>${ def.label }</wpd-tab
								>`,
	) }
						</wpd-tabs>`
		: null }
				${ pane }
			</div>
		`,
		wrap,
	);

	// Paint the initial pane synchronously so the panel doesn't flash
	// empty before the first microtask flush.
	tabDefs.find( ( t ) => t.key === initialKey )?.render();
	return wrap.firstElementChild as HTMLElement;
}

function renderUploadPane(
	ctx: SettingsCtx,
	pane: HTMLElement,
	body: HTMLElement,
): void {
	const tile = document.createElement( 'div' );
	tile.className = 'desktop-mode-os-settings__upload-tile';
	tile.dataset.wallpaperId = CUSTOM_IMAGE_ID;
	tile.setAttribute(
		'aria-pressed',
		ctx.state.wallpaper === CUSTOM_IMAGE_ID ? 'true' : 'false',
	);

	const fileInput = document.createElement( 'input' );
	fileInput.type = 'file';
	fileInput.accept = 'image/*';
	fileInput.className = 'desktop-mode-os-settings__file-input';
	fileInput.addEventListener( 'change', () => {
		const file = fileInput.files?.[ 0 ];
		if ( file ) {
			void handleImageFile( ctx, file, tile, body );
		}
		fileInput.value = '';
	} );

	render( html`${ fileInput }${ tile }`, pane );
	renderUploadTile( ctx, tile, fileInput, body );
}

function renderUploadTile(
	ctx: SettingsCtx,
	tile: HTMLElement,
	fileInput: HTMLInputElement,
	body: HTMLElement,
): void {
	tile.classList.remove( 'desktop-mode-os-settings__upload-tile--filled' );
	tile.classList.remove( 'desktop-mode-os-settings__upload-tile--dragover' );
	tile.classList.remove( 'desktop-mode-os-settings__upload-tile--busy' );
	tile.removeAttribute( 'aria-label' );

	const hasImage = !! ctx.state.customImage;
	if ( hasImage ) {
		tile.classList.add( 'desktop-mode-os-settings__upload-tile--filled' );
		tile.setAttribute( 'aria-label', __( 'Custom image wallpaper' ) );
		tile.style.backgroundImage = `url("${ encodeURI( ctx.state.customImage!.url ) }")`;
	} else {
		tile.style.backgroundImage = '';
		tile.setAttribute( 'aria-label', __( 'Upload a wallpaper image' ) );
	}

	const onRemove = ( e: Event ): void => {
		e.stopPropagation();
		ctx.state.customImage = null;
		// If the image was the active wallpaper, fall back to the
		// default preset so the user isn't left with an unreadable
		// blank desktop the moment they hit remove.
		if ( ctx.state.wallpaper === CUSTOM_IMAGE_ID ) {
			ctx.state.wallpaper = DEFAULT_WALLPAPER_ID;
		}
		registerCustomImageIfPresent( ctx.state );
		ctx.save();
		ctx.apply();
		renderUploadTile( ctx, tile, fileInput, body );
		refreshWallpaperPressedState( ctx, body );
	};

	render(
		hasImage
			? html`
					<wpd-button
						variant="danger"
						class="desktop-mode-os-settings__upload-remove"
						aria-label=${ __( 'Remove custom image' ) }
						@click=${ onRemove }
						>${ __( 'Remove' ) }</wpd-button
					>
				`
			: html`
					<div class="desktop-mode-os-settings__upload-inner">
						<span
							class="desktop-mode-os-settings__upload-plus"
							aria-hidden="true"
							>+</span
						>
						<span class="desktop-mode-os-settings__upload-prompt"
							>${ __( 'Drop an image here, or click to upload' ) }</span
						>
						<span class="desktop-mode-os-settings__upload-hint"
							>${ __(
		'JPEG, PNG, or WebP · goes straight to your Media Library',
	) }</span
						>
					</div>
				`,
		tile,
	);

	tile.onclick = () => {
		if ( tile.classList.contains( 'desktop-mode-os-settings__upload-tile--busy' ) ) {
			return;
		}
		if ( ctx.state.customImage ) {
			selectWallpaper( ctx, CUSTOM_IMAGE_ID, body );
			return;
		}
		fileInput.click();
	};

	tile.ondragover = ( e ) => {
		e.preventDefault();
		tile.classList.add( 'desktop-mode-os-settings__upload-tile--dragover' );
	};
	tile.ondragleave = () => {
		tile.classList.remove( 'desktop-mode-os-settings__upload-tile--dragover' );
	};
	tile.ondrop = ( e ) => {
		e.preventDefault();
		tile.classList.remove( 'desktop-mode-os-settings__upload-tile--dragover' );
		const file = e.dataTransfer?.files?.[ 0 ];
		if ( file ) {
			void handleImageFile( ctx, file, tile, body );
		}
	};
}

async function handleImageFile(
	ctx: SettingsCtx,
	file: File,
	tile: HTMLElement,
	body: HTMLElement,
): Promise<void> {
	if ( ! file.type.startsWith( 'image/' ) ) {
		showUploadError( tile, __( 'That file isn’t an image.' ) );
		return;
	}

	tile.classList.add( 'desktop-mode-os-settings__upload-tile--busy' );
	render(
		html`<span class="desktop-mode-os-settings__upload-status"
			>${ __( 'Uploading…' ) }</span
		>`,
		tile,
	);

	const fileInput = tile.parentElement?.querySelector<HTMLInputElement>(
		'.desktop-mode-os-settings__file-input',
	);

	try {
		const media = await uploadImage( ctx.config, file );
		ctx.state.customImage = { id: media.id, url: media.url };
		ctx.state.wallpaper = CUSTOM_IMAGE_ID;
		registerCustomImageIfPresent( ctx.state );
		ctx.save();
		ctx.apply();
		if ( fileInput ) {
			renderUploadTile( ctx, tile, fileInput, body );
		}
		refreshWallpaperPressedState( ctx, body );
	} catch ( err ) {
		tile.classList.remove( 'desktop-mode-os-settings__upload-tile--busy' );
		if ( fileInput ) {
			renderUploadTile( ctx, tile, fileInput, body );
		}
		const message = err instanceof Error ? err.message : __( 'Upload failed.' );
		showUploadError( tile, message );
	}
}

function showUploadError( tile: HTMLElement, message: string ): void {
	let err = tile.querySelector<HTMLElement>( '.desktop-mode-os-settings__upload-error' );
	if ( ! err ) {
		err = document.createElement( 'span' );
		err.className = 'desktop-mode-os-settings__upload-error';
		err.setAttribute( 'role', 'status' );
		tile.appendChild( err );
	}
	err.textContent = message;
	window.setTimeout( () => {
		err?.remove();
	}, 4000 );
}

function renderLibraryPane(
	ctx: SettingsCtx,
	pane: HTMLElement,
	body: HTMLElement,
): void {
	// These four nodes are kept stable across paints so that:
	//   - the search input preserves focus + caret position while
	//     the user is typing,
	//   - the grid doesn't reset scroll on re-render,
	//   - the load-more button's event listener survives.
	// Their internal content is mutated imperatively below; the
	// surrounding structure is declarative.
	const search = document.createElement( 'input' );
	search.type = 'search';
	search.placeholder = __( 'Search your media' );
	search.className = 'desktop-mode-os-settings__library-search';
	search.setAttribute( 'aria-label', __( 'Search media' ) );

	const grid = document.createElement( 'div' );
	grid.className = 'desktop-mode-os-settings__library-grid';

	const meta = document.createElement( 'span' );
	meta.className = 'desktop-mode-os-settings__library-meta';

	const loadMore = document.createElement( 'wpd-button' );
	loadMore.setAttribute( 'variant', 'ghost' );
	loadMore.textContent = __( 'Load more' );

	let query = '';
	let page = 0;
	let totalPages = 0;
	let loaded: MediaItem[] = [];
	let hiddenByHd = 0;
	let loading = false;

	const onHdToggle = ( e: Event ): void => {
		ctx.state.libraryHdOnly = ( e as CustomEvent ).detail.checked;
		ctx.save();
		resetAndReload();
	};

	render(
		html`
			<div class="desktop-mode-os-settings__library">
				<div class="desktop-mode-os-settings__library-toolbar">
					${ search }
					<wpd-checkbox-label
						label=${ sprintf(
		// translators: %1$d is the HD minimum width in px, %2$d is the minimum height.
		__( 'Only HD (≥%1$d×%2$d)' ),
		HD_MIN_WIDTH,
		HD_MIN_HEIGHT,
	) }
						?checked=${ ctx.state.libraryHdOnly }
						@wpd-checkbox-change=${ onHdToggle }
					></wpd-checkbox-label>
				</div>
				${ grid }
				<div class="desktop-mode-os-settings__library-footer">
					${ meta }${ loadMore }
				</div>
			</div>
		`,
		pane,
	);

	const updateMeta = (): void => {
		const visible = visibleLibraryItems( ctx.state, loaded ).length;
		const parts = [
			// translators: %d is the number of media items currently visible.
			sprintf( __( 'Showing %d' ), visible ),
		];
		if ( ctx.state.libraryHdOnly && hiddenByHd > 0 ) {
			parts.push(
				// translators: %d is the number of images filtered out by the HD toggle.
				sprintf( __( '%d hidden by HD filter' ), hiddenByHd ),
			);
		}
		meta.textContent = parts.join( ' · ' );
		// hidden applies to any HTMLElement; `disabled` is a wpd-button
		// prop that maps to the inner <button>'s disabled attribute via
		// the component's render.
		loadMore.hidden = page >= totalPages;
		if ( loading ) {
			loadMore.setAttribute( 'disabled', '' );
		} else {
			loadMore.removeAttribute( 'disabled' );
		}
	};

	const renderGrid = (): void => {
		const visible = visibleLibraryItems( ctx.state, loaded );
		hiddenByHd = loaded.length - visible.length;

		if ( visible.length === 0 && ! loading ) {
			render(
				html`<p class="desktop-mode-os-settings__library-empty">
					${ ctx.state.libraryHdOnly
		? __(
			'No HD images found. Try unchecking the filter, or upload a larger image.',
		)
		: __( 'No images in your Media Library yet.' ) }
				</p>`,
				grid,
			);
		} else {
			grid.innerHTML = '';
			for ( const item of visible ) {
				grid.appendChild( buildLibraryTile( ctx, item, body ) );
			}
		}
		updateMeta();
	};

	const loadNextPage = async (): Promise<void> => {
		if ( loading || ( totalPages > 0 && page >= totalPages ) ) {
			return;
		}
		loading = true;
		updateMeta();

		if ( page === 0 ) {
			render(
				html`${ Array.from(
					{ length: 8 },
					() => html`<div
						class="desktop-mode-os-settings__library-tile desktop-mode-os-settings__library-tile--skeleton"
					></div>`,
				) }`,
				grid,
			);
		}

		try {
			const result = await fetchMediaPage(
				ctx.config,
				page + 1,
				query,
				ctx.state.libraryHdOnly,
			);
			page = page + 1;
			totalPages = result.totalPages;
			loaded = loaded.concat( result.items );
			renderGrid();
		} catch ( err ) {
			render(
				html`<p class="desktop-mode-os-settings__library-error">
					${ err instanceof Error
		? sprintf(
			// translators: %s is the browser-supplied error message.
			__( 'Couldn’t load your media: %s' ),
			err.message,
		)
		: __( 'Couldn’t load your media.' ) }
				</p>`,
				grid,
			);
		} finally {
			loading = false;
			updateMeta();
		}
	};

	const resetAndReload = (): void => {
		page = 0;
		totalPages = 0;
		loaded = [];
		hiddenByHd = 0;
		void loadNextPage();
	};

	let searchTimer: number | null = null;
	search.addEventListener( 'input', () => {
		if ( searchTimer !== null ) {
			window.clearTimeout( searchTimer );
		}
		searchTimer = window.setTimeout( () => {
			searchTimer = null;
			query = search.value.trim();
			resetAndReload();
		}, SEARCH_DEBOUNCE_MS ) as unknown as number;
	} );

	loadMore.addEventListener( 'click', () => {
		void loadNextPage();
	} );

	void loadNextPage();
}

function visibleLibraryItems(
	state: OsSettingsState,
	items: MediaItem[],
): MediaItem[] {
	if ( ! state.libraryHdOnly ) {
		return items;
	}
	return items.filter(
		( it ) =>
			it.media_details.width >= HD_MIN_WIDTH &&
			it.media_details.height >= HD_MIN_HEIGHT,
	);
}

function buildLibraryTile(
	ctx: SettingsCtx,
	item: MediaItem,
	body: HTMLElement,
): HTMLElement {
	const isSelected =
		ctx.state.wallpaper === CUSTOM_IMAGE_ID &&
		ctx.state.customImage?.id === item.id;

	const sizes = item.media_details.sizes || {};
	const thumbUrl =
		sizes.medium?.source_url ||
		sizes.thumbnail?.source_url ||
		sizes.large?.source_url ||
		item.source_url;

	const altOrTitle =
		item.alt_text ||
		stripHtml( item.title?.rendered || '' ) ||
		`Image #${ item.id }`;

	const onClick = (): void => {
		ctx.state.customImage = { id: item.id, url: item.source_url };
		ctx.state.wallpaper = CUSTOM_IMAGE_ID;
		registerCustomImageIfPresent( ctx.state );
		ctx.save();
		ctx.apply();
		refreshWallpaperPressedState( ctx, body );
		// Sibling tiles un-select themselves — the active selection
		// drives aria-pressed + visual state per tile, but only the
		// clicked tile re-renders automatically, so we fix the rest.
		const tileGrid = wrapper.firstElementChild?.parentElement;
		if ( tileGrid ) {
			tileGrid.querySelectorAll<HTMLElement>( '[data-media-id]' ).forEach( ( el ) => {
				const selected = el.dataset.mediaId === String( item.id );
				el.setAttribute( 'aria-pressed', selected ? 'true' : 'false' );
				el.classList.toggle(
					'desktop-mode-os-settings__library-tile--selected',
					selected,
				);
			} );
		}
	};

	const wrapper = document.createElement( 'div' );
	render(
		html`
			<button
				type="button"
				class=${ isSelected
		? 'desktop-mode-os-settings__library-tile desktop-mode-os-settings__library-tile--selected'
		: 'desktop-mode-os-settings__library-tile' }
				data-media-id=${ String( item.id ) }
				aria-pressed=${ isSelected ? 'true' : 'false' }
				aria-label=${ altOrTitle }
				title=${ altOrTitle }
				style=${ `background-image: url("${ encodeURI( thumbUrl ) }")` }
				@click=${ onClick }
			>
				<span class="desktop-mode-os-settings__library-tile-dims"
					>${ item.media_details.width }×${ item.media_details.height }</span
				>
			</button>
		`,
		wrapper,
	);
	return wrapper.firstElementChild as HTMLElement;
}
