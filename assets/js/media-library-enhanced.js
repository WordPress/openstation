( function () {
	'use strict';

	var dragInProgress = false;

	var GRID_SELECTOR = '.attachment';
	var DETAIL_SELECTOR = '.attachment-details, .edit-attachment-frame';

	var LIST_SELECTOR = 'table.media tbody tr[id^="post-"]';
	var LIST_DELEGATION_INSTALLED = false;

	start();

	function start() {

		document.querySelectorAll( GRID_SELECTOR ).forEach( enhance );
		document.querySelectorAll( DETAIL_SELECTOR ).forEach( enhanceDetail );

		installListDelegation();

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

	function installUploaderBlock() {

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

			var model =
				window.wp &&
				window.wp.media &&
				typeof window.wp.media.attachment === 'function'
					? window.wp.media.attachment( id )
					: null;
			var a = ( model && model.attributes ) ? model.attributes : {};

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

	function enhanceListRow() {
		installListDelegation();
	}

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
		} catch ( err ) {               }
	}

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
		} catch ( err ) {                   }

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

	function resolveOriginalUrl( attrs, fallback ) {
		if ( attrs && attrs.originalImageURL ) {
			return attrs.originalImageURL;
		}
		var candidate = ( attrs && attrs.url ) || fallback || '';
		return stripSizeSuffix( candidate );
	}

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
