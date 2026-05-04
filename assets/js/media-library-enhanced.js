/**
 * Desktop Mode — Media Library drag-and-drop enhancement.
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
 *
 * @since 0.14.0
 */

( function () {
	'use strict';

	// Runtime guard — wp.media may not be present on every admin page.
	// If it's not, there's nothing to enhance, so we bail silently.
	if ( ! window.wp || ! window.wp.media || typeof window.wp.media.attachment !== 'function' ) {
		// wp.media might be loaded lazily — register a short polling
		// loop that gives up after 3 seconds. In practice it either
		// lands within a few hundred ms or never arrives on this page.
		var tries = 0;
		var poll = setInterval( function () {
			tries++;
			if ( window.wp && window.wp.media && typeof window.wp.media.attachment === 'function' ) {
				clearInterval( poll );
				start();
			} else if ( tries > 30 ) {
				clearInterval( poll );
			}
		}, 100 );
		return;
	}
	start();

	// Flag set during our own attachment drags so the capture-phase
	// blocker below can distinguish between "user is dragging a file
	// from the OS" (which the WP uploader should handle) and "user is
	// dragging a pre-existing attachment tile" (which the uploader
	// must NOT intercept — otherwise it tries to re-upload it).
	var dragInProgress = false;

	function start() {
		// Enhance whatever's already on the page.
		document.querySelectorAll( '.attachment' ).forEach( enhance );

		// Watch for new tiles — the media grid is a Backbone collection
		// view that appends tiles on scroll, filter change, or modal
		// open. MutationObserver on the body catches all of them.
		var observer = new MutationObserver( function ( mutations ) {
			for ( var i = 0; i < mutations.length; i++ ) {
				var added = mutations[ i ].addedNodes;
				for ( var j = 0; j < added.length; j++ ) {
					var node = added[ j ];
					if ( node.nodeType !== 1 ) {
						continue;
					}
					if ( node.classList && node.classList.contains( 'attachment' ) ) {
						enhance( node );
					}
					if ( node.querySelectorAll ) {
						node.querySelectorAll( '.attachment' ).forEach( enhance );
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
			'body.desktop-mode-dragging-attachment .uploader-window,' +
			'body.desktop-mode-dragging-attachment .uploader-window-content,' +
			'body.desktop-mode-dragging-attachment .uploader-editor-content,' +
			'body.desktop-mode-dragging-attachment .wp-uploader {' +
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
		if ( el.dataset.desktopModeDraggable === '1' ) {
			return;
		}
		el.dataset.desktopModeDraggable = '1';
		el.setAttribute( 'draggable', 'true' );

		el.addEventListener( 'dragstart', function ( e ) {
			var id = parseInt( el.getAttribute( 'data-id' ) || el.dataset.id || '0', 10 );
			if ( ! id ) {
				return;
			}

			// Arm the uploader-block interceptor: every dragover/drop
			// that hits a WP uploader dropzone while this flag is true
			// will be stopped at capture phase. Also class the body so
			// the CSS hides the uploader overlay visually.
			dragInProgress = true;
			document.body.classList.add( 'desktop-mode-dragging-attachment' );

			var model = wp.media.attachment( id );
			var a = ( model && model.attributes ) ? model.attributes : {};

			var url = a.url || scrapeUrl( el );
			var title = a.title || scrapeTitle( el );
			var alt = a.alt || title;
			var mime = a.mime || a.mimeType || '';
			var thumbnailUrl = ( a.sizes && a.sizes.thumbnail && a.sizes.thumbnail.url ) || url;

			if ( ! url ) {
				e.preventDefault();
				return;
			}

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

				// WP-aware drop zones can read the full record here.
				// NOTE: browsers may strip this custom MIME during
				// cross-iframe drags; the postMessage bridge below is
				// the authoritative carrier in that case.
				e.dataTransfer.setData(
					'application/x-wp-media-attachment',
					JSON.stringify( {
						id: id,
						url: url,
						title: title,
						alt: alt,
						mime: mime,
						sizes: a.sizes || {},
					} )
				);

				e.dataTransfer.effectAllowed = 'copy';

				var thumb = el.querySelector( 'img' );
				if ( thumb && thumb.complete && thumb.naturalWidth > 0 ) {
					e.dataTransfer.setDragImage( thumb, thumb.width / 2, thumb.height / 2 );
				}
			} catch ( err ) {
				// setData can throw in older browsers or under hostile CSP.
			}

			// -----------------------------------------------------------
			// Cross-iframe bridge — tell the parent shell a drag is in
			// progress and hand over the full payload. Browsers don't
			// reliably preserve custom MIME types across iframes, so
			// this bridge is the authoritative transport for the
			// attachment data. The shell stores the payload; any
			// receiver iframe can request it via postMessage.
			// -----------------------------------------------------------
			try {
				if ( window.parent && window.parent !== window ) {
					window.parent.postMessage( {
						type: 'desktop-mode-drag-start',
						payload: {
							id: id,
							url: url,
							title: title,
							alt: alt,
							mime: mime,
							sizes: a.sizes || {},
							thumbnailUrl: thumbnailUrl,
						},
					}, window.location.origin );
				}
			} catch ( postErr ) {
				// Cross-origin parent or sandboxed frame — the drag
				// still works via native DataTransfer, we just don't
				// get the bridge benefits.
			}
		} );

		el.addEventListener( 'dragend', function () {
			// Disarm the uploader block and drop the body class so the
			// uploader UI works normally again once the drag is over.
			dragInProgress = false;
			document.body.classList.remove( 'desktop-mode-dragging-attachment' );

			try {
				if ( window.parent && window.parent !== window ) {
					window.parent.postMessage(
						{ type: 'desktop-mode-drag-end' },
						window.location.origin
					);
				}
			} catch ( err ) { /* swallow */ }
		} );
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
