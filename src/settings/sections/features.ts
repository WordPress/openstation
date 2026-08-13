/**
 * Features section — per-user opt-ins for OpenStation behaviors.
 *
 * Visible to every user (no admin gate at the tab level). Toggles here
 * mutate `OsSettingsState` via `ctx.save()` — no dedicated REST
 * endpoint; the existing OS-settings sync debounces the write to user
 * meta.
 *
 * The tab renders two sections: the general "Features" group first,
 * then a "Beta features" group below it holding the opt-in
 * native-window toggles (Posts, Pages, Users, Plugins, Comments — all
 * off by default). As more per-user feature flags land they
 * slot into the matching section so the tab grows by one row at a
 * time, not one tab at a time. For admins the panel appends a third,
 * admin-only "Extended options" section (site-wide toggles — see
 * `./extended`) below these two.
 *
 * The save indicator (`<os-save-status auto>`) hooks the same
 * `os-settings-save-lifecycle` CustomEvent the panel
 * header listens to — both update in lock-step so a user editing
 * here gets feedback at both the section and the panel scope.
 */

import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import { html, render } from '../../ui/core';
import type { SettingsCtx } from '../types';
import { osConfirm } from '../../ui/components/os-confirm-dialog/os-confirm-dialog';
import { showToast } from '../../toast';

// Show the platform-native shortcut: ⌘K on Apple, Ctrl+K elsewhere.
const SHORTCUT_KEY =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad|iPod/i.test(
		navigator.platform || navigator.userAgent || '',
	)
		? '⌘K'
		: 'Ctrl+K';

interface ShellConfigSnapshot {
	seenIntrosUrl?: string;
	restNonce?: string;
	commentsAiUrl?: string;
	commentsAi?: {
		enabled: boolean;
		providerConfigured: boolean;
	} | null;
	/** AI assistant availability + per-user toggle. */
	aiAssistant?: {
		available: boolean;
		/** Baseline text-generation gate (comment scoring mirror). */
		providerConfigured: boolean;
		/** Stricter text-gen + function-calling gate (the assistant). */
		assistantProviderConfigured: boolean;
		enabled: boolean;
		connectorsUrl: string;
	} | null;
	/** REST endpoint to re-check AI provider availability without a reload. */
	aiStatusUrl?: string;
	currentUserIsAdmin?: boolean;
	/**
	 * Base URL for the files REST namespace
	 * (`/wp-json/desktop-mode/v1/files`). Used here so the panel
	 * bundle can hit the destructive purge route directly via
	 * `trackedFetch` instead of importing the REST client from
	 * `../../desktop-files/rest` — that would pull a SECOND copy
	 * of the REST module into the panel bundle, which has its
	 * own uninitialized `deps` (the `installRestDeps()` call lives
	 * in the main bundle).
	 */
	filesUrl?: string;
}

