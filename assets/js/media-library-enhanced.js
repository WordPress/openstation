/**
 * OpenStation — Media Library drag-and-drop enhancement.
 *
 * Injects draggable=true on every .attachment tile in the WordPress
 * Media Library (grid view AND modal view) and wires a dragstart
 * handler that populates DataTransfer with multiple MIME types so the
 * drag works in many drop targets:
 *
 *   text/plain                           — the attachment URL
 *   text/uri-list                        — same URL, standards-compliant
 *   text/html                            — <img> tag for images,
 *                                          <a> tag for other files,
 *                                          so rich text editors
 *                                          (TinyMCE, contenteditable)
 *                                          natively accept the drop
 *   application/x-wp-media-attachment    — JSON blob with id, url,
 *                                          title, alt, mime, sizes —
 *                                          for WP-aware drop zones
 *                                          that want the full record
 *
 * The script is a vanilla IIFE with no build step. It is intentionally
 * defensive:
 *
 *   - runs only when wp.media exists,
 *   - idempotent (each tile is enhanced at most once),
 *   - uses a MutationObserver so tiles added later (user switches
 *     folder, scrolls, opens a different media frame) are enhanced
 *     too,
 *   - never removes or interferes with WordPress's own click / focus
 *     handlers on the tile.
 */

