( function() {
	var __OS_DATA = window.__osChromelessData || {};

	if ( ! window.parent || window.parent === window ) {
		if ( ! window.openStationChromelessHost ) {
			try {
				var here = new URL( window.location.href );
				if ( here.searchParams.has( 'openstation_chromeless' ) ) {
					here.searchParams.delete( 'openstation_chromeless' );
					here.searchParams.delete( 'desktop_mode_portal' );
					window.location.replace( here.toString() );
				}
			} catch ( err ) {

			}
		}

		return;
	}

	try {
		window.parent.postMessage(
			{
				type: 'os-content-identity',
				identity: ( '_identity' in __OS_DATA ) ? __OS_DATA._identity : null
			},
			window.location.origin
		);
	} catch ( _err ) {                                   }

	window.addEventListener( 'load', function () {
		try {
			var wpg = window.wp;
			if ( ! wpg || ! wpg.data || ! wpg.apiFetch || typeof wpg.data.select !== 'function' ) {
				return;
			}
			var editor = wpg.data.select( 'core/editor' );
			if (
				! editor ||
				typeof editor.isSavingPost !== 'function' ||
				typeof editor.getCurrentPostId !== 'function'
			) {
				return;
			}
			var wasSaving = false;
			var wasNew = false;
			var inFlight = false;
			wpg.data.subscribe( function () {
				var saving =
					editor.isSavingPost() &&
					! ( editor.isAutosavingPost && editor.isAutosavingPost() );
				if ( saving && ! wasSaving ) {
					wasNew = !! (
						editor.isEditedPostNew && editor.isEditedPostNew()
					);
				}
				var finished = wasSaving && ! saving;
				wasSaving = saving;
				if ( ! finished || inFlight ) {
					return;
				}
				if (
					editor.didPostSaveRequestSucceed &&
					! editor.didPostSaveRequestSucceed()
				) {
					return;
				}
				var postId = editor.getCurrentPostId();
				if ( ! postId ) {
					return;
				}

				if ( editor.getCurrentPostType ) {
					try {
						window.parent.postMessage(
							{
								type: 'os-broadcast',
								topic:
									'os.' +
									editor.getCurrentPostType() +
									'.changed',
								payload: {
									source: 'editor',
									action: wasNew ? 'created' : 'updated',
									ids: [ postId ],
								},
							},
							window.location.origin
						);
					} catch ( _err ) {                   }
				}
				inFlight = true;
				wpg
					.apiFetch( {
						path: '/desktop-mode/v1/content-identity?post=' + postId,
					} )
					.then( function ( res ) {
						if ( res && res.identity ) {
							window.parent.postMessage(
								{
									type: 'os-content-identity',
									identity: res.identity,
								},
								window.location.origin
							);
						}
					} )
					.catch( function () {

					} )
					.finally( function () {
						inFlight = false;
					} );
			} );
		} catch ( _err ) {

		}
	} );

	try {
		window.addEventListener( 'pagehide', function () {
			try {
				window.parent.postMessage(
					{ type: 'os-iframe-unloading' },
					window.location.origin
				);
			} catch ( _err ) {                   }
		} );
	} catch ( _err ) {               }

	try {
		window.addEventListener( 'error', function ( e ) {
			try {
				window.parent.postMessage( {
					type: 'os-iframe-error',
					kind: 'error',
					message: e && e.message ? String( e.message ) : '',
					filename: e && e.filename ? String( e.filename ) : null,
					lineno: e && typeof e.lineno === 'number' ? e.lineno : null,
					colno: e && typeof e.colno === 'number' ? e.colno : null,
					stack: e && e.error && e.error.stack ? String( e.error.stack ) : null
				}, window.location.origin );
			} catch ( _err ) {                                                       }
		} );

		window.addEventListener( 'unhandledrejection', function ( e ) {
			try {
				var reason = e && 'reason' in e ? e.reason : null;
				var message = '';
				var stack = null;
				if ( reason instanceof Error ) {
					message = reason.message;
					stack = reason.stack || null;
				} else if ( reason !== null && reason !== undefined ) {
					try { message = String( reason ); } catch ( _s ) { message = '[unstringifiable]'; }
				}
				window.parent.postMessage( {
					type: 'os-iframe-error',
					kind: 'unhandledrejection',
					message: message,
					filename: null,
					lineno: null,
					colno: null,
					stack: stack
				}, window.location.origin );
			} catch ( _err ) {               }
		} );

		window.__wpdInstrument = window.__wpdInstrument || { headers: {}, observe: false };
		try {
			window.addEventListener( 'message', function ( ev ) {
				if ( ev.origin !== window.location.origin || ev.source !== window.parent ) {
					return;
				}
				var d = ev && ev.data;
				if ( ! d || typeof d !== 'object' || d.type !== 'os-instrument-set' ) {
					return;
				}
				window.__wpdInstrument = {
					headers: d.headers && typeof d.headers === 'object' ? d.headers : {},
					observe: !! d.observe
				};
			} );
		} catch ( _err ) {                                                }

		var osReportNetwork = function ( method, url, status, duration, failed, extra ) {
			try {
				var msg = {
					type: 'os-iframe-network',
					method: String( method || 'GET' ).toUpperCase(),
					url: String( url || '' ),
					status: typeof status === 'number' ? status : 0,
					duration: typeof duration === 'number' ? duration : 0,
					failed: !! failed
				};
				if ( extra && window.__wpdInstrument && window.__wpdInstrument.observe ) {
					if ( extra.requestHeaders ) {
						msg.requestHeaders = extra.requestHeaders;
					}
					if ( extra.responseHeaders ) {
						msg.responseHeaders = extra.responseHeaders;
					}
				}
				window.parent.postMessage( msg, window.location.origin );
			} catch ( _err ) {               }
		};

		var osIsReadRequest = function ( method ) {
			var m = String( method || 'GET' ).toUpperCase();
			return 'GET' === m || 'HEAD' === m || 'OPTIONS' === m || 'QUERY' === m;
		};

		var osIsBackgroundRequest = function ( url, body ) {
			try {
				if ( /[?&]action=heartbeat(?:&|$)/.test( String( url || '' ) ) ) {
					return true;
				}
				if ( typeof body === 'string' && /(?:^|&)action=heartbeat(?:&|$)/.test( body ) ) {
					return true;
				}
				if ( body && typeof body.get === 'function' && body.get( 'action' ) === 'heartbeat' ) {
					return true;
				}
			} catch ( _bgErr ) {                                             }
			return false;
		};

		var osActivityBegin = function ( method, background ) {
			if ( osIsReadRequest( method ) || background ) {
				return false;
			}
			try {
				window.parent.postMessage(
					{ type: 'os-iframe-activity', phase: 'start' },
					window.location.origin
				);
			} catch ( _sErr ) {                                                }
			return true;
		};

		var osActivityEnd = function ( tracked, failed, status ) {
			if ( ! tracked ) {
				return;
			}
			try {
				window.parent.postMessage(
					{
						type: 'os-iframe-activity',
						phase: 'end',
						failed: !! failed,
						status: typeof status === 'number' ? status : 0
					},
					window.location.origin
				);
			} catch ( _eErr ) {               }
		};

		var osAuthCheckCooldownUntil = 0;
		var osMaybeForceAuthCheck = function ( status, url, background ) {
			if ( background || ( status !== 401 && status !== 403 ) ) {
				return;
			}
			var urlStr = String( url || '' );
			if ( ! urlStr ) {
				return;
			}

			try {
				var resolved = new URL( urlStr, window.location.href );
				if ( resolved.origin !== window.location.origin ) {
					return;
				}

				if (
					resolved.pathname.indexOf( '/wp-admin/admin-ajax.php' ) !== -1
					&& /(?:^|&|\?)action=heartbeat(?:&|$)/.test( resolved.search )
				) {
					return;
				}
				if ( resolved.pathname.indexOf( '/wp-login.php' ) !== -1 ) {
					return;
				}
			} catch ( _err ) {
				return;
			}
			var now = Date.now();
			if ( now < osAuthCheckCooldownUntil ) {
				return;
			}
			osAuthCheckCooldownUntil = now + 5000;
			try {
				if (
					window.wp
					&& window.wp.heartbeat
					&& typeof window.wp.heartbeat.connectNow === 'function'
				) {
					window.wp.heartbeat.connectNow();
				}
			} catch ( _err ) {               }
		};

		var osHeadersToObject = function ( h ) {
			var out = {};
			if ( ! h ) {
				return out;
			}
			if ( typeof Headers !== 'undefined' && h instanceof Headers ) {
				try {
					h.forEach( function ( v, k ) { out[ k ] = v; } );
				} catch ( _e ) {               }
				return out;
			}
			if ( Array.isArray( h ) ) {
				for ( var i = 0; i < h.length; i++ ) {
					if ( h[ i ] && h[ i ].length >= 2 ) {
						out[ h[ i ][ 0 ] ] = h[ i ][ 1 ];
					}
				}
				return out;
			}
			if ( typeof h === 'object' ) {
				for ( var k in h ) {
					if ( Object.prototype.hasOwnProperty.call( h, k ) ) {
						out[ k ] = h[ k ];
					}
				}
			}
			return out;
		};

		var osContributedHeaders = function () {
			var inst = window.__wpdInstrument || {};
			var headers = inst.headers || {};
			var out = {};
			for ( var k in headers ) {
				if ( Object.prototype.hasOwnProperty.call( headers, k ) && typeof headers[ k ] === 'string' ) {
					out[ k ] = headers[ k ];
				}
			}
			return out;
		};

		if ( typeof window.fetch === 'function' ) {
			var osOrigFetch = window.fetch;
			window.fetch = function ( input, init ) {
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				var method = 'GET';
				var url = '';
				if ( typeof input === 'string' ) {
					url = input;
					if ( init && typeof init.method === 'string' ) {
						method = init.method;
					}
				} else if ( input && typeof input === 'object' ) {
					url = input.url || '';
					method = ( input.method || ( init && init.method ) || 'GET' );
				}

				var contributed = osContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				var requestHeaders = null;
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				if ( hasContributed || observe ) {
					var existing = osHeadersToObject( init && init.headers );
					if ( input && typeof input === 'object' && input.headers ) {
						var fromReq = osHeadersToObject( input.headers );
						for ( var rk in fromReq ) {
							if ( Object.prototype.hasOwnProperty.call( fromReq, rk ) && ! ( rk in existing ) ) {
								existing[ rk ] = fromReq[ rk ];
							}
						}
					}
					for ( var ck2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, ck2 ) ) {
							existing[ ck2 ] = contributed[ ck2 ];
						}
					}
					if ( hasContributed ) {
						init = init ? Object.assign( {}, init ) : {};
						init.headers = existing;
						arguments[ 1 ] = init;
					}
					if ( observe ) {
						requestHeaders = existing;
					}
				}

				var background = osIsBackgroundRequest( url, ( init && init.body ) || ( input && input.body ) );
				var tracked = osActivityBegin( method, background );

				var promise;
				try {
					promise = osOrigFetch.apply( this, arguments );
				} catch ( sync ) {
					osReportNetwork( method, url, 0, 0, true, requestHeaders ? { requestHeaders: requestHeaders } : null );
					osActivityEnd( tracked, true, 0 );
					throw sync;
				}
				return promise.then(
					function ( res ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						var extra = null;
						if ( requestHeaders ) {
							extra = { requestHeaders: requestHeaders };
							try {
								var rh = {};
								if ( res && res.headers && typeof res.headers.forEach === 'function' ) {
									res.headers.forEach( function ( v, k ) { rh[ k ] = v; } );
								}
								extra.responseHeaders = rh;
							} catch ( _hErr ) {               }
						}
						osReportNetwork( method, url, res.status, Math.round( dur ), ! res.ok, extra );

						osActivityEnd( tracked, ! res.ok, res.status );
						osMaybeForceAuthCheck( res.status, url, background );
						return res;
					},
					function ( err ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						osReportNetwork( method, url, 0, Math.round( dur ), true, requestHeaders ? { requestHeaders: requestHeaders } : null );
						osActivityEnd( tracked, true, 0 );
						throw err;
					}
				);
			};
		}

		if ( typeof XMLHttpRequest !== 'undefined' ) {
			var osOrigOpen = XMLHttpRequest.prototype.open;
			var osOrigSend = XMLHttpRequest.prototype.send;
			var osOrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;
			XMLHttpRequest.prototype.open = function ( method, url ) {
				try {
					this.__wpdMethod = method;
					this.__wpdUrl = url;
					this.__wpdReqHeaders = {};
				} catch ( _err ) {                              }
				return osOrigOpen.apply( this, arguments );
			};
			XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
				try {
					if ( ! this.__wpdReqHeaders ) {
						this.__wpdReqHeaders = {};
					}
					this.__wpdReqHeaders[ name ] = value;
				} catch ( _err ) {               }
				return osOrigSetHeader.apply( this, arguments );
			};
			XMLHttpRequest.prototype.send = function ( body ) {
				var xhr = this;
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();

				var background = osIsBackgroundRequest( xhr.__wpdUrl, body );
				var tracked = osActivityBegin( xhr.__wpdMethod, background );

				var contributed = osContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				for ( var hk in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, hk ) ) {
						try {
							osOrigSetHeader.call( xhr, hk, contributed[ hk ] );
							if ( ! xhr.__wpdReqHeaders ) {
								xhr.__wpdReqHeaders = {};
							}
							xhr.__wpdReqHeaders[ hk ] = contributed[ hk ];
						} catch ( _hErr ) {                                                         }
					}
				}

				var fire = function () {
					xhr.removeEventListener( 'loadend', fire );
					var dur = ( ( typeof performance !== 'undefined' && performance.now )
						? performance.now()
						: Date.now() ) - start;
					var extra = null;
					if ( observe ) {
						extra = {
							requestHeaders: xhr.__wpdReqHeaders || {}
						};
						try {
							var raw = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '';
							var resHeaders = {};
							if ( raw && typeof raw === 'string' ) {
								var lines = raw.trim().split( /[\r\n]+/ );
								for ( var li = 0; li < lines.length; li++ ) {
									var idx = lines[ li ].indexOf( ':' );
									if ( idx > 0 ) {
										resHeaders[ lines[ li ].slice( 0, idx ).trim() ] = lines[ li ].slice( idx + 1 ).trim();
									}
								}
							}
							extra.responseHeaders = resHeaders;
						} catch ( _rErr ) {               }
					}
					var failed = xhr.status === 0 || xhr.status >= 400;
					osReportNetwork(
						xhr.__wpdMethod,
						xhr.__wpdUrl,
						xhr.status,
						Math.round( dur ),
						failed,
						extra
					);
					osActivityEnd( tracked, failed, xhr.status );
					osMaybeForceAuthCheck( xhr.status, xhr.__wpdUrl, background );
				};
				try {
					xhr.addEventListener( 'loadend', fire );
				} catch ( _err ) {               }
				try {
					return osOrigSend.apply( this, arguments );
				} catch ( sync ) {
					xhr.removeEventListener( 'loadend', fire );
					osReportNetwork( xhr.__wpdMethod, xhr.__wpdUrl, 0, 0, true, null );
					osActivityEnd( tracked, true, 0 );
					throw sync;
				}
			};
		}

		if ( typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ) {
			var osOrigBeacon = navigator.sendBeacon.bind( navigator );
			navigator.sendBeacon = function ( url, data ) {
				var contributed = osContributedHeaders();
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				if ( ! hasContributed ) {
					var ok = false;
					try { ok = !! osOrigBeacon( url, data ); } catch ( _e ) { ok = false; }
					osReportNetwork( 'POST', url, ok ? 200 : 0, 0, ! ok );
					return ok;
				}
				try {
					var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
					var headers = {};
					for ( var hk2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, hk2 ) ) {
							headers[ hk2 ] = contributed[ hk2 ];
						}
					}
					window.fetch( url, {
						method: 'POST',
						body: data,
						keepalive: true,
						credentials: 'same-origin',
						headers: headers
					} ).then(
						function ( res ) {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							osReportNetwork( 'POST', url, res.status, Math.round( dur ), ! res.ok, observe ? { requestHeaders: headers } : null );
						},
						function () {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							osReportNetwork( 'POST', url, 0, Math.round( dur ), true, observe ? { requestHeaders: headers } : null );
						}
					);
					return true;
				} catch ( _bErr ) {
					return false;
				}
			};
		}
	} catch ( _err ) {

	}

	var __OPENSTATION_MENU_PAYLOAD__ = ( '_menuPayload' in __OS_DATA ) ? __OS_DATA._menuPayload : null;
	var __OPENSTATION_MENU_SIG__ = ( '_menuSig' in __OS_DATA ) ? __OS_DATA._menuSig : null;

	try {
		if (
			__OPENSTATION_MENU_PAYLOAD__
			&& Array.isArray( __OPENSTATION_MENU_PAYLOAD__.dockItems )
		) {
			var __wpdAdminMenu = document.getElementById( 'adminmenu' );
			if ( __wpdAdminMenu ) {
				var __wpdHarvest = {};
				var __wpdLinks = __wpdAdminMenu.querySelectorAll( 'li.menu-top > a' );
				for ( var __wpdLi = 0; __wpdLi < __wpdLinks.length; __wpdLi++ ) {
					var __wpdLink = __wpdLinks[ __wpdLi ];
					var __wpdKey;
					try {
						var __wpdU = new URL( __wpdLink.href || '', window.location.href );
						__wpdKey = ( __wpdU.pathname.split( '/' ).pop() || '' ) + __wpdU.search;
					} catch ( __wpdE1 ) { continue; }
					if ( ! __wpdKey ) { continue; }
					var __wpdImgWrap = __wpdLink.querySelector( '.wp-menu-image' );
					if ( ! __wpdImgWrap ) { continue; }

					var __wpdImg = __wpdImgWrap.querySelector( 'img' );
					if ( __wpdImg && __wpdImg.src ) {
						__wpdHarvest[ __wpdKey ] = __wpdImg.src;
						continue;
					}

					var __wpdDash = ( __wpdImgWrap.className || '' ).match( /\bdashicons-[\w-]+\b/ );
					if (
						__wpdDash
						&& __wpdDash[ 0 ] !== 'dashicons-before'
						&& __wpdDash[ 0 ] !== 'dashicons-admin-generic'
					) {
						__wpdHarvest[ __wpdKey ] = __wpdDash[ 0 ];
						continue;
					}

					try {
						var __wpdBefore = window.getComputedStyle( __wpdImgWrap, '::before' );
						var __wpdBg = __wpdBefore && __wpdBefore.backgroundImage;
						if ( __wpdBg && __wpdBg !== 'none' && __wpdBg.indexOf( 'url("")' ) === -1 ) {
							__wpdHarvest[ __wpdKey ] = __wpdBg;
							continue;
						}

						var __wpdMask = __wpdBefore && ( __wpdBefore.maskImage || __wpdBefore.webkitMaskImage );
						if ( __wpdMask && __wpdMask !== 'none' && __wpdMask.indexOf( 'url("")' ) === -1 ) {
							__wpdHarvest[ __wpdKey ] = __wpdMask;
							continue;
						}

						var __wpdWrapBg = window.getComputedStyle( __wpdImgWrap ).backgroundImage;
						if ( __wpdWrapBg && __wpdWrapBg !== 'none' && __wpdWrapBg.indexOf( 'url("")' ) === -1 ) {
							__wpdHarvest[ __wpdKey ] = __wpdWrapBg;
						}
					} catch ( __wpdE2 ) {                                                    }
				}

				var __wpdItems = __OPENSTATION_MENU_PAYLOAD__.dockItems;
				for ( var __wpdDi = 0; __wpdDi < __wpdItems.length; __wpdDi++ ) {
					var __wpdItem = __wpdItems[ __wpdDi ];
					if ( ! __wpdItem || __wpdItem.icon !== 'dashicons-admin-generic' ) { continue; }
					if ( typeof __wpdItem.url !== 'string' || ! __wpdItem.url ) { continue; }
					try {
						var __wpdItemU = new URL( __wpdItem.url, window.location.href );
						var __wpdItemKey = ( __wpdItemU.pathname.split( '/' ).pop() || '' ) + __wpdItemU.search;
						if ( __wpdHarvest[ __wpdItemKey ] ) {
							__wpdItem.icon = __wpdHarvest[ __wpdItemKey ];
						}
					} catch ( __wpdE3 ) {                                        }
				}
			}
		}
	} catch ( __wpdHarvestErr ) {

	}

	try {
		var __wpdShell = window.top || window.parent;
		if ( __OPENSTATION_MENU_PAYLOAD__ ) {
			__wpdShell.postMessage(
				{
					type: 'os-plugins-changed',
					payload: __OPENSTATION_MENU_PAYLOAD__
				},
				window.location.origin
			);
		} else if ( __OPENSTATION_MENU_SIG__ ) {
			__wpdShell.postMessage(
				{
					type: 'os-menu-signature',
					sig: __OPENSTATION_MENU_SIG__
				},
				window.location.origin
			);
		}
	} catch ( err ) {

	}

	function adminScope( pathname ) {
		var i = pathname.indexOf( '/wp-admin/' );
		if ( i === -1 ) {
			return '';
		}
		var rest = pathname.slice( i + 10 );
		var sub = /^(network|user)\//.exec( rest );
		return pathname.slice( 0, i + 10 ) + ( sub ? sub[ 0 ] : '' );
	}

	function isOtherAdmin( url ) {
		var ours = adminScope( window.location.pathname );
		var theirs = adminScope( url.pathname );
		return '' !== ours && '' !== theirs && ours !== theirs;
	}

	function rewriteAdminUrl( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return null;
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return null;
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return null;
		}
		if ( url.origin !== window.location.origin ) {
			return null;
		}
		if ( url.pathname.indexOf( '/wp-admin/' ) === -1 ) {
			return null;
		}
		if ( isOtherAdmin( url ) ) {
			return null;
		}
		if ( url.searchParams.has( 'openstation_chromeless' ) ) {
			return null;
		}
		url.searchParams.set( 'openstation_chromeless', '1' );
		return url.toString();
	}

	function classifyLink( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return 'passthrough';
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return 'passthrough';
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return 'passthrough';
		}
		if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
			return 'passthrough';
		}
		if (
			url.origin === window.location.origin &&
			url.pathname.indexOf( '/wp-admin/' ) !== -1
		) {
			return isOtherAdmin( url ) ? 'other-admin' : 'admin';
		}
		return 'external';
	}

	function stampSourceRefererOnLink( link ) {
		try {
			var target = new URL( link.getAttribute( 'href' ), window.location.href );
			if ( target.origin !== window.location.origin ) {
				return;
			}
			if ( target.searchParams.has( '_wp_http_referer' ) ) {
				return;
			}
			var source = new URL( window.location.href );
			source.searchParams.delete( 'openstation_chromeless' );
			target.searchParams.set(
				'_wp_http_referer',
				source.pathname + ( source.search ? source.search : '' )
			);
			link.setAttribute( 'href', target.toString() );
		} catch ( err ) {

		}
	}

	function isJetpackAppRoute( link ) {
		if ( ! link.closest( '#wpcom' ) ) {
			return false;
		}
		var page = new URLSearchParams( window.location.search ).get( 'page' );
		var href = link.getAttribute( 'href' ) || '';
		return !! page && href.indexOf( '/' + page ) === 0;
	}

	function adminFileOf( url ) {
		try {
			return new URL( url, window.location.href ).pathname.split( '/' ).pop();
		} catch ( err ) {
			return '';
		}
	}

	function visibleLinkText( link ) {
		var clone = link.cloneNode( true );
		var muted = clone.querySelectorAll( '.screen-reader-text, .hidden' );
		for ( var i = 0; i < muted.length; i++ ) {
			if ( muted[ i ].parentNode ) {
				muted[ i ].parentNode.removeChild( muted[ i ] );
			}
		}
		return ( clone.textContent || '' ).replace( /\s+/g, ' ' ).trim();
	}

	document.addEventListener( 'click', function ( e ) {
		if ( e.defaultPrevented ) {
			return;
		}
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}
		var link = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
		if ( ! link ) {
			return;
		}

		var newContext = false;
		var linkTarget = link.target || '';
		if ( linkTarget !== '' && linkTarget !== '_self' ) {
			var claimable =
				linkTarget === '_blank' &&
				classifyLink( link.getAttribute( 'href' ), window.location.href ) === 'admin' &&
				adminFileOf( link.getAttribute( 'href' ) ) !== '' &&
				adminFileOf( link.getAttribute( 'href' ) ) !== adminFileOf( window.location.href );
			if ( ! claimable ) {
				return;
			}
			newContext = true;
		}
		if ( link.hasAttribute( 'download' ) ) {
			return;
		}

		var footprintAttr = link.getAttribute( 'data-os-footprint' );
		if ( footprintAttr ) {
			var footprintUid = parseInt( footprintAttr, 10 );
			if ( footprintUid > 0 ) {
				e.preventDefault();
				try {
					window.parent.postMessage(
						{
							type: 'os-open-user-footprint',
							userId: footprintUid,
							userName: link.getAttribute( 'data-os-footprint-name' ) || ''
						},
						window.location.origin
					);
				} catch ( footprintErr ) {

				}
				return;
			}
		}

		if ( link.classList.contains( 'aria-button-if-js' ) ) {
			if ( link.classList.contains( 'submitdelete' ) ) {
				stampSourceRefererOnLink( link );
			}
			return;
		}

		if ( link.classList.contains( 'upload-view-toggle' ) ) {
			var uploadWrap = link.closest( '.wrap' );
			if (
				! uploadWrap ||
				! uploadWrap.classList.contains( 'plugin-install-tab-upload' )
			) {
				return;
			}
		}

		if (
			link.closest( '#welcome-panel' ) &&
			( link.classList.contains( 'welcome-panel-close' ) ||
				link.closest( '.welcome-panel-dismiss' ) )
		) {
			return;
		}

		if (
			link.classList.contains( 'install-now' ) ||
			link.classList.contains( 'update-link' ) ||
			link.classList.contains( 'update-now' ) ||
			link.classList.contains( 'delete-plugin' ) ||
			link.classList.contains( 'delete-theme' ) ||
			link.classList.contains( 'install-theme' ) ||
			( link.classList.contains( 'delete' ) &&
				( link.closest( '[data-plugin]' ) ||
					( document.body.classList.contains( 'themes-php' ) &&
						document.body.classList.contains( 'network-admin' ) ) ) )
		) {
			return;
		}

		if ( isJetpackAppRoute( link ) ) {
			return;
		}
		var href = link.getAttribute( 'href' );
		var kind = classifyLink( href, window.location.href );
		if ( kind === 'admin' ) {
			var rewritten = rewriteAdminUrl( href, window.location.href );
			if ( rewritten ) {
				link.setAttribute( 'href', rewritten );
			}

			e.preventDefault();
			try {
				var absolute = new URL( rewritten || href, window.location.href ).toString();

				var adminLabel = visibleLinkText( link ) ||
					link.getAttribute( 'title' ) ||
					link.getAttribute( 'aria-label' ) ||
					'';
				window.parent.postMessage(
					{
						type: 'os-iframe-admin-link',
						url: absolute,
						label: adminLabel.slice( 0, 80 ),

						newContext: newContext
					},
					window.location.origin
				);
			} catch ( bridgeErr ) {

			}
			return;
		}
		if ( kind === 'other-admin' ) {
			e.preventDefault();
			var other;
			try {
				other = new URL( href, window.location.href );
			} catch ( err ) {
				return;
			}

			other.searchParams.delete( 'openstation_chromeless' );
			window.parent.postMessage(
				{
					type: 'os-iframe-other-admin-link',
					url: other.href,
				},
				window.location.origin
			);
			return;
		}
		if ( kind === 'external' ) {
			e.preventDefault();

			var externalAbsolute;
			try {
				externalAbsolute = new URL( href, window.location.href ).toString();
			} catch ( err ) {
				return;
			}
			var label = visibleLinkText( link ) ||
				link.getAttribute( 'title' ) ||
				externalAbsolute;
			window.parent.postMessage(
				{
					type: 'os-external-link',
					url: externalAbsolute,
					label: label.slice( 0, 80 )
				},
				window.location.origin
			);
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' ) {
			return;
		}
		var action = form.getAttribute( 'action' );
		var rewritten = rewriteAdminUrl( action || window.location.href, window.location.href );
		if ( rewritten ) {
			form.setAttribute( 'action', rewritten );
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' || e.defaultPrevented ) {
			return;
		}
		var target = form.getAttribute( 'target' );
		if ( target && '_self' !== target ) {
			return;
		}

		if ( 'POST' !== String( form.getAttribute( 'method' ) || 'get' ).toUpperCase() ) {
			if ( e.submitter && 'filter_action' === e.submitter.name ) {
				return;
			}
			var picked = false;
			var actions = form.querySelectorAll( 'select[name="action"],select[name="action2"]' );
			for ( var i = 0; i < actions.length; i++ ) {
				if ( actions[ i ].value && '-1' !== actions[ i ].value ) {
					picked = true;
				}
			}
			if ( ! picked ) {
				return;
			}
		}
		try {
			window.parent.postMessage(
				{ type: 'os-iframe-activity', phase: 'start', navigation: true },
				window.location.origin
			);
		} catch ( _subErr ) {                                                }
	} );

	function postFocusRequest() {
		try {
			window.parent.postMessage(
				{ type: 'os-focus-request' },
				window.location.origin
			);
		} catch ( err ) {

		}
	}

	document.addEventListener( 'pointerdown', postFocusRequest, true );

	var hookedFrameDocs = new WeakSet();
	var hookedFrameEls = new WeakSet();

	function hookNestedFrameDoc( frame ) {
		var doc;
		try {
			doc = frame.contentDocument;
		} catch ( err ) {
			return;
		}
		if ( ! doc || hookedFrameDocs.has( doc ) ) {
			return;
		}
		hookedFrameDocs.add( doc );
		doc.addEventListener( 'pointerdown', postFocusRequest, true );
	}

	function hookNestedFrame( frame ) {
		if ( ! hookedFrameEls.has( frame ) ) {
			hookedFrameEls.add( frame );
			frame.addEventListener( 'load', function ( ev ) {
				hookNestedFrameDoc( ev.target );
			} );
		}
		hookNestedFrameDoc( frame );
	}

	function hookNestedFrames( root ) {
		if ( ! root || ( 1 !== root.nodeType && 9 !== root.nodeType ) ) {
			return;
		}
		if ( 'IFRAME' === root.nodeName ) {
			hookNestedFrame( root );
		}
		var frames = root.querySelectorAll( 'iframe' );
		for ( var i = 0; i < frames.length; i++ ) {
			hookNestedFrame( frames[ i ] );
		}
	}

	hookNestedFrames( document );
	if ( window.MutationObserver ) {
		new MutationObserver( function ( records ) {
			for ( var r = 0; r < records.length; r++ ) {
				var added = records[ r ].addedNodes;
				for ( var n = 0; n < added.length; n++ ) {
					hookNestedFrames( added[ n ] );
				}
			}
		} ).observe(
			document.documentElement,
			{ childList: true, subtree: true }
		);
	}

	function bridgeHasFiles( ev ) {
		var t = ev && ev.dataTransfer && ev.dataTransfer.types;
		if ( ! t ) {
			return false;
		}
		if ( typeof t.includes === 'function' ) {
			return t.includes( 'Files' );
		}
		if ( typeof t.contains === 'function' ) {
			return t.contains( 'Files' );
		}
		for ( var i = 0; i < t.length; i++ ) {
			if ( t[ i ] === 'Files' ) {
				return true;
			}
		}
		return false;
	}

	var bridgeDropPassthroughSelectors = [
		'.components-drop-zone',
		'[data-drop-zone]',
		'.uploader-window',
		'.media-frame-content'
	];
	function bridgeDropTargetWantsFile( target ) {
		if ( ! target || ! target.closest ) {
			return false;
		}
		for ( var s = 0; s < bridgeDropPassthroughSelectors.length; s++ ) {
			if ( target.closest( bridgeDropPassthroughSelectors[ s ] ) ) {
				return true;
			}
		}
		return false;
	}

	function bridgeNativeFileInputFor( target ) {
		if ( ! target || ! target.closest ) {
			return null;
		}
		var input = target.closest( 'input[type="file"]' );
		if ( ! input ) {
			var form = target.closest( 'form.wp-upload-form' );
			if ( ! form ) {
				return null;
			}
			var inputs = form.querySelectorAll( 'input[type="file"]' );
			if ( inputs.length !== 1 ) {
				return null;
			}
			input = inputs[ 0 ];
		}
		if ( input.disabled ) {
			return null;
		}
		if (
			typeof input.getClientRects === 'function' &&
			input.getClientRects().length === 0
		) {
			return null;
		}
		return input;
	}

	function bridgeHandFilesToInput( input, list ) {
		if ( ! list || list.length === 0 ) {
			return false;
		}
		try {
			var picked = list;
			if (
				list.length > 1 &&
				! input.multiple &&
				typeof DataTransfer === 'function'
			) {
				var dt = new DataTransfer();
				dt.items.add( list[ 0 ] );
				picked = dt.files;
			}
			input.files = picked;
		} catch ( err ) {
			return false;
		}
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		return true;
	}

	var bridgeDropZoneAttr = 'data-os-file-drop-active';
	var bridgeDropZone = null;
	var bridgeDropZoneWatchdog = null;
	function bridgeClearDropZone() {
		if ( bridgeDropZone ) {
			bridgeDropZone.removeAttribute( bridgeDropZoneAttr );
			bridgeDropZone = null;
		}
		if ( bridgeDropZoneWatchdog !== null ) {
			clearTimeout( bridgeDropZoneWatchdog );
			bridgeDropZoneWatchdog = null;
		}
	}
	function bridgeMarkDropZone( input ) {
		var zone = input
			? input.closest( 'form.wp-upload-form' ) || input
			: null;
		if ( zone !== bridgeDropZone ) {
			if ( bridgeDropZone ) {
				bridgeDropZone.removeAttribute( bridgeDropZoneAttr );
			}
			bridgeDropZone = zone;
			if ( zone ) {
				zone.setAttribute( bridgeDropZoneAttr, '' );
			}
		}
		if ( bridgeDropZoneWatchdog !== null ) {
			clearTimeout( bridgeDropZoneWatchdog );
			bridgeDropZoneWatchdog = null;
		}
		if ( zone ) {
			bridgeDropZoneWatchdog = setTimeout( bridgeClearDropZone, 250 );
		}
	}

	document.addEventListener( 'dragover', function ( ev ) {
		if ( ! bridgeHasFiles( ev ) ) {
			return;
		}
		if ( bridgeDropTargetWantsFile( ev.target ) ) {
			return;
		}
		if ( ev.defaultPrevented ) {
			return;
		}
		bridgeMarkDropZone( bridgeNativeFileInputFor( ev.target ) );
		ev.preventDefault();
		if ( ev.dataTransfer ) {
			ev.dataTransfer.dropEffect = 'copy';
		}
	}, false );
	document.addEventListener( 'drop', function ( ev ) {
		if ( ! bridgeHasFiles( ev ) ) {
			return;
		}
		bridgeClearDropZone();
		if ( bridgeDropTargetWantsFile( ev.target ) ) {
			return;
		}
		if ( ev.defaultPrevented ) {
			return;
		}
		var input = bridgeNativeFileInputFor( ev.target );
		if ( input && ev.dataTransfer && ev.dataTransfer.files ) {
			if ( bridgeHandFilesToInput( input, ev.dataTransfer.files ) ) {
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
			if ( ev.target === input ) {
				return;
			}
		}
		ev.preventDefault();
		ev.stopPropagation();
		var files = [];
		if ( ev.dataTransfer && ev.dataTransfer.files ) {
			for ( var i = 0; i < ev.dataTransfer.files.length; i++ ) {
				files.push( ev.dataTransfer.files[ i ] );
			}
		}
		if ( files.length === 0 ) {
			return;
		}
		try {
			window.parent.postMessage(
				{
					type: 'os-file-drop',
					files: files,
					x: ev.clientX,
					y: ev.clientY,
				},
				window.location.origin
			);
		} catch ( err ) {                                    }
	}, false );

	if ( ! window.__openStationDragHoverForwarderInstalled ) {
		window.__openStationDragHoverForwarderInstalled = true;
		var dragHoverLastSent = 0;
		document.addEventListener( 'dragover', function ( ev ) {
			var now = Date.now();
			if ( now - dragHoverLastSent < 150 ) {
				return;
			}
			dragHoverLastSent = now;
			try {
				window.parent.postMessage(
					{
						type: 'os-drag-hover',
						payloadType: bridgeHasFiles( ev ) ? 'os-file' : 'external',
					},
					window.location.origin
				);
			} catch ( err ) {                                    }
		}, true );
	}

	if ( ! window.__openStationPointerForwarderInstalled ) {
		window.__openStationPointerForwarderInstalled = true;
		var pointerTrackOn = false;
		var pointerLastSent = 0;
		window.addEventListener( 'message', function ( e ) {
			if ( e.origin !== window.location.origin ) return;
			if ( ! e.data || e.data.type !== 'os-pointer-track' ) return;
			pointerTrackOn = !! e.data.enabled;
		} );
		document.addEventListener( 'pointermove', function ( ev ) {
			if ( ! pointerTrackOn ) return;
			var now = Date.now();

			if ( now - pointerLastSent < 40 ) return;
			pointerLastSent = now;
			try {
				window.parent.postMessage(
					{
						type: 'os-pointer-move',
						x: ev.clientX,
						y: ev.clientY
					},
					window.location.origin
				);
			} catch ( err ) {                                    }
		}, { capture: true, passive: true } );
	}

	document.addEventListener( 'keydown', function ( e ) {
		if ( ! ( e.metaKey || e.ctrlKey ) ) return;
		if ( e.key !== 'k' && e.key !== 'K' ) return;
		if ( e.shiftKey || e.altKey ) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{ type: 'os-palette-cycle' },
				window.location.origin
			);
		} catch ( err ) {                                    }
	}, true );

	var __wpdCommandsSubscribed   = false;
	var __wpdCommandsLastPayload  = '';
	var __wpdCommandsDebounceId   = null;
	var __wpdCommandsOrigin       = window.location.origin;

	var __wpdCommandsKindCache    = Object.create( null );

	function __wpdRenderIconElement( icon ) {
		if ( ! icon ) return '';
		if ( typeof icon === 'string' ) return '';
		if ( ! window.wp || ! window.wp.element || typeof window.wp.element.renderToString !== 'function' ) {
			return '';
		}
		try {
			var rendered = window.wp.element.renderToString( icon );

			if ( typeof rendered === 'string' && rendered.toLowerCase().indexOf( '<svg' ) === 0 ) {
				return rendered;
			}
		} catch ( _err ) {               }
		return '';
	}

	function __wpdClassifyCommand( cmd ) {
		var out = {
			name:    String( cmd && cmd.name ? cmd.name : '' ),
			label:   String( cmd && cmd.label ? cmd.label : '' ),
			icon:    cmd && cmd.icon && typeof cmd.icon === 'string' ? cmd.icon : undefined,
			iconSvg: undefined,
			context: cmd && cmd.context ? String( cmd.context ) : undefined,
			kind:    'action',
			url:     undefined
		};
		if ( ! cmd || typeof cmd.callback !== 'function' ) {
			return out;
		}

		var cached = __wpdCommandsKindCache[ out.name ];
		if ( cached ) {
			out.kind    = cached.kind;
			out.url     = cached.url;
			out.iconSvg = cached.iconSvg;
			return out;
		}

		if ( cmd.icon && typeof cmd.icon !== 'string' ) {
			out.iconSvg = __wpdRenderIconElement( cmd.icon );
		}

		var src = '';
		try { src = Function.prototype.toString.call( cmd.callback ); } catch ( _err ) { src = ''; }
		var navRe = /(?:document\.location\.href|window\.location\.href|location\.href)\s*=\s*['"]([^'"$]+?)['"]/;
		var asgRe = /location\.(?:assign|replace)\s*\(\s*['"]([^'"$]+?)['"]\s*\)/;
		var mm = src.match( navRe ) || src.match( asgRe );
		if ( mm && mm[ 1 ] ) {
			try {
				out.url  = new URL( mm[ 1 ], window.location.href ).toString();
				out.kind = 'navigate';
			} catch ( _err ) {
				out.kind = 'action';
			}
		}
		__wpdCommandsKindCache[ out.name ] = { kind: out.kind, url: out.url, iconSvg: out.iconSvg };
		return out;
	}

	var __wpdLastRawCommands = [];

	var __wpdCommandCallbacks = Object.create( null );

	function __wpdFinalizeCommands( raw ) {
		var seen = Object.create( null );
		var out = [];
		var skipped = { missing: 0, disabled: 0, dup: 0 };
		for ( var i = 0; i < raw.length; i++ ) {
			var cmd = raw[ i ];
			if ( ! cmd || ! cmd.name || ! cmd.label ) { skipped.missing++; continue; }
			if ( cmd.disabled ) { skipped.disabled++; continue; }
			if ( seen[ cmd.name ] ) { skipped.dup++; continue; }
			seen[ cmd.name ] = true;
			out.push( __wpdClassifyCommand( cmd ) );
		}
		return out;
	}

	function __wpdHarvestCommands() {
		return __wpdFinalizeCommands( __wpdLastRawCommands );
	}

	var __wpdReactMounted = false;

	var __wpdReactRoot    = null;
	var __wpdReactHost    = null;

	function __wpdMountReactHarvester() {
		if ( __wpdReactMounted ) return;
		if ( ! window.wp || ! window.wp.element || ! window.wp.data ) {
			return;
		}
		var el        = window.wp.element;
		var createEl  = el.createElement;
		var useEffect = el.useEffect;
		var useRef    = el.useRef;
		var useMemo   = el.useMemo;
		var useSelect = ( window.wp.data && window.wp.data.useSelect ) || null;
		if ( ! createEl || ! useSelect || ! el.createRoot || ! useRef ) {
			return;
		}
		__wpdReactMounted = true;

		var host = document.createElement( 'div' );
		host.setAttribute( 'aria-hidden', 'true' );
		host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px;';
		( document.body || document.documentElement ).appendChild( host );
		__wpdReactHost = host;

		var resultsBucket = { perLoader: {}, statics: [], loadersList: [] };

		function commandsFingerprint( cmds ) {
			if ( ! Array.isArray( cmds ) || cmds.length === 0 ) return '';

			var keys = new Array( cmds.length );
			for ( var i = 0; i < cmds.length; i++ ) {
				var c = cmds[ i ];
				keys[ i ] = c && c.name ? c.name : '';
			}
			return keys.join( '|' );
		}

		function mergeAndPost() {
			var merged = [];
			var loadersList = resultsBucket.loadersList;
			if ( Array.isArray( loadersList ) ) {
				for ( var i = 0; i < loadersList.length; i++ ) {
					var bucket = resultsBucket.perLoader[ loadersList[ i ] ];
					if ( Array.isArray( bucket ) ) merged = merged.concat( bucket );
				}
			}
			if ( Array.isArray( resultsBucket.statics ) ) {
				merged = merged.concat( resultsBucket.statics );
			}

			__wpdCommandCallbacks = Object.create( null );
			for ( var j = 0; j < merged.length; j++ ) {
				var cc = merged[ j ];
				if ( cc && cc.name && typeof cc.callback === 'function' ) {
					__wpdCommandCallbacks[ cc.name ] = cc.callback;
				}
			}
			__wpdLastRawCommands = merged;
			__wpdSchedulePost();
		}

		function LoaderSlot( props ) {
			var loader = props.loader;
			var result = null;
			try {
				result = loader.hook( { search: '' } );
			} catch ( _err ) {

			}
			var cmds = ( result && Array.isArray( result.commands ) ) ? result.commands : [];
			var key  = useMemo( function () { return commandsFingerprint( cmds ); }, [ cmds ] );

			useEffect( function () {
				resultsBucket.perLoader[ loader.name ] = cmds;
				mergeAndPost();
			}, [ key ] );

			useEffect( function () {
				return function () {
					delete resultsBucket.perLoader[ loader.name ];
					mergeAndPost();
				};
			}, [] );

			return null;
		}

		function Harvester() {
			var loaders = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommandLoaders === 'function' )
					? ss.getCommandLoaders( true )
					: [];
			}, [] );
			var staticCmds = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommands === 'function' )
					? ss.getCommands( true )
					: [];
			}, [] );

			var loadersNames = useMemo( function () {
				if ( ! Array.isArray( loaders ) ) return [];
				return loaders.map( function ( l ) { return l ? l.name : ''; } );
			}, [ loaders ] );
			var loadersKey = loadersNames.join( '|' );
			useEffect( function () {
				resultsBucket.loadersList = loadersNames;
				mergeAndPost();
			}, [ loadersKey ] );

			var staticKey = useMemo( function () { return commandsFingerprint( staticCmds ); }, [ staticCmds ] );
			useEffect( function () {
				resultsBucket.statics = Array.isArray( staticCmds ) ? staticCmds : [];
				mergeAndPost();
			}, [ staticKey ] );

			if ( ! Array.isArray( loaders ) || loaders.length === 0 ) {
				return null;
			}
			var children = [];
			for ( var i = 0; i < loaders.length; i++ ) {
				var loader = loaders[ i ];
				if ( ! loader || typeof loader.hook !== 'function' ) continue;
				children.push( createEl( LoaderSlot, {
					key: loader.name,
					loader: loader
				} ) );
			}
			return createEl( el.Fragment || 'div', null, children );
		}

		try {
			var root = el.createRoot( host );
			__wpdReactRoot = root;
			root.render( createEl( Harvester ) );
		} catch ( err ) {
			__wpdReactMounted = false;
			__wpdReactRoot    = null;
			if ( __wpdReactHost && __wpdReactHost.parentNode ) {
				__wpdReactHost.parentNode.removeChild( __wpdReactHost );
			}
			__wpdReactHost = null;
		}
	}

	function __wpdUnmountReactHarvester() {
		if ( __wpdReactRoot ) {
			try { __wpdReactRoot.unmount(); } catch ( _err ) {               }
		}
		__wpdReactRoot = null;
		if ( __wpdReactHost && __wpdReactHost.parentNode ) {
			__wpdReactHost.parentNode.removeChild( __wpdReactHost );
		}
		__wpdReactHost       = null;
		__wpdReactMounted    = false;
		__wpdLastRawCommands = [];
		__wpdCommandCallbacks = Object.create( null );
	}

	function __wpdPostCommandsList() {
		var list = __wpdHarvestCommands();

		var key = '';
		for ( var k = 0; k < list.length; k++ ) {
			var lc = list[ k ];
			key += ( lc && lc.name ? lc.name : '' ) + '|'
				+ ( lc && lc.kind ? lc.kind : '' ) + '|'
				+ ( lc && lc.url  ? lc.url  : '' ) + '\n';
		}
		if ( key === __wpdCommandsLastPayload ) {
			return;
		}
		__wpdCommandsLastPayload = key;
		try {
			window.parent.postMessage(
				{ type: 'os-commands-list', commands: list },
				__wpdCommandsOrigin
			);
		} catch ( _err ) {

		}
	}

	function __wpdSchedulePost() {
		if ( __wpdCommandsDebounceId !== null ) return;
		__wpdCommandsDebounceId = window.setTimeout( function () {
			__wpdCommandsDebounceId = null;
			__wpdPostCommandsList();
		}, 60 );
	}

	function __wpdSubscribeCommands() {
		__wpdCommandsSubscribed = true;

		if ( __wpdReactMounted ) {
			__wpdCommandsLastPayload = '';
			__wpdSchedulePost();
			return;
		}

		var attempts = 0;
		function tryBind() {
			if ( ! __wpdCommandsSubscribed ) return;
			if ( ! window.wp || ! window.wp.data || typeof window.wp.data.subscribe !== 'function' ) {
				if ( attempts++ < 40 ) {
					window.setTimeout( tryBind, 150 );
				}
				return;
			}

			__wpdMountReactHarvester();
		}
		tryBind();
	}

	function __wpdUnsubscribeCommands() {
		__wpdCommandsSubscribed  = false;
		__wpdCommandsLastPayload = '';
		if ( __wpdCommandsDebounceId !== null ) {
			try { window.clearTimeout( __wpdCommandsDebounceId ); } catch ( _err ) {               }
			__wpdCommandsDebounceId = null;
		}

		__wpdUnmountReactHarvester();
	}

	function __wpdInvokeCommand( name ) {
		var cb = __wpdCommandCallbacks[ name ];
		if ( typeof cb === 'function' ) {
			try {
				cb( { close: function () {} } );
			} catch ( _err ) {

			}
			return;
		}

		if ( ! window.wp || ! window.wp.data ) {
			return;
		}
		var sel = null;
		try { sel = window.wp.data.select( 'core/commands' ); } catch ( _err ) { return; }
		if ( ! sel || typeof sel.getCommands !== 'function' ) return;
		var raw;
		try { raw = sel.getCommands(); } catch ( _err ) { return; }
		if ( ! raw ) return;
		for ( var i = 0; i < raw.length; i++ ) {
			if ( raw[ i ] && raw[ i ].name === name && typeof raw[ i ].callback === 'function' ) {
				try {
					raw[ i ].callback( { close: function () {} } );
				} catch ( _err ) {

				}
				return;
			}
		}
	}

	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== __wpdCommandsOrigin ) return;
		if ( ! e.data || typeof e.data.type !== 'string' ) return;
		if ( e.data.type === 'os-commands-subscribe' ) {
			__wpdSubscribeCommands();
		} else if ( e.data.type === 'os-commands-unsubscribe' ) {
			__wpdUnsubscribeCommands();
		} else if ( e.data.type === 'os-commands-invoke' && typeof e.data.name === 'string' ) {
			__wpdInvokeCommand( e.data.name );
		}
	} );

	try {
		window.parent.postMessage(
			{ type: 'os-bridge-ready' },
			__wpdCommandsOrigin
		);
	} catch ( _err ) {

	}

	( function () {
		var savedInterval = null;

		window.addEventListener( 'message', function ( e ) {
			if ( e.origin !== window.location.origin || e.source !== window.parent ) return;
			var d = e && e.data;
			if ( ! d || typeof d !== 'object' || d.type !== 'os-window-active' ) return;
			var hb = window.wp && window.wp.heartbeat;
			if ( ! hb || typeof hb.interval !== 'function' ) return;
			try {
				if ( d.active === false ) {
					var current = hb.interval();
					if (
						savedInterval === null &&
						typeof current === 'number' &&
						current >= 15 &&
						current < 120
					) {
						savedInterval = current;
						hb.interval( 120 );
					}
				} else if ( d.active === true && savedInterval !== null ) {
					if ( hb.interval() === 120 ) {
						hb.interval( savedInterval );
					}
					savedInterval = null;
				}
			} catch ( _err ) {

			}
		} );
	} () );

	document.addEventListener( 'keydown', function ( e ) {
		if ( e.ctrlKey || e.metaKey || e.altKey ) return;
		if ( e.code !== 'Backquote' ) return;

		var el = document.activeElement;
		if ( el ) {
			var tag = el.tagName;
			if ( tag === 'IFRAME' ) return;
			if ( tag === 'TEXTAREA' ) return;
			if ( tag === 'INPUT' ) {
				var type = ( el.type || '' ).toLowerCase();
				var textTypes = [
					'text', 'search', 'url', 'email', 'password',
					'tel', 'number', 'date', 'datetime-local',
					'month', 'week', 'time'
				];
				if ( textTypes.indexOf( type ) !== -1 ) return;
			}
			if ( el.isContentEditable ) return;
		}

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{
					type:      'os-window-switch',
					direction: e.shiftKey ? 'prev' : 'next'
				},
				window.location.origin
			);
		} catch ( err ) {                                    }
	}, true );

	document.addEventListener( 'keydown', function ( e ) {
		if ( ! ( e.metaKey || e.ctrlKey ) ) return;
		if ( ! e.altKey || e.shiftKey ) return;
		if ( e.code !== 'KeyW' ) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{ type: 'os-window-close-all' },
				window.location.origin
			);
		} catch ( err ) {                                    }
	}, true );

	var origin = window.location.origin;

	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'os-broadcast' ) {
			return;
		}
		try {
			document.dispatchEvent( new CustomEvent( 'os-broadcast', {
				detail: { topic: e.data.topic, payload: e.data.payload }
			} ) );
		} catch ( _err ) {                                                     }
	} );

	var OPENSTATION_SOFT_RELOAD_EXTRAS = ( '_softReload' in __OS_DATA ) ? __OS_DATA._softReload : [];

	function _openstationEndsWith( s, suffix ) { return s.lastIndexOf( suffix ) === s.length - suffix.length; }

	function _openstationListType() {
		if ( _openstationEndsWith( location.pathname, '/wp-admin/edit.php' ) ) {
			return new URLSearchParams( location.search ).get( 'post_type' ) || 'post';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/upload.php' ) ) {
			return 'attachment';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/edit-comments.php' ) ) {
			return 'comment';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/plugins.php' ) ) {
			return 'plugin';
		}

		return null;
	}

	function _openstationMatchesExtraRule( rule ) {
		if ( ! rule || ! rule.path ) {
			return false;
		}
		if ( ! _openstationEndsWith( location.pathname, '/wp-admin/' + rule.path ) ) {
			return false;
		}
		var params = new URLSearchParams( location.search );
		if ( rule.query ) {
			for ( var key in rule.query ) {
				if ( ! Object.prototype.hasOwnProperty.call( rule.query, key ) ) {
					continue;
				}
				if ( params.get( key ) !== String( rule.query[ key ] ) ) {
					return false;
				}
			}
		}
		if ( rule.queryAbsent ) {
			for ( var i = 0; i < rule.queryAbsent.length; i++ ) {
				if ( params.has( rule.queryAbsent[ i ] ) ) {
					return false;
				}
			}
		}
		return true;
	}

	function _openstationSoftReloadTopicMatches( topic ) {
		var m = /^os\.(.+)\.changed$/.exec( topic );
		if ( m && m[ 1 ] === _openstationListType() ) {
			return true;
		}
		for ( var i = 0; i < OPENSTATION_SOFT_RELOAD_EXTRAS.length; i++ ) {
			var rule = OPENSTATION_SOFT_RELOAD_EXTRAS[ i ];
			if ( rule && rule.topic === topic && _openstationMatchesExtraRule( rule ) ) {
				return true;
			}
		}
		return false;
	}

	var _openstationSoftReloadInFlight = false;
	var _openstationSoftReloadQueued = false;

	function _openstationReinitListTables() {
		var $ = window.jQuery;
		if ( ! $ ) {
			return;
		}

		$( '#wpbody-content tbody' ).on( 'click', '.toggle-row', function () {
			$( this ).closest( 'tr' ).toggleClass( 'is-expanded' );
		} );

		if ( document.getElementById( 'the-list' ) ) {
			try {
				if ( window.inlineEditPost && typeof window.inlineEditPost.init === 'function' ) {
					window.inlineEditPost.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'inline-edit-post', err ); }
			try {
				if ( window.inlineEditTax && typeof window.inlineEditTax.init === 'function' ) {
					window.inlineEditTax.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'inline-edit-tax', err ); }
		}

		if ( document.getElementById( 'the-comment-list' ) && window.commentReply ) {
			try {
				if ( typeof window.commentReply.init === 'function' ) {
					window.commentReply.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'comment-reply', err ); }
			try {
				$( '#the-comment-list' ).on( 'click', '.comment-inline', function () {
					var $el = $( this ),
						action = 'replyto';

					if ( 'undefined' !== typeof $el.data( 'action' ) ) {
						action = $el.data( 'action' );
					}

					$( this ).attr( 'aria-expanded', 'true' );
					window.commentReply.open( $el.data( 'commentId' ), $el.data( 'postId' ), action );
				} );
			} catch ( err ) { _openstationWarnReinit( 'comment-inline', err ); }
		}
	}

	function _openstationWarnReinit( which, err ) {
		if ( window.console && window.console.warn ) {
			window.console.warn( '[openstation] soft-reload re-init failed for ' + which + ':', err );
		}
	}

	function _openstationSoftReload() {
		if ( _openstationSoftReloadInFlight ) {
			_openstationSoftReloadQueued = true;
			return;
		}
		_openstationSoftReloadInFlight = true;
		fetch( location.href, {
			credentials: 'same-origin',
			cache: 'no-cache',
			headers: { 'X-WP-Desktop-Soft-Reload': '1' }
		} ).then( function ( r ) {
			if ( ! r.ok ) throw new Error( 'soft-reload fetch failed: ' + r.status );
			return r.text();
		} ).then( function ( html ) {
			var doc = new DOMParser().parseFromString( html, 'text/html' );
			var fresh = doc.querySelector( '#wpbody-content' );
			var live = document.querySelector( '#wpbody-content' );
			if ( ! fresh || ! live ) {
				return;
			}

			live.replaceChildren.apply( live, Array.prototype.slice.call( fresh.childNodes ) );
			_openstationReinitListTables();
			try {
				document.dispatchEvent( new CustomEvent( 'os-soft-reloaded' ) );
			} catch ( _err ) {}
		} ).catch( function ( err ) {
			if ( window.console && window.console.warn ) {
				window.console.warn( '[openstation] soft-reload skipped:', err );
			}
		} ).then( function () {
			_openstationSoftReloadInFlight = false;
			if ( _openstationSoftReloadQueued ) {
				_openstationSoftReloadQueued = false;
				_openstationSoftReload();
			}
		} );
	}

	document.addEventListener( 'os-broadcast', function ( e ) {
		var detail = e.detail || {};
		var topic = detail.topic;
		if ( ! topic ) return;
		if ( _openstationSoftReloadTopicMatches( topic ) ) {
			_openstationSoftReload();
		}
	} );

	if ( window.__openStationScreenMetaInstalled ) {
		return;
	}
	window.__openStationScreenMetaInstalled = true;

	function hasScreenOptionsContent() {
		var wrap = document.getElementById( 'screen-options-wrap' );

		return !! wrap && !! wrap.querySelector( 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea' );
	}

	function hasHelpContent() {
		var wrap = document.getElementById( 'contextual-help-wrap' );
		if ( ! wrap ) {
			return false;
		}
		var panelEls = wrap.querySelectorAll( '.help-tab-content, .contextual-help-sidebar' );
		for ( var i = 0; i < panelEls.length; i++ ) {
			if ( ( panelEls[ i ].textContent || '' ).trim() !== '' ) {
				return true;
			}
		}
		return false;
	}

	var links = document.getElementById( 'screen-meta-links' );
	var screenOptionsBtn = links ? document.getElementById( 'show-settings-link' ) : null;
	var helpBtn = links ? document.getElementById( 'contextual-help-link' ) : null;
	var panels = [];
	if ( screenOptionsBtn && hasScreenOptionsContent() ) {
		panels.push( 'screen-options' );
	}
	if ( helpBtn && hasHelpContent() ) {
		panels.push( 'help' );
	}

	window.parent.postMessage( {
		type: 'os-screen-meta',
		panels: panels
	}, origin );

	if ( panels.length === 0 ) {
		return;
	}

	function getOpenPanel() {
		if ( screenOptionsBtn && screenOptionsBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'screen-options';
		}
		if ( helpBtn && helpBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'help';
		}
		return null;
	}

	function reportState() {
		window.parent.postMessage( {
			type: 'os-screen-meta-state',
			open: getOpenPanel()
		}, origin );
	}

	reportState();

	var observer = new MutationObserver( reportState );
	if ( screenOptionsBtn ) {
		observer.observe( screenOptionsBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}
	if ( helpBtn ) {
		observer.observe( helpBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}

	function forceClose( button ) {
		if ( ! button || button.getAttribute( 'aria-expanded' ) !== 'true' ) {
			return;
		}
		var panelId = button.getAttribute( 'aria-controls' );
		var panel = panelId ? document.getElementById( panelId ) : null;
		if ( ! panel ) {
			return;
		}
		if ( window.jQuery ) {
			window.jQuery( panel ).stop( true, false );
		}
		panel.style.display = 'none';
		panel.classList.add( 'hidden' );
		if ( panel.parentNode instanceof HTMLElement ) {
			panel.parentNode.style.display = 'none';
		}
		button.classList.remove( 'screen-meta-active' );
		button.setAttribute( 'aria-expanded', 'false' );
		var toggles = document.querySelectorAll( '.screen-meta-toggle' );
		for ( var i = 0; i < toggles.length; i++ ) {
			toggles[ i ].style.visibility = '';
		}
	}

	window.addEventListener( 'message', function( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'os-toggle-panel' ) {
			return;
		}
		var target = null;
		if ( e.data.panel === 'screen-options' && screenOptionsBtn ) {
			target = screenOptionsBtn;
		} else if ( e.data.panel === 'help' && helpBtn ) {
			target = helpBtn;
		}
		if ( ! target ) {
			return;
		}
		if ( target.getAttribute( 'aria-expanded' ) !== 'true' ) {
			var other = target === screenOptionsBtn ? helpBtn : screenOptionsBtn;
			forceClose( other );
		}
		target.click();
	} );

	var _wpdConnections = {};
	var _wpdConnectionListeners = [];
	var _wpdSubs = {};
	var _wpdChannelSubs = {};
	var _wpdParentOrigin = window.location.origin;
	var _wpdWindowId = null;
	var _wpdWindowIdWaiters = [];

	function _wpdSetWindowId( id ) {
		if ( ! id || _wpdWindowId === id ) {
			return;
		}
		_wpdWindowId = id;
		var waiters = _wpdWindowIdWaiters.splice( 0 );
		for ( var i = 0; i < waiters.length; i++ ) {
			try {
				waiters[ i ]( id );
			} catch ( _err ) {               }
		}
	}

	function _wpdEmitToParent( connectionId, topic, payload ) {
		try {
			window.parent.postMessage( {
				type: 'os-bridge-publish',
				connectionId: connectionId,
				topic: topic,
				payload: payload
			}, _wpdParentOrigin );
		} catch ( _err ) {                   }
	}

	window.addEventListener( 'message', function ( ev ) {
		if ( ev.origin !== _wpdParentOrigin ) {
			return;
		}
		var data = ev && ev.data;
		if ( ! data || typeof data !== 'object' || typeof data.type !== 'string' ) {
			return;
		}

		if ( data.type === 'os-bridge-beforeunload-query' ) {
			var prevent = false;
			var msg = '';

			function shimReturnValue( beforeUnloadEv ) {
				Object.defineProperty( beforeUnloadEv, 'returnValue', {
					get: function() { return this._returnValue || ''; },
					set: function( v ) { this._returnValue = v; }
				} );
			}

			function checkPrevent( beforeUnloadEv, result ) {
				var hasRes = typeof result === 'string' && result !== '';
				var hasRetVal = typeof beforeUnloadEv.returnValue === 'string' && beforeUnloadEv.returnValue !== '';
				if ( beforeUnloadEv.defaultPrevented || hasRes || hasRetVal ) {
					prevent = true;
					if ( hasRes ) {
						msg = result;
					} else if ( hasRetVal ) {
						msg = beforeUnloadEv.returnValue;
					}
				}
			}

			var unloadEvent;
			try {
				unloadEvent = new Event( 'beforeunload', { cancelable: true } );
			} catch ( _err ) {
				unloadEvent = document.createEvent( 'Event' );
				unloadEvent.initEvent( 'beforeunload', false, true );
			}
			shimReturnValue( unloadEvent );

			if ( typeof window.onbeforeunload === 'function' ) {
				var res = window.onbeforeunload( unloadEvent );
				checkPrevent( unloadEvent, res );
			}
			if ( ! prevent ) {
				var dispatchEvent;
				try {
					dispatchEvent = new Event( 'beforeunload', { cancelable: true } );
				} catch ( _err ) {
					dispatchEvent = document.createEvent( 'Event' );
					dispatchEvent.initEvent( 'beforeunload', false, true );
				}
				shimReturnValue( dispatchEvent );
				window.dispatchEvent( dispatchEvent );
				checkPrevent( dispatchEvent, null );
			}

			try {
				var reply = {
					type: 'os-bridge-beforeunload-response',
					prevent: prevent,
					message: msg
				};
				if ( typeof data.requestId === 'string' && data.requestId !== '' ) {
					reply.requestId = data.requestId;
				}
				window.parent.postMessage( reply, _wpdParentOrigin );
			} catch ( _err ) {               }
			return;
		}

		if ( data.type === 'os-bridge-handshake' && typeof data.connectionId === 'string' ) {
			if ( typeof data.targetWindowId === 'string' && data.targetWindowId !== '' ) {
				_wpdSetWindowId( data.targetWindowId );
			}
			if ( _wpdConnections[ data.connectionId ] ) {
				try {
					window.parent.postMessage( {
						type: 'os-bridge-handshake-ack',
						connectionId: data.connectionId
					}, _wpdParentOrigin );
				} catch ( _err ) {               }
				return;
			}
			var conn = {
				id: data.connectionId,
				topics: Array.isArray( data.topics ) ? data.topics.slice() : []
			};
			_wpdConnections[ conn.id ] = conn;
			try {
				window.parent.postMessage( {
					type: 'os-bridge-handshake-ack',
					connectionId: conn.id
				}, _wpdParentOrigin );
			} catch ( _err ) {               }
			for ( var i = 0; i < _wpdConnectionListeners.length; i++ ) {
				try {
					_wpdConnectionListeners[ i ]( {
						id: conn.id,
						topics: conn.topics.slice()
					} );
				} catch ( _err ) {                        }
			}
			return;
		}

		if ( data.type === 'os-bridge-publish' && typeof data.topic === 'string' ) {
			var bucket = _wpdSubs[ data.topic ];
			if ( bucket ) {
				for ( var j = 0; j < bucket.length; j++ ) {
					try {
						bucket[ j ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) {                          }
				}
			}
			var wildcard = _wpdSubs[ '*' ];
			if ( wildcard ) {
				for ( var k = 0; k < wildcard.length; k++ ) {
					try {
						wildcard[ k ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) {               }
				}
			}
			return;
		}

		if ( data.type === 'os-bridge-disconnect' && typeof data.connectionId === 'string' ) {
			delete _wpdConnections[ data.connectionId ];
			return;
		}

		if ( data.type === 'os-window-send' && typeof data.channel === 'string' && data.channel !== '' ) {
			var meta = { channel: data.channel };
			var cBucket = _wpdChannelSubs[ data.channel ];
			if ( cBucket ) {
				var cBucketSnap = cBucket.slice();
				for ( var ci = 0; ci < cBucketSnap.length; ci++ ) {
					try {
						cBucketSnap[ ci ]( data.payload, meta );
					} catch ( _err ) {               }
				}
			}
			var cWildcard = _wpdChannelSubs[ '*' ];
			if ( cWildcard ) {
				var cWildcardSnap = cWildcard.slice();
				for ( var cw = 0; cw < cWildcardSnap.length; cw++ ) {
					try {
						cWildcardSnap[ cw ]( data.payload, meta );
					} catch ( _err ) {               }
				}
			}
		}
	} );

	var iframeApi = {

		publish: function ( topic, payload ) {
			if ( typeof topic !== 'string' || topic === '' ) {
				return;
			}
			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				_wpdEmitToParent( ids[ i ], topic, payload );
			}
		},

		subscribe: function ( topic, cb ) {
			if ( typeof topic !== 'string' || topic === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdSubs[ topic ];
			if ( ! bucket ) {
				bucket = [];
				_wpdSubs[ topic ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		},

		onConnection: function ( cb ) {
			if ( typeof cb !== 'function' ) {
				return function () {};
			}
			_wpdConnectionListeners.push( cb );

			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				try {
					cb( {
						id: _wpdConnections[ ids[ i ] ].id,
						topics: _wpdConnections[ ids[ i ] ].topics.slice()
					} );
				} catch ( _err ) {               }
			}
			return function () {
				var idx = _wpdConnectionListeners.indexOf( cb );
				if ( idx >= 0 ) {
					_wpdConnectionListeners.splice( idx, 1 );
				}
			};
		},

		requestConnection: function ( opts ) {
			opts = opts || {};
			var topics = Array.isArray( opts.topics ) ? opts.topics.slice() : [];
			var requestId = 'wpdir-' + Math.random().toString( 36 ).slice( 2, 10 );

			return new Promise( function ( resolve, reject ) {
				var settled = false;
				var timeoutMs = typeof opts.timeoutMs === 'number'
					? opts.timeoutMs
					: 5000;

				function settle( ok, value ) {
					if ( settled ) {
						return;
					}
					settled = true;
					window.removeEventListener( 'message', onAck );
					clearTimeout( timer );
					if ( ok ) {
						resolve( value );
					} else {
						reject( value );
					}
				}

				function onAck( ev ) {
					if ( ev.origin !== _wpdParentOrigin ) {
						return;
					}
					var d = ev && ev.data;
					if (
						! d ||
						typeof d !== 'object' ||
						d.type !== 'os-bridge-connection-ack' ||
						d.requestId !== requestId
					) {
						return;
					}
					if ( d.accepted ) {
						var summary = {
							id: typeof d.connectionId === 'string' ? d.connectionId : '',
							topics: topics.slice()
						};
						if ( typeof opts.onOpen === 'function' ) {
							try { opts.onOpen( summary ); } catch ( _err ) {               }
						}
						settle( true, summary );
					} else {
						settle( false, new Error( d.reason || 'rejected' ) );
					}
				}
				window.addEventListener( 'message', onAck );

				var timer = setTimeout( function () {
					settle( false, new Error( 'timeout' ) );
				}, timeoutMs );

				try {
					window.parent.postMessage( {
						type: 'os-bridge-connection-request',
						requestId: requestId,
						topics: topics
					}, _wpdParentOrigin );
				} catch ( err ) {
					settle( false, err );
				}
			} );
		},

		chrome: {
			setTheme: function ( tokens ) {
				try {
					window.parent.postMessage( {
						type: 'os-chrome-theme',
						tokens: tokens || {}
					}, _wpdParentOrigin );
				} catch ( _err ) {                   }
			},
			setControls: function ( config ) {
				try {
					window.parent.postMessage( {
						type: 'os-chrome-controls',
						config: config === undefined ? null : config
					}, _wpdParentOrigin );
				} catch ( _err ) {                   }
			},
			setSlot: function ( name, html ) {
				if ( typeof name !== 'string' || name === '' ) {
					return;
				}
				try {
					window.parent.postMessage( {
						type: 'os-chrome-slot',
						slot: name,
						html: typeof html === 'string' ? html : ''
					}, _wpdParentOrigin );
				} catch ( _err ) {                   }
			}
		},

		get windowId() {
			return _wpdWindowId;
		},

		whenWindowId: function () {
			if ( _wpdWindowId !== null ) {
				return Promise.resolve( _wpdWindowId );
			}
			return new Promise( function ( resolve ) {
				_wpdWindowIdWaiters.push( resolve );
			} );
		},

		isParentReachable: function () {
			if ( ! window.parent || window.parent === window ) {
				return false;
			}
			try {
				return window.parent.location.origin === _wpdParentOrigin;
			} catch ( _err ) {
				return false;
			}
		}
	};

	if ( ! window.wp ) { window.wp = {}; }
	if ( ! window.wp.os ) { window.wp.os = {}; }
	window.wp.os.iframe = iframeApi;

	if ( typeof window.wp.os.send !== 'function' ) {
		window.wp.os.send = function ( channel, payload ) {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage( {
					type: 'os-window-publish',
					channel: channel,
					payload: payload
				}, _wpdParentOrigin );
			} catch ( _err ) {                   }
		};
	}
	if ( typeof window.wp.os.on !== 'function' ) {
		window.wp.os.on = function ( channel, cb ) {
			if ( typeof channel !== 'string' || channel === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdChannelSubs[ channel ];
			if ( ! bucket ) {
				bucket = [];
				_wpdChannelSubs[ channel ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		};
	}

	( function _wpdInstallAuthCheckRecovery() {
		var attached = false;
		var sawLoggedOut = false;
		function attach() {
			if ( attached || ! window.jQuery ) {
				return;
			}
			attached = true;
			window.jQuery( document ).on( 'heartbeat-tick.osAuthRecover', function ( ev, data ) {
				if ( ! data || typeof data !== 'object' || ! ( 'wp-auth-check' in data ) ) {
					return;
				}
				if ( data[ 'wp-auth-check' ] === false ) {
					sawLoggedOut = true;
					return;
				}
				if ( sawLoggedOut && data[ 'wp-auth-check' ] === true ) {
					sawLoggedOut = false;

					try {
						if ( window.parent && window.parent !== window ) {
							window.parent.postMessage(
								{ type: 'os-reauth-detected' },
								window.location.origin
							);
						}
					} catch ( _err ) {                   }
					try { window.location.reload(); } catch ( _err ) {               }
				}
			} );
		}
		attach();
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', attach, { once: true } );
		}
		window.addEventListener( 'load', attach, { once: true } );
	} )();

	( function _wpdInstallShinyUpdateWatcher() {
		var attached = false;
		function notify() {
			try {
				var queue = window.wp && window.wp.updates && window.wp.updates.queue;
				if ( queue && queue.length > 0 ) {
					return;
				}
			} catch ( _err ) {                                          }
			try {
				var shell = window.top || window.parent;
				if ( shell && shell !== window ) {
					shell.postMessage(
						{ type: 'os-updates-changed' },
						window.location.origin
					);
				}
			} catch ( _err ) {                                  }
		}
		function notifyPluginInstall() {
			try {
				var shell = window.top || window.parent;
				if ( shell && shell !== window ) {
					shell.postMessage(
						{
							type: 'os-broadcast',
							topic: 'os.plugin.changed',
							payload: { source: 'chromeless-bridge', action: 'install' }
						},
						window.location.origin
					);
				}
			} catch ( _err ) {                                  }
		}
		function attach() {
			if ( attached || ! window.jQuery ) {
				return;
			}
			attached = true;
			window.jQuery( document ).on(
				[
					'wp-plugin-update-success.osUpdates',
					'wp-plugin-update-error.osUpdates',
					'wp-plugin-delete-success.osUpdates',
					'wp-theme-update-success.osUpdates',
					'wp-theme-update-error.osUpdates',
					'wp-theme-delete-success.osUpdates'
				].join( ' ' ),
				notify
			);
			window.jQuery( document ).on( 'wp-plugin-install-success.osUpdates', notifyPluginInstall );
		}
		attach();
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', attach, { once: true } );
		}
		window.addEventListener( 'load', attach, { once: true } );
	} )();

	try {
		if ( window.parent && window.parent !== window ) {
			window.parent.postMessage(
				{ type: 'os-ready' },
				window.location.origin
			);
		}
	} catch ( _err ) {                                   }
} )();