export function buildFeaturesSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onNativePostsToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativePostsEnabled = checked;
		ctx.save();
		paint();
	};

	const onHeartbeatRateChange = ( e: Event ): void => {
		const raw = ( e as CustomEvent ).detail?.value;
		const next = Number( raw );
		if ( ! [ 15, 30, 45, 60 ].includes( next ) ) {
			return;
		}
		ctx.state.heartbeatRate = next as 15 | 30 | 45 | 60;
		ctx.save();
		// Tell WordPress to use the closest matching speed bucket
		// right now — Core only accepts 'standard' / 'slow' (15 / 60).
		// Exact 30 / 45 take effect on the next page load via the
		// `heartbeat_settings` PHP filter.
		try {
			const wp = ( window as unknown as { wp?: { heartbeat?: { interval?: ( speed: string ) => void } } } ).wp;
			const speed = next >= 60 ? 'slow' : 'standard';
			wp?.heartbeat?.interval?.( speed );
		} catch ( _e ) {
			// non-fatal — server filter still applies on reload
		}
		paint();
	};

	const onNativePagesToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativePagesEnabled = checked;
		ctx.save();
		paint();
	};

	const onNativeUsersToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativeUsersEnabled = checked;
		ctx.save();
		paint();
	};

	const onNativePluginsToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativePluginsEnabled = checked;
		ctx.save();
		paint();
	};

	const onNativeCommentsToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativeCommentsEnabled = checked;
		ctx.save();
		paint();
	};

	const onShowDesktopOnClickToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.showDesktopOnWallpaperClick = checked;
		ctx.save();
		paint();
	};

	const onWindowLinksToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.windowLinksEnabled = checked;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onWindowLinkRaiseToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.windowLinkRaiseOnFocus = checked;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onWindowLinkHighlightToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.windowLinkHighlight = checked;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onShowPostStatusRibbonsToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.showPostStatusRibbons = checked;
		ctx.save();
		paint();
	};

	const onDeveloperModeToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.developerModeEnabled = checked;
		ctx.save();
		paint();
	};

	const onFolderSharingToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.foldersSharingEnabled = checked;
		ctx.save();
		paint();
	};

	// Admin-only destructive action: drop the folder-sharing
	// tables. `purging` flips the button into a busy state and
	// guards against double-clicks while the REST round-trip is
	// in flight.
	let purging = false;
	const onPurgeShareTables = async (): Promise< void > => {
		if ( purging ) {
			return;
		}
		const ok = await osConfirm( {
			title: __( 'Delete folder sharing data?' ),
			message: __(
				'This drops every shares table on the site (current + legacy). All invites, accept/deny decisions, and share rows are permanently removed. Recipients lose their access until someone shares with them again. The empty tables are recreated on the next admin load so the feature keeps working — but every existing share is gone.',
			),
			confirmLabel: __( 'Delete data' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		const base = shellCfg?.filesUrl;
		const nonce = shellCfg?.restNonce;
		if ( ! base || ! nonce ) {
			showToast( { message: __( 'Files REST endpoint is not available.' ) } );
			return;
		}
		purging = true;
		paint();
		try {
			const url = base.replace( /\/+$/, '' ) + '/folder-sharing-tables/purge';
			const res = await trackedFetch(
				url,
				{
					method: 'POST',
					headers: { 'X-WP-Nonce': nonce },
					credentials: 'same-origin',
				},
				{ source: 'os-settings/folder-sharing-purge' },
			);
			if ( ! res.ok ) {
				const body = await res.text();
				throw new Error( `${ res.status }: ${ body.slice( 0, 200 ) }` );
			}
			const data = await res.json() as { dropped: string[] };
			showToast( {
				message: __( 'Folder sharing data deleted.' ) +
					' (' + data.dropped.length + ' tables)',
			} );
		} catch ( err ) {
			const detail = err instanceof Error ? err.message : String( err );
			showToast( {
				message: __( 'Could not delete sharing data.' ) + ' ' + detail,
			} );
		} finally {
			purging = false;
			paint();
		}
	};

	// AI moderation toggle — admin-only, persisted as a SITE option
	// (not user meta) via the dedicated REST endpoint. Local mirror of
	// the shell snapshot so paint() reflects the new value
	// optimistically while the round-trip finishes.
	const shellCfg = ( window as unknown as {
		openStationConfig?: ShellConfigSnapshot;
	} ).openStationConfig;
	const aiState: { enabled: boolean; providerConfigured: boolean; saving: boolean } = {
		enabled: shellCfg?.commentsAi?.enabled ?? false,
		providerConfigured: shellCfg?.commentsAi?.providerConfigured ?? false,
		saving: false,
	};

	const onCommentsAiToggle = async ( e: Event ): Promise< void > => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		if ( ! shellCfg?.commentsAiUrl || aiState.saving ) {
			return;
		}
		aiState.saving = true;
		aiState.enabled = checked;
		paint();
		try {
			const response = await trackedFetch(
				shellCfg.commentsAiUrl,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': shellCfg.restNonce ?? '',
					},
					body: JSON.stringify( { enabled: checked } ),
				},
				{ source: 'os-settings/comments-ai' },
			);
			if ( response.ok ) {
				const json = ( await response.json() ) as {
					enabled: boolean;
					providerConfigured: boolean;
				};
				aiState.enabled = json.enabled;
				aiState.providerConfigured = json.providerConfigured;
				if ( shellCfg.commentsAi ) {
					shellCfg.commentsAi.enabled = json.enabled;
					shellCfg.commentsAi.providerConfigured = json.providerConfigured;
				}
			} else {
				// Roll back on failure so the checkbox reflects truth.
				aiState.enabled = ! checked;
			}
		} catch {
			aiState.enabled = ! checked;
		}
		aiState.saving = false;
		paint();
	};

	const onAiAssistantToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.ai = { ...ctx.state.ai, enabled: checked };
		ctx.save();
		paint();
	};

	// Re-check provider availability from the server. Called after the user
	// returns from Settings → Connectors so the toggle un-gates without a reload.
	const refreshAiStatus = async (): Promise< void > => {
		const ai = shellCfg?.aiAssistant;
		if ( ! ai || ! shellCfg?.aiStatusUrl ) {
			return;
		}
		try {
			const res = await trackedFetch(
				shellCfg.aiStatusUrl,
				{
					credentials: 'same-origin',
					headers: { 'X-WP-Nonce': shellCfg.restNonce ?? '' },
				},
				{ source: 'os-settings/ai-status', silent: true },
			);
			if ( ! res.ok ) {
				return;
			}
			const json = ( await res.json() ) as {
				available?: boolean;
				providerConfigured?: boolean;
				assistantProviderConfigured?: boolean;
			};
			const changed =
				ai.available !== ( json.available === true ) ||
				ai.assistantProviderConfigured !==
					( json.assistantProviderConfigured === true );
			ai.available = json.available === true;
			ai.providerConfigured = json.providerConfigured === true;
			ai.assistantProviderConfigured =
				json.assistantProviderConfigured === true;
			// Keep the comments-AI mirror in sync too — it gates on the baseline
			// text-generation provider, not the assistant's function-calling gate.
			aiState.providerConfigured = ai.providerConfigured;
			paint();
			// Let the shell re-gate the Cmd+K palette + admin-bar icon, which
			// depend on the assistant's (function-calling) provider gate.
			if ( changed ) {
				document.dispatchEvent(
					new CustomEvent( 'os-ai-status-changed' ),
				);
			}
		} catch {
			// Non-fatal — the toggle stays gated until the next check/reload.
		}
	};

	// Re-probe provider status whenever OpenStation Preferences regains focus, so the
	// toggle gates/un-gates without a reload after the user connects OR
	// disconnects a provider in Settings → Connectors (or any other path).
	// Guarded by an in-flight flag and torn down when the section leaves the DOM.
	let statusInFlight = false;
	const onOsSettingsFocus = ( e: Event ): void => {
		if (
			( e as CustomEvent ).detail?.windowId !== 'desktop-mode-os-settings'
		) {
			return;
		}
		if ( statusInFlight ) {
			return;
		}
		statusInFlight = true;
		void refreshAiStatus().finally( () => {
			statusInFlight = false;
		} );
	};
	document.addEventListener( 'os-window-focused', onOsSettingsFocus );
	const statusCleanup = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			document.removeEventListener(
				'os-window-focused',
				onOsSettingsFocus,
			);
			statusCleanup.disconnect();
		}
	} );
	statusCleanup.observe( document.body, { childList: true, subtree: true } );

	const onOpenConnectors = (): void => {
		const url = shellCfg?.aiAssistant?.connectorsUrl ?? '';
		if ( ! url ) {
			return;
		}
		const desktop = (
			window as unknown as {
				wp?: {
					os?: {
						deriveWindowId?: ( u: string ) => string;
						windowManager?: {
							open?: ( c: {
								id: string;
								url: string;
								title: string;
								icon?: string;
							} ) => void;
						};
					};
				};
			}
		).wp?.os;
		if ( desktop?.windowManager?.open ) {
			const id = desktop.deriveWindowId
				? desktop.deriveWindowId( url )
				: url;
			desktop.windowManager.open( {
				id,
				url,
				title: __( 'Connectors' ),
				icon: 'dashicons-admin-settings',
			} );
		} else {
			window.open( url, '_blank', 'noopener' );
		}
	};

	let resetting = false;
	const onResetIntros = async (): Promise< void > => {
		if ( resetting ) {
			return;
		}
		const cfg = ( window as unknown as {
			openStationConfig?: ShellConfigSnapshot;
		} ).openStationConfig;
		if ( ! cfg?.seenIntrosUrl ) {
			return;
		}
		resetting = true;
		paint();
		try {
			await trackedFetch(
				cfg.seenIntrosUrl,
				{
					method: 'DELETE',
					credentials: 'same-origin',
					headers: {
						'X-WP-Nonce': cfg.restNonce ?? '',
					},
				},
				{ source: 'os-settings/reset-intros' },
			);
			// Broadcast so already-loaded bundles that cache their own
			// dismissed-dialog state can invalidate it without an F5.
			document.dispatchEvent(
				new CustomEvent( 'os-intros-reset' ),
			);
		} catch {
			// Non-fatal — surface in console; UI just stays put.
		}
		resetting = false;
		paint();
	};

	const paint = (): void =>
		render(
			html`
				<!--
					No heading. The page title above already says
					"Features", and its description already covers the
					per-account, takes-effect-immediately point that used
					to open this section.
				-->
				<os-section
					heading=""
					description=${ __(
						'Watch the dot in the OpenStation Preferences title bar to see when a change has been saved.',
					) }
				>
					${ shellCfg?.aiAssistant?.available
						? html`
								<div class="os-features__item">
									<os-checkbox-label
										label=${ __( 'AI assistant' ) }
										?checked=${ ctx.state.ai.enabled }
										?disabled=${ ! shellCfg.aiAssistant.assistantProviderConfigured }
										@os-checkbox-change=${ onAiAssistantToggle }
									></os-checkbox-label>
									<p class="os-features__hint">
										${ sprintf(
											/* translators: %s: keyboard shortcut, e.g. ⌘K or Ctrl+K */
											__(
												'Adds an AI mode to the %s command palette: find content and ask about your site.',
											),
											SHORTCUT_KEY,
										) }
									</p>
									${ ! shellCfg.aiAssistant.assistantProviderConfigured
										? html`
												<os-notice tone="warning" not-dismissible>
													${ __(
														'This feature requires an AI provider configured in',
													) }
													<a
														href=${ shellCfg
															.aiAssistant
															.connectorsUrl }
														@click=${ ( e: Event ) => {
															e.preventDefault();
															onOpenConnectors();
														} }
														>${ __(
															'Settings → Connectors',
														) }</a
													>.
												</os-notice>
											`
										: '' }
								</div>
							`
						: '' }
					${ shellCfg?.commentsAi
						? html`
							<div class="os-features__item">
								<os-checkbox-label
									label=${ __( 'Score new comments with AI' ) }
									?checked=${ aiState.enabled }
									?disabled=${ aiState.saving || ! aiState.providerConfigured }
									@os-checkbox-change=${ onCommentsAiToggle }
								></os-checkbox-label>
								<p class="os-features__hint">
									${ __(
										'Rates incoming comments so you can triage the queue faster.',
									) }
								</p>
								${ ! aiState.providerConfigured
									? html`
											<os-notice tone="warning" not-dismissible>
												${ __( 'This feature requires an AI provider configured in' ) }
												<a
													href=${ shellCfg?.aiAssistant?.connectorsUrl ?? '' }
													@click=${ ( e: Event ) => {
														e.preventDefault();
														onOpenConnectors();
													} }
													>${ __( 'Settings → Connectors' ) }</a
												>.
											</os-notice>
										`
								: '' }
							</div>
						`
						: '' }
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Window links' ) }
							?checked=${ ctx.state.windowLinksEnabled }
							@os-checkbox-change=${ onWindowLinksToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Draws connector lines between related windows. Line style and visibility live in Effects → Window links.',
							) }
						</p>
						<div class="os-features__item">
							<os-checkbox-label
								label=${ __( 'Bring related windows to front' ) }
								?checked=${ ctx.state.windowLinkRaiseOnFocus }
								?disabled=${ ! ctx.state.windowLinksEnabled }
								@os-checkbox-change=${ onWindowLinkRaiseToggle }
							></os-checkbox-label>
							<p class="os-features__hint">
								${ __(
									'Clicking a window also surfaces its parent and children.',
								) }
							</p>
						</div>
						<div class="os-features__item">
							<os-checkbox-label
								label=${ __( 'Highlight related windows' ) }
								?checked=${ ctx.state.windowLinkHighlight }
								?disabled=${ ! ctx.state.windowLinksEnabled }
								@os-checkbox-change=${ onWindowLinkHighlightToggle }
							></os-checkbox-label>
							<p class="os-features__hint">
								${ __(
									'Related windows get an accent outline while one of them is focused.',
								) }
							</p>
						</div>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __(
								'Show desktop when clicking the wallpaper',
							) }
							?checked=${ ctx.state.showDesktopOnWallpaperClick }
							@os-checkbox-change=${ onShowDesktopOnClickToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'A click on the empty desktop minimizes every window; a second click restores them.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __(
								'Show post/page status ribbon',
							) }
							?checked=${ ctx.state.showPostStatusRibbons }
							@os-checkbox-change=${ onShowPostStatusRibbonsToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Marks unpublished posts and pages with a corner ribbon on their tiles.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Enable developer mode' ) }
							?checked=${ ctx.state.developerModeEnabled }
							@os-checkbox-change=${ onDeveloperModeToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Unlocks developer surfaces meant for plugin authors.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Folder sharing' ) }
							?checked=${ ctx.state.foldersSharingEnabled }
							@os-checkbox-change=${ onFolderSharingToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Share desktop folders with other users or roles, with read or write access.',
							) }
						</p>
						${ shellCfg?.currentUserIsAdmin
							? html`
								<div class="os-features__danger-row">
									<p class="os-features__hint">
										${ __(
											'Removes every share and its access list. Cannot be undone.',
										) }
									</p>
									<os-button
										variant="danger"
										?disabled=${ purging }
										@click=${ onPurgeShareTables }
									>
										${ purging
											? __( 'Deleting…' )
											: __( 'Delete folder sharing data' ) }
									</os-button>
								</div>
							`
							: '' }
					</div>
					<div class="os-features__item">
						<label class="os-features__select-label">
							<span class="os-features__select-title">${ __(
								'WordPress Heartbeat rate',
							) }</span>
							<os-select
								value=${ String( ctx.state.heartbeatRate ) }
								@os-pick=${ onHeartbeatRateChange }
							>
								<os-option value="15">${ __( 'Fast (15s, not recommended)' ) }</os-option>
								<os-option value="30">${ __( 'Medium (30s)' ) }</os-option>
								<os-option value="45">${ __( 'Slow (45s)' ) }</os-option>
								<os-option value="60">${ __( 'Very slow (60s, default)' ) }</os-option>
							</os-select>
						</label>
						<p class="os-features__hint">
							${ __(
								'How often the Heartbeat API runs. Faster means quicker live updates and more server traffic. The 30s and 45s rates apply exactly from the next page load.',
							) }
						</p>
					</div>
					<div class="os-features__row">
						<p class="os-features__hint">
							${ __(
								'Brings back the one-time announcements you have dismissed, such as the welcome dialog.',
							) }
						</p>
						<os-button
							variant="secondary"
							?disabled=${ resetting }
							@click=${ onResetIntros }
						>
							${ resetting
								? __( 'Resetting…' )
								: __( 'Reset what’s-new dialogs' ) }
						</os-button>
					</div>
				</os-section>
				<os-section
					heading=${ __( 'Beta features' ) }
					description=${ __(
						'Experimental redesigns of core admin screens, off by default. Each toggle affects only your account and takes effect immediately.',
					) }
				>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Use the native Posts window' ) }
							?checked=${ ctx.state.nativePostsEnabled }
							@os-checkbox-change=${ onNativePostsToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Replaces the classic Posts list with a native table window: sticky header, paginated rows, bulk actions, and a row preview.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Use the native Pages window' ) }
							?checked=${ ctx.state.nativePagesEnabled }
							@os-checkbox-change=${ onNativePagesToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'The Posts table experience for Pages, with a Parent column, hierarchical sort, and edit-lock indicators.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Use the native Users window' ) }
							?checked=${ ctx.state.nativeUsersEnabled }
							@os-checkbox-change=${ onNativeUsersToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'A native Users list with bulk role changes, online indicators, and one-click password resets.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Use the native Plugins window' ) }
							?checked=${ ctx.state.nativePluginsEnabled }
							@os-checkbox-change=${ onNativePluginsToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'A native Plugins window with an Installed list, bulk actions, and a Browse gallery from the WordPress.org directory.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Use the native Comments window' ) }
							?checked=${ ctx.state.nativeCommentsEnabled }
							@os-checkbox-change=${ onNativeCommentsToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'A native two-pane Comments window: a list of conversations beside the full reply thread.',
							) }
						</p>
					</div>
				</os-section>
			`,
			wrapper,
		);

	paint();
	return wrapper;
}