( function () {
	'use strict';

	// `start()` runs unconditionally — `wp.media` is only required by
	// the grid + detail enhancers (those selectors won't match on
	// pages that don't load the Backbone media library). The list-
	// view delegated handler uses DOM-only fallbacks (row markup +
	// thumbnail src + anchor href) and works without `wp.media`,
	// which is the case on `upload.php?mode=list` — the list table
	// is a server-rendered `WP_List_Table`, no media-views.js bundle.
	//
	// If `wp.media` arrives later (e.g. a modal opens and pulls it
	// in), the MutationObserver picks up the freshly-rendered grid
	// tiles and runs `enhance()` on them — at which point the
	// grid-side `wp.media.attachment()` lookup is safe.
	start();

	// Flag set during our own attachment drags so the capture-phase
	// blocker below can distinguish between "user is dragging a file
	// from the OS" (which the WP uploader should handle) and "user is
	// dragging a pre-existing attachment tile" (which the uploader
	// must NOT intercept — otherwise it tries to re-upload it).
	var dragInProgress = false;

	// CSS selectors for the two enhancement paths:
	//   - GRID_SELECTOR matches the small tiles in the library grid and
	//     in the media modal's left-hand attachments browser.
	//   - DETAIL_SELECTOR matches the BIG preview in the right-hand
	//     details sidebar of the media modal, and the dedicated single-
	//     attachment edit page at `upload.php?item=ID`. WP renders the
	//     image inside a `.thumbnail` wrapper that has its own click
	//     handlers (swap-into-edit, set-as-featured, etc.) — the user
	//     reported that without explicit enhancement here the browser
	//     refuses to start a native drag from the big preview.
	var GRID_SELECTOR = '.attachment';
	var DETAIL_SELECTOR = '.attachment-details, .edit-attachment-frame';
	// `upload.php?mode=list` renders attachments inside `table.media`.
	// Each `tbody tr[id^="post-"]` is one attachment row. Scoped to
	// the `.media` table class so we don't enhance unrelated WP list
	// tables (Posts, Pages, …) that share the same row-id convention.
	var LIST_SELECTOR = 'table.media tbody tr[id^="post-"]';

	function start() {
		// Enhance whatever's already on the page.
		document.querySelectorAll( GRID_SELECTOR ).forEach( enhance );
		document.querySelectorAll( DETAIL_SELECTOR ).forEach( enhanceDetail );
		// List view uses event delegation (no per-row wiring) — install
		// once and the dragstart handler picks up rows that arrive
		// later (pagination, search, mode-switch).
		installListDelegation();

		// Watch for new tiles + detail panes + list rows. Grid is a
		// Backbone collection view that appends tiles on scroll /
		// filter / modal open; the detail sidebar swaps content on
		// every attachment pick; the list view refreshes rows on
		// pagination / search. MutationObserver on the body catches
		// all of them.
		var observer = new MutationObserver( function ( mutations ) {
			for ( var i = 0; i < mutations.length; i++ ) {
				var added = mutations[ i ].addedNodes;
				for ( var j = 0; j < added.length; j++ ) {
					var node = added[ j ];
					if ( node.nodeType !== 1 ) {
						continue;
					}
					if ( node.matches && node.matches( GRID_SELECTOR ) ) {
						enhance( node );
					}
					if ( node.matches && node.matches( DETAIL_SELECTOR ) ) {
						enhanceDetail( node );
					}
					if ( node.matches && node.matches( LIST_SELECTOR ) ) {
						enhanceListRow( node );
					}
					if ( node.querySelectorAll ) {
						node.querySelectorAll( GRID_SELECTOR ).forEach( enhance );
						node.querySelectorAll( DETAIL_SELECTOR ).forEach( enhanceDetail );
						node.querySelectorAll( LIST_SELECTOR ).forEach( enhanceListRow );
					}
				}
			}
		} );
		observer.observe( document.body, { childList: true, subtree: true } );

		installUploaderBlock();
	}

	/**
	 * Install capture-phase interceptors that stop drag events from
	 * reaching WordPress's Plupload dropzones while an attachment
	 * drag is in flight. Plupload doesn't check DataTransfer.types
	 * for the "Files" entry before claiming a drop, so without this
	 * it treats our attachment drag as a new-file upload attempt.
	 */
	function installUploaderBlock() {
		// Every uploader dropzone class WP core uses. `.drag-drop-area`
		// is the text-and-icon panel inside the full-screen overlay;
		// `.uploader-window` is the overlay itself; `.uploader-inline`
		// and `.uploader-editor` cover the modal and classic-editor
		// variants respectively.
		var UPLOADER_SELECTOR = [
			'.uploader-window',
			'.uploader-inline',
			'.uploader-editor',
			'.drag-drop-area',
			'.wp-uploader'
		].join( ',' );

		var block = function ( e ) {
			if ( ! dragInProgress ) {
				return;
			}
			var t = e.target;
			if ( ! t || typeof t.closest !== 'function' ) {
				return;
			}
			if ( t.closest( UPLOADER_SELECTOR ) ) {
				// Capture phase — fires before the uploader's own
				// handler, so stopImmediatePropagation means the
				// uploader never sees the event and therefore never
				// calls preventDefault() to claim the drop.
				e.stopImmediatePropagation();
				if ( e.type === 'drop' || e.type === 'dragend' ) {
					e.preventDefault();
				}
			}
		};

		document.addEventListener( 'dragenter', block, true );
		document.addEventListener( 'dragover',  block, true );
		document.addEventListener( 'dragleave', block, true );
		document.addEventListener( 'drop',      block, true );

		// Inject a tiny stylesheet that hides the uploader overlay
		// while our drag is active. Belt-and-braces: even if the
		// capture listener above misses an event, the UI won't flash
		// the "Drop files here" overlay — nothing visible to signal
		// to the user that a re-upload is about to happen.
		var style = document.createElement( 'style' );
		style.textContent =
			'body.os-dragging-attachment .uploader-window,' +
			'body.os-dragging-attachment .uploader-window-content,' +
			'body.os-dragging-attachment .uploader-editor-content,' +
			'body.os-dragging-attachment .wp-uploader {' +
			'  display: none !important;' +
			'  pointer-events: none !important;' +
			'}';
		document.head.appendChild( style );
	}

	/**
	 * Make a single .attachment tile draggable. Idempotent.
	 *
	 * @param {HTMLElement} el The .attachment element.
	 */
	function enhance( el ) {
		if ( el.dataset.osDraggable === '1' ) {
			return;
		}
		el.dataset.osDraggable = '1';
		el.setAttribute( 'draggable', 'true' );

		el.addEventListener( 'dragstart', function ( e ) {
			var id = parseInt( el.getAttribute( 'data-id' ) || el.dataset.id || '0', 10 );
			if ( ! id ) {
				return;
			}
			var model = wp.media.attachment( id );
			var a = ( model && model.attributes ) ? model.attributes : {};
			var url = resolveOriginalUrl( a, scrapeUrl( el ) );
			var title = a.title || scrapeTitle( el );
			if ( ! url ) {
				e.preventDefault();
				return;
			}
			populateDragTransfer( e, el, {
				id: id,
				url: url,
				title: title,
				alt: a.alt || title,
				mime: a.mime || a.mimeType || '',
				sizes: a.sizes || {},
			} );
		} );

		el.addEventListener( 'dragend', onDragEnd );
	}

	/**
	 * Detail-view path — the BIG preview shown in the media modal's
	 * right-hand sidebar AND the dedicated single-attachment edit page
	 * at `upload.php?item=ID`. The grid-tile `enhance()` selector
	 * (`.attachment`) doesn't reach these containers, so without this
	 * companion the user can drag from the library grid but not from
	 * the detail view.
	 *
	 * The container itself is made `draggable=true`. Setting it on the
	 * wrapper rather than the inner `<img>` is intentional: the inner
	 * thumbnail has WP click handlers (swap-into-edit, set-as-featured)
	 * that can call `preventDefault` on `mousedown` and abort the
	 * browser's native image-drag before it gets a chance to start.
	 * Hoisting `draggable` to the parent gives us a clean handle and
	 * the `<img>` inside acts as the drag image.
	 *
	 * @param {HTMLElement} el The `.attachment-details` or
	 *                         `.edit-attachment-frame` container.
	 */
	function enhanceDetail( el ) {
		if ( el.dataset.osDraggable === '1' ) {
			return;
		}
		el.dataset.osDraggable = '1';
		el.setAttribute( 'draggable', 'true' );

		el.addEventListener( 'dragstart', function ( e ) {
			var id = resolveDetailId( el );
			var model = id ? wp.media.attachment( id ) : null;
			var a = ( model && model.attributes ) ? model.attributes : {};

			var img = el.querySelector(
				'.thumbnail img, .attachment-media-view img, .details-image, img'
			);
			var fallbackUrl = img && ( img.currentSrc || img.src ) || '';
			var url = resolveOriginalUrl( a, fallbackUrl );
			if ( ! url ) {
				e.preventDefault();
				return;
			}
			var title = a.title
				|| scrapeDetailTitle( el )
				|| ( img && ( img.alt || img.title ) )
				|| '';

			populateDragTransfer( e, el, {
				id: id || 0,
				url: url,
				title: title,
				alt: a.alt || title,
				mime: a.mime || a.mimeType || guessMimeFromUrl( url ),
				sizes: a.sizes || {},
			} );
		} );

		el.addEventListener( 'dragend', onDragEnd );
	}

	/**
	 * List-view path — `upload.php?mode=list` renders attachments in
	 * a `wp-list-table` instead of the grid. Each row carries the
	 * attachment id in its DOM id (`post-{id}`) and the thumbnail
	 * lives inside `<a><span class="media-icon"><img></span></a>`
	 * in the title cell. Without this companion the user can drag
	 * from the grid but the list-view drag is silently lost.
	 *
	 * Per-row enhancement loses against the browser's default
	 * native drag — `<a>` and `<img>` are both `draggable=true` by
	 * default, and Chromium's behaviour for "the innermost
	 * draggable element wins" is fragile under runtime
	 * `draggable=false` attribute changes. The delegated
	 * `dragstart` listener below sidesteps the whole "which element
	 * owns the drag" question: the event bubbles from wherever the
	 * browser decides to start it, and we re-populate the transfer
	 * with our payload + post the bridge handshake. Whatever the
	 * browser's default drag put in `DataTransfer` (the img's URL,
	 * the anchor's href) gets overwritten by our `setData` calls in
	 * the same event.
	 *
	 * Mounted ONCE per page (sentinel-guarded) from `start()`. No
	 * per-row work, no MutationObserver bookkeeping for list rows.
	 */
	var LIST_DELEGATION_INSTALLED = false;
	function installListDelegation() {
		if ( LIST_DELEGATION_INSTALLED ) {
			return;
		}
		LIST_DELEGATION_INSTALLED = true;
		document.body.addEventListener( 'dragstart', function ( e ) {
			var target = e.target;
			if ( ! target || ! target.closest ) {
				return;
			}
			var row = target.closest( LIST_SELECTOR );
			if ( ! row ) {
				return;
			}
			var id = parseInt( ( row.id || '' ).replace( /^post-/, '' ), 10 );
			if ( ! id ) {
				return;
			}
			// `wp.media` isn't loaded on `upload.php?mode=list` (the
			// list table is server-rendered, no Backbone media bundle).
			// Skip the model lookup when it's absent — the DOM
			// fallbacks below (`rowImg.src`, `rowAnchor.href`,
			// `rowAnchor.textContent`) give us everything the
			// receiver needs to insert a `core/image` block.
			var model =
				window.wp &&
				window.wp.media &&
				typeof window.wp.media.attachment === 'function'
					? window.wp.media.attachment( id )
					: null;
			var a = ( model && model.attributes ) ? model.attributes : {};

			// Fallbacks — the list view doesn't pre-warm wp.media's
			// attachment cache the way the grid does, so any of
			// `model.url` / `model.title` may be missing on first
			// drag. Pull from the row markup instead.
			var rowImg = row.querySelector( '.media-icon img, img' );
			var rowAnchor = row.querySelector( 'a.row-title, .column-title a' );
			var url = resolveOriginalUrl( a, '' )
				|| ( rowImg && ( rowImg.currentSrc || rowImg.src ) )
				|| ( rowAnchor && rowAnchor.getAttribute( 'href' ) )
				|| '';
			if ( ! url ) {
				return;
			}
			var title = a.title
				|| ( rowAnchor && rowAnchor.textContent.trim() )
				|| '';

			populateDragTransfer( e, row, {
				id: id,
				url: url,
				title: title,
				alt: a.alt || title,
				mime: a.mime || a.mimeType || guessMimeFromUrl( url ),
				sizes: a.sizes || {},
			} );
		}, true );

		// `dragend` cleanup runs once per drag — same delegation.
		document.body.addEventListener( 'dragend', function ( e ) {
			var target = e.target;
			if ( ! target || ! target.closest ) {
				return;
			}
			if ( ! target.closest( LIST_SELECTOR ) ) {
				return;
			}
			onDragEnd();
		}, true );
	}

	/** Compat shim — the start() walk still calls enhanceListRow. */
	function enhanceListRow() {
		installListDelegation();
	}

	/**
	 * Shared tail of every dragstart handler: arm the uploader-block
	 * interceptor, populate DataTransfer with text/uri-list + text/html
	 * + the WP-aware custom MIME, and postMessage the payload up to the
	 * parent shell so the cross-iframe bridge has it.
	 *
	 * @param {DragEvent}    e
	 * @param {HTMLElement}  sourceEl  The element being dragged (for
	 *                                 the drag image fallback).
	 * @param {{id:number,url:string,title:string,alt:string,
	 *         mime:string,sizes:object,thumbnailUrl?:string}} record
	 */
	function populateDragTransfer( e, sourceEl, record ) {
		dragInProgress = true;
		document.body.classList.add( 'os-dragging-attachment' );

		var url = record.url;
		var title = record.title;
		var alt = record.alt || title;
		var mime = record.mime || '';
		var thumbnailUrl = record.thumbnailUrl
			|| ( record.sizes && record.sizes.thumbnail && record.sizes.thumbnail.url )
			|| url;

		try {
			e.dataTransfer.setData( 'text/plain', url );
			e.dataTransfer.setData( 'text/uri-list', url );

			if ( mime.indexOf( 'image/' ) === 0 ) {
				e.dataTransfer.setData(
					'text/html',
					'<img src="' + escapeAttr( url ) + '" alt="' + escapeAttr( alt ) + '" />'
				);
			} else {
				e.dataTransfer.setData(
					'text/html',
					'<a href="' + escapeAttr( url ) + '">' + escapeHtml( title || url ) + '</a>'
				);
			}

			e.dataTransfer.setData(
				'application/x-wp-media-attachment',
				JSON.stringify( {
					id: record.id,
					url: url,
					title: title,
					alt: alt,
					mime: mime,
					sizes: record.sizes || {},
				} )
			);

			e.dataTransfer.effectAllowed = 'copy';

			var thumb = sourceEl.querySelector( 'img' );
			if ( thumb && thumb.complete && thumb.naturalWidth > 0 ) {
				e.dataTransfer.setDragImage( thumb, thumb.width / 2, thumb.height / 2 );
			}
		} catch ( err ) {
			// setData can throw in older browsers or under hostile CSP.
		}

		try {
			if ( window.parent && window.parent !== window ) {
				window.parent.postMessage( {
					type: 'os-drag-start',
					payload: {
						id: record.id,
						url: url,
						title: title,
						alt: alt,
						mime: mime,
						sizes: record.sizes || {},
						thumbnailUrl: thumbnailUrl,
					},
				}, window.location.origin );
			}
		} catch ( postErr ) {
			// Cross-origin parent or sandboxed frame — the drag still
			// works via native DataTransfer.
		}
	}

	function onDragEnd() {
		dragInProgress = false;
		document.body.classList.remove( 'os-dragging-attachment' );
		try {
			if ( window.parent && window.parent !== window ) {
				window.parent.postMessage(
					{ type: 'os-drag-end' },
					window.location.origin
				);
			}
		} catch ( err ) { /* swallow */ }
	}

	/**
	 * Resolve the attachment id for a detail-view container. WP exposes
	 * it in several places depending on the surface:
	 *
	 *   - Modal sidebar: `<div class="attachment-details" data-id="N">`
	 *   - Single-attachment page: `?item=N` in the URL, or a hidden
	 *     `#post_ID` input emitted by the post editor.
	 *
	 * Returns 0 when no id can be found — `populateDragTransfer`
	 * tolerates id=0 and still ships a working drag using the
	 * scraped URL.
	 */
	function resolveDetailId( el ) {
		var raw = el.getAttribute( 'data-id' )
			|| ( el.dataset && el.dataset.id )
			|| '';
		var n = parseInt( raw, 10 );
		if ( n ) return n;

		try {
			var q = new URLSearchParams( window.location.search );
			n = parseInt( q.get( 'item' ) || q.get( 'post' ) || '0', 10 );
			if ( n ) return n;
		} catch ( err ) { /* old browser */ }

		var hidden = document.getElementById( 'post_ID' );
		if ( hidden && hidden.value ) {
			n = parseInt( hidden.value, 10 );
			if ( n ) return n;
		}
		return 0;
	}

	function scrapeDetailTitle( el ) {
		var input = el.querySelector( '[data-setting="title"] input, #title' );
		if ( input && input.value ) return input.value;
		var filename = el.querySelector( '.filename, .filename .file' );
		return filename ? filename.textContent.trim() : '';
	}

	/**
	 * Resolve the most-original URL for an attachment, in order:
	 *
	 *   1. `originalImageURL` from the model — WP 5.3+ exposes this
	 *      when the uploaded image was big enough to trigger the
	 *      `-scaled` derivative. It points at the un-scaled original.
	 *   2. The model's `url`, with WP-generated suffixes stripped:
	 *      `-WxH` size variants AND the `-scaled` marker (both, in
	 *      either order, anchored to the extension).
	 *   3. The DOM-scraped fallback (the thumbnail src), with the
	 *      same suffix normalisation.
	 *
	 * Returns '' when nothing is available.
	 *
	 * @param {object} attrs    The attachment model's `attributes`.
	 * @param {string} fallback URL scraped from the DOM (thumbnail).
	 * @return {string}
	 */
	function resolveOriginalUrl( attrs, fallback ) {
		if ( attrs && attrs.originalImageURL ) {
			return attrs.originalImageURL;
		}
		var candidate = ( attrs && attrs.url ) || fallback || '';
		return stripSizeSuffix( candidate );
	}

	/**
	 * Strip `-WxH` (e.g. `-300x167`) and `-scaled` suffixes immediately
	 * before the file extension, preserving any query string / fragment.
	 *
	 *   foo-300x167.jpg          → foo.jpg
	 *   foo-scaled.jpg           → foo.jpg
	 *   foo-300x167-scaled.jpg   → foo.jpg
	 *   foo.jpg?ver=1            → foo.jpg?ver=1
	 *   foo.jpg                  → foo.jpg
	 */
	function stripSizeSuffix( url ) {
		if ( ! url ) return url;
		return url.replace(
			/(-\d+x\d+)?(-scaled)?(\.[a-z0-9]+)(\?[^#]*)?(#.*)?$/i,
			function ( _m, _wh, _sc, ext, query, hash ) {
				return ext + ( query || '' ) + ( hash || '' );
			}
		);
	}

	function guessMimeFromUrl( url ) {
		var m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec( url || '' );
		var ext = m ? m[ 1 ].toLowerCase() : '';
		var IMG = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, avif: 1, svg: 1 };
		if ( IMG[ ext ] ) {
			return 'image/' + ( ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext );
		}
		return '';
	}

	// ---------------------------------------------------------------
	// Helpers — DOM scrape fallbacks, HTML/attribute escaping.
	// ---------------------------------------------------------------

	function scrapeUrl( el ) {
		var img = el.querySelector( 'img' );
		if ( img && img.src ) {
			return img.src;
		}
		var a = el.querySelector( 'a[href]' );
		return a ? a.getAttribute( 'href' ) : '';
	}

	function scrapeTitle( el ) {
		var filename = el.querySelector( '.filename, .media-filename' );
		if ( filename && filename.textContent ) {
			return filename.textContent.trim();
		}
		var img = el.querySelector( 'img' );
		return img ? ( img.alt || img.title || '' ) : '';
	}

	function escapeAttr( s ) {
		return String( s )
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}

	function escapeHtml( s ) {
		return String( s )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}
} )();
