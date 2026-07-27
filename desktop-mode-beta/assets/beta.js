/**
 * Desktop Mode Beta — build picker UI.
 *
 * One script, two render contexts, selected by the localized
 * `desktopModeBetaConfig.context`:
 *
 *   - `shell` — registers an OS Settings "Beta" tab through
 *     `wp.desktop.registerSettingsTab()` and renders with the
 *     framework's `<wpd-*>` components.
 *   - `admin` — paints the plain Tools → Desktop Mode Beta page with
 *     classic wp-admin markup. No Desktop Mode APIs are touched here
 *     on purpose: this page must keep working when a broken branch
 *     build takes the shell down.
 *
 * All GitHub-derived strings are inserted via `textContent` — never
 * concatenated into HTML.
 *
 * @package DesktopModeBeta
 */
( function () {
	'use strict';

	var config = window.desktopModeBetaConfig;
	if ( ! config || ! config.ajaxUrl ) {
		return;
	}

	var __ =
		window.wp && window.wp.i18n && window.wp.i18n.__
			? window.wp.i18n.__
			: function ( text ) {
					return text;
			  };

	/**
	 * POST an admin-ajax action. Routes through `wp.desktop.fetch` when
	 * the shell is present so the request feeds the activity bus; falls
	 * back to plain fetch on the standalone admin page.
	 *
	 * @param {string} action Action suffix (`state` | `switch`).
	 * @param {Object} params Extra body params.
	 * @return {Promise<Object>} Resolves with the `data` payload.
	 */
	function request( action, params ) {
		var body = new URLSearchParams();
		body.set( 'action', 'desktop_mode_beta_' + action );
		body.set( '_ajax_nonce', config.nonce );
		Object.keys( params || {} ).forEach( function ( key ) {
			body.set( key, params[ key ] );
		} );

		var desktop = window.wp && window.wp.desktop;
		var init = {
			method: 'POST',
			credentials: 'same-origin',
			body: body,
		};
		var promise =
			desktop && typeof desktop.fetch === 'function'
				? desktop.fetch( config.ajaxUrl, init, {
						source: 'desktop-mode-beta/' + action,
				  } )
				: fetch( config.ajaxUrl, init );

		return promise
			.then( function ( response ) {
				return response.json();
			} )
			.then( function ( json ) {
				if ( ! json || ! json.success ) {
					var message =
						json && json.data && json.data.message
							? json.data.message
							: __( 'Request failed. Try again.' );
					throw new Error( message );
				}
				return json.data;
			} );
	}

	/**
	 * DOM builder. Children that are strings become text nodes.
	 *
	 * @param {string}        tag      Tag name.
	 * @param {Object}        attrs    Attribute map (`style` allowed).
	 * @param {Array|Node|string} children Children.
	 * @return {HTMLElement}
	 */
	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		Object.keys( attrs || {} ).forEach( function ( name ) {
			var value = attrs[ name ];
			if ( null === value || undefined === value || false === value ) {
				return;
			}
			node.setAttribute( name, true === value ? '' : String( value ) );
		} );
		( Array.isArray( children ) ? children : [ children ] ).forEach(
			function ( child ) {
				if ( null === child || undefined === child ) {
					return;
				}
				node.append(
					'string' === typeof child
						? document.createTextNode( child )
						: child
				);
			}
		);
		return node;
	}

	function shortSha( sha ) {
		return sha ? String( sha ).slice( 0, 7 ) : '';
	}

	function formatWhen( value ) {
		var date =
			'number' === typeof value
				? new Date( value * 1000 )
				: new Date( value );
		return isNaN( date.getTime() ) ? '' : date.toLocaleString();
	}

	// -----------------------------------------------------------------
	// Skins — tiny element factories per context.
	// -----------------------------------------------------------------

	var shellSkin = {
		section: function ( heading, description ) {
			return el( 'wpd-section', {
				heading: heading,
				description: description || null,
				stack: true,
			} );
		},
		row: function ( children ) {
			return el(
				'div',
				{
					style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
				},
				children
			);
		},
		button: function ( label, variant ) {
			return el( 'wpd-button', { variant: variant || 'ghost' }, label );
		},
		badge: function ( label, tone ) {
			return el( 'wpd-badge', { tone: tone }, label );
		},
		code: function ( text ) {
			return el( 'wpd-code', {}, text );
		},
		muted: function ( text ) {
			return el(
				'span',
				{ style: 'opacity:.7;font-size:12px;' },
				text
			);
		},
		error: function ( text ) {
			return el(
				'p',
				{ style: 'color:var(--wpd-danger,#d63638);margin:4px 0;' },
				text
			);
		},
	};

	var adminSkin = {
		section: function ( heading, description ) {
			var section = el( 'div', {
				class: 'desktop-mode-beta-section',
			} );
			section.append( el( 'h2', {}, heading ) );
			if ( description ) {
				section.append(
					el( 'p', { class: 'description' }, description )
				);
			}
			return section;
		},
		row: function ( children ) {
			return el(
				'div',
				{ class: 'desktop-mode-beta-row' },
				children
			);
		},
		button: function ( label, variant ) {
			return el(
				'button',
				{
					type: 'button',
					class:
						'primary' === variant
							? 'button button-primary'
							: 'button',
				},
				label
			);
		},
		badge: function ( label, tone ) {
			return el(
				'span',
				{ class: 'desktop-mode-beta-badge is-' + ( tone || 'neutral' ) },
				label
			);
		},
		code: function ( text ) {
			return el( 'code', {}, text );
		},
		muted: function ( text ) {
			return el( 'span', { class: 'description' }, text );
		},
		error: function ( text ) {
			return el(
				'div',
				{ class: 'notice notice-error inline' },
				el( 'p', {}, text )
			);
		},
	};

	// -----------------------------------------------------------------
	// Confirmation.
	// -----------------------------------------------------------------

	/**
	 * Ask before switching. Uses the framework confirm dialog when the
	 * shell is present; otherwise arms the pressed button for a second,
	 * explicit click (no native dialogs — they block the page).
	 *
	 * @param {string}      message Confirmation copy.
	 * @param {HTMLElement} button  The button that was pressed.
	 * @return {Promise<boolean>}
	 */
	function confirmSwitch( message, button ) {
		var desktop = window.wp && window.wp.desktop;
		if ( desktop && typeof desktop.confirm === 'function' ) {
			return desktop.confirm( {
				title: __( 'Switch Desktop Mode build?' ),
				message: message,
				confirmLabel: __( 'Install' ),
				danger: true,
			} );
		}

		if ( button.dataset.armed ) {
			delete button.dataset.armed;
			return Promise.resolve( true );
		}
		button.dataset.armed = '1';
		var previous = button.textContent;
		button.textContent = __( 'Click again to confirm' );
		window.setTimeout( function () {
			if ( button.dataset.armed ) {
				delete button.dataset.armed;
				button.textContent = previous;
			}
		}, 5000 );
		return Promise.resolve( false );
	}

	// -----------------------------------------------------------------
	// App.
	// -----------------------------------------------------------------

	/**
	 * Mount the picker into a root node.
	 *
	 * @param {HTMLElement} root Container to paint into.
	 * @param {Object}      skin Element factory for the context.
	 */
	function mount( root, skin ) {
		var busy = false;
		var lastError = null;

		function load( refresh ) {
			root.textContent = '';
			root.append(
				el( 'p', {}, __( 'Loading builds…' ) )
			);
			request( 'state', refresh ? { refresh: '1' } : {} ).then(
				function ( state ) {
					render( state );
				},
				function ( error ) {
					root.textContent = '';
					root.append( skin.error( error.message ) );
					root.append(
						wireButton(
							skin.button( __( 'Retry' ), 'primary' ),
							function () {
								load( true );
							}
						)
					);
				}
			);
		}

		function wireButton( button, handler ) {
			button.addEventListener( 'click', function () {
				if ( busy || button.hasAttribute( 'disabled' ) ) {
					return;
				}
				handler( button );
			} );
			return button;
		}

		function doSwitch( source, id, message, button ) {
			confirmSwitch( message, button ).then( function ( confirmed ) {
				if ( ! confirmed ) {
					return;
				}
				busy = true;
				button.setAttribute( 'busy', '' );
				button.setAttribute( 'disabled', '' );
				request( 'switch', { source: source, id: id || '' } ).then(
					function () {
						root.textContent = '';
						root.append(
							el(
								'p',
								{},
								__(
									'Build installed. Reloading to pick up the new code…'
								)
							)
						);
						window.setTimeout( function () {
							window.location.reload();
						}, 1200 );
					},
					function ( error ) {
						busy = false;
						button.removeAttribute( 'busy' );
						button.removeAttribute( 'disabled' );
						if ( lastError ) {
							lastError.remove();
						}
						lastError = skin.error( error.message );
						root.prepend( lastError );
					}
				);
			} );
		}

		function currentLabel( current ) {
			if ( ! current.managed ) {
				return __( 'Stable release' );
			}
			if ( 'trunk' === current.source ) {
				return __( 'Trunk (bleeding edge)' );
			}
			if ( 'pr' === current.source ) {
				/* translators: %s: pull request number */
				return __( 'Pull request #' ) + current.id;
			}
			return current.source;
		}

		function render( state ) {
			root.textContent = '';
			var current = state.current;

			// --- Current build ------------------------------------
			var currentSection = skin.section(
				__( 'Current build' ),
				__( 'The Desktop Mode version this site is running.' )
			);
			var currentRow = [
				skin.badge(
					currentLabel( current ),
					current.managed ? 'warning' : 'success'
				),
				skin.code(
					current.version
						? 'v' + current.version
						: __( 'not installed' )
				),
			];
			if ( current.sha ) {
				currentRow.push( skin.code( shortSha( current.sha ) ) );
			}
			if ( current.branch && 'trunk' !== current.branch ) {
				currentRow.push( skin.code( current.branch ) );
			}
			currentSection.append( skin.row( currentRow ) );
			if ( current.title ) {
				currentSection.append( skin.muted( current.title ) );
			}
			if ( current.installed_at ) {
				currentSection.append(
					skin.muted(
						__( 'Installed ' ) +
							formatWhen( current.installed_at ) +
							( current.installed_by
								? __( ' by ' ) + current.installed_by
								: '' )
					)
				);
			}

			if ( current.update ) {
				var update = current.update;
				var updateRow;
				if ( 'pr-closed' === update.kind ) {
					updateRow = skin.row( [
						skin.badge( __( 'PR closed' ), 'danger' ),
						skin.muted(
							__(
								'The pull request this build came from is no longer open. Switch back to stable.'
							)
						),
					] );
				} else {
					var updateButton = wireButton(
						skin.button( __( 'Update to latest build' ), 'primary' ),
						function ( button ) {
							doSwitch(
								current.source,
								current.id,
								__(
									'Install the newest build for the current channel? This replaces the installed Desktop Mode plugin.'
								),
								button
							);
						}
					);
					updateRow = skin.row( [
						skin.badge( __( 'New build available' ), 'info' ),
						skin.code( shortSha( update.sha ) ),
						updateButton,
					] );
				}
				currentSection.append( updateRow );
			}

			var actions = [];
			if ( current.managed && state.stable ) {
				actions.push(
					wireButton(
						skin.button( __( 'Back to stable' ), 'primary' ),
						function ( button ) {
							doSwitch(
								'stable',
								'',
								__(
									'Reinstall the latest stable release? The beta build is replaced.'
								),
								button
							);
						}
					)
				);
			}
			actions.push(
				wireButton( skin.button( __( 'Refresh' ) ), function () {
					load( true );
				} )
			);
			currentSection.append( skin.row( actions ) );
			root.append( currentSection );

			( state.errors || [] ).forEach( function ( message ) {
				root.append( skin.error( message ) );
			} );

			if ( ! config.canInstall ) {
				root.append(
					skin.error(
						__(
							'Your account cannot install plugins, so switching builds is disabled.'
						)
					)
				);
			}

			// --- Stable + trunk channels --------------------------
			var channels = skin.section(
				__( 'Channels' ),
				__( 'Fixed channels published by the CI pipeline.' )
			);
			if ( state.stable ) {
				channels.append(
					skin.row( [
						skin.badge( __( 'Stable' ), 'success' ),
						skin.code( state.stable.tag ),
						skin.muted(
							__( 'Released ' ) +
								formatWhen( state.stable.published_at )
						),
						wireButton(
							skin.button( __( 'Install' ) ),
							function ( button ) {
								doSwitch(
									'stable',
									'',
									__(
										'Install the latest stable release over the current install?'
									),
									button
								);
							}
						),
					] )
				);
			}
			if ( state.trunk ) {
				channels.append(
					skin.row( [
						skin.badge( __( 'Trunk' ), 'info' ),
						skin.code(
							'v' +
								state.trunk.version +
								' @ ' +
								shortSha( state.trunk.sha )
						),
						skin.muted(
							__( 'Built ' ) + formatWhen( state.trunk.built_at )
						),
						wireButton(
							skin.button( __( 'Install' ) ),
							function ( button ) {
								doSwitch(
									'trunk',
									'',
									__(
										'Install the latest trunk build? This replaces the installed Desktop Mode plugin.'
									),
									button
								);
							}
						),
					] )
				);
			} else {
				channels.append(
					skin.muted(
						__(
							'No trunk build published yet — it appears after the next push to trunk.'
						)
					)
				);
			}
			root.append( channels );

			// --- Pull request branches ----------------------------
			var prSection = skin.section(
				__( 'Pull request branches' ),
				__(
					'Every open pull request with a finished preview build can be installed directly.'
				)
			);
			if ( ! state.prs.length ) {
				prSection.append(
					skin.muted( __( 'No open pull requests.' ) )
				);
			}
			state.prs.forEach( function ( pr ) {
				var isCurrent =
					current.managed &&
					'pr' === current.source &&
					current.id === String( pr.number ) &&
					current.sha === pr.sha;
				var link = el(
					'a',
					{ href: pr.url, target: '_blank', rel: 'noreferrer' },
					'#' + pr.number
				);
				var parts = [
					link,
					el( 'strong', {}, pr.title ),
					skin.code( pr.branch ),
					skin.muted(
						pr.author +
							' · ' +
							formatWhen( pr.updated_at ) +
							( pr.draft ? ' · ' + __( 'draft' ) : '' )
					),
				];
				if ( isCurrent ) {
					parts.push( skin.badge( __( 'Installed' ), 'success' ) );
				} else if ( pr.build_ready ) {
					var installButton = wireButton(
						skin.button( __( 'Install' ) ),
						function ( button ) {
							doSwitch(
								'pr',
								String( pr.number ),
								__( 'Install the build for PR #' ) +
									pr.number +
									' (' +
									pr.branch +
									')? ' +
									__(
										'This replaces the installed Desktop Mode plugin.'
									),
								button
							);
						}
					);
					parts.push( installButton );
				} else {
					parts.push( skin.badge( __( 'Build pending' ), 'neutral' ) );
				}
				prSection.append( skin.row( parts ) );
			} );
			root.append( prSection );
		}

		load( false );
	}

	// -----------------------------------------------------------------
	// Entry points.
	// -----------------------------------------------------------------

	if ( 'shell' === config.context ) {
		var desktop = window.wp && window.wp.desktop;
		if ( ! desktop || 'function' !== typeof desktop.ready ) {
			return;
		}
		desktop.ready( function () {
			window.wp.desktop.registerSettingsTab( {
				id: 'beta',
				label: __( 'Beta' ),
				capability: 'manage_options',
				order: 35,
				owner: 'desktop-mode-beta-settings',
				render: function ( body ) {
					var host = el( 'div', {} );
					body.textContent = '';
					body.append( host );
					mount( host, shellSkin );
				},
			} );
		} );
	} else {
		var boot = function () {
			var root = document.getElementById( 'desktop-mode-beta-root' );
			if ( root ) {
				mount( root, adminSkin );
			}
		};
		if ( 'loading' === document.readyState ) {
			document.addEventListener( 'DOMContentLoaded', boot );
		} else {
			boot();
		}
	}
} )();
