/**
 * Features section — per-user opt-ins for Desktop Mode behaviors.
 *
 * Visible to every user (no admin gate at the tab level), unlike the
 * Extended Options tab which is admin-only. Toggles here mutate
 * `OsSettingsState` via `ctx.save()` — no dedicated REST endpoint;
 * the existing OS-settings sync debounces the write to user meta.
 *
 * Today: the native Posts window opt-in. As more per-user feature
 * flags land they slot in here so the Features tab grows by one row
 * at a time, not one tab at a time.
 *
 * The save indicator (`<wpd-save-status auto>`) hooks the same
 * `desktop-mode-os-settings-save-lifecycle` CustomEvent the panel
 * header listens to — both update in lock-step so a user editing
 * here gets feedback at both the section and the panel scope.
 *
 * @since 0.8.0
 */

import { __ } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import { html, render } from '../../ui/core';
import type { SettingsCtx } from '../types';

interface ShellConfigSnapshot {
	seenIntrosUrl?: string;
	restNonce?: string;
	commentsAiUrl?: string;
	commentsAi?: {
		enabled: boolean;
		providerConfigured: boolean;
	} | null;
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

	// AI moderation toggle — admin-only, persisted as a SITE option
	// (not user meta) via the dedicated REST endpoint. Local mirror of
	// the shell snapshot so paint() reflects the new value
	// optimistically while the round-trip finishes.
	const shellCfg = ( window as unknown as {
		desktopModeConfig?: ShellConfigSnapshot;
	} ).desktopModeConfig;
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

	let resetting = false;
	const onResetIntros = async (): Promise< void > => {
		if ( resetting ) {
			return;
		}
		const cfg = ( window as unknown as {
			desktopModeConfig?: ShellConfigSnapshot;
		} ).desktopModeConfig;
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
			// Mirror the reset into every in-memory native-window
			// config blob so the next window-open re-fires the intro
			// without forcing a full-page reload. Without this the
			// localized `introSeen: true` flag survives the round-trip
			// and silently suppresses the dialog. Also broadcast a
			// CustomEvent so already-loaded bundles that cache their
			// own intro-state can invalidate it.
			const store = ( window as unknown as {
				desktopModeWindowConfig?: Record< string, { introSeen?: boolean } | undefined >;
			} ).desktopModeWindowConfig;
			if ( store ) {
				Object.values( store ).forEach( ( entry ) => {
					if ( entry && typeof entry === 'object' ) {
						entry.introSeen = false;
					}
				} );
			}
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-intros-reset' ),
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
				<wpd-section
					heading=${ __( 'Features' ) }
					description=${ __(
						'Tune individual Desktop Mode behaviors. Each toggle affects only your account and takes effect immediately — no reload required. Watch the dot in the OS Settings title bar to see when a change has been saved.',
					) }
				>
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __( 'Use the native Posts window' ) }
							?checked=${ ctx.state.nativePostsEnabled }
							@wpd-checkbox-change=${ onNativePostsToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'Replaces the classic Posts list iframe with a native, table-driven window: sticky header, server-paginated rows, multi-select bulk actions, and a sub-row preview. On by default. Toggle off to return to the classic experience.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __( 'Use the native Pages window' ) }
							?checked=${ ctx.state.nativePagesEnabled }
							@wpd-checkbox-change=${ onNativePagesToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'Same table-driven experience as the Posts window, tailored for Pages: a Parent column, hierarchical sort, and the same lock indicator when another user is editing a page. On by default. Toggle off to return to the classic experience.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __( 'Use the native Users window' ) }
							?checked=${ ctx.state.nativeUsersEnabled }
							@wpd-checkbox-change=${ onNativeUsersToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'A native Users list with bulk role change, last-login tracking, live online indicators, click-to-copy email, and one-click password resets. Capability-gated — readers see a read-only view, role assignment respects WordPress role permissions. On by default.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __( 'Use the native Plugins window' ) }
							?checked=${ ctx.state.nativePluginsEnabled }
							@wpd-checkbox-change=${ onNativePluginsToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'A native two-tab Plugins window: an Installed list with bulk activate / deactivate / delete, and a Browse gallery powered by the WordPress.org repository — rich detail flyout with screenshots, ratings histogram, and recent reviews. Drag a .zip onto the window to install, or drag a card from Browse to the dock to pin it. On by default.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __( 'Use the native Comments window' ) }
							?checked=${ ctx.state.nativeCommentsEnabled }
							@wpd-checkbox-change=${ onNativeCommentsToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'A redesigned moderation queue with Pending / All / Spam / Trash / Mine tabs, bulk approve/spam/trash plus an 8-second undo, inline reply right in the row, an author insights drawer, a per-row spam confidence score (Akismet + heuristics), and full keyboard moderation (j/k navigate, a approve, s spam, d trash, r reply, e edit, u undo). On by default.',
							) }
						</p>
					</div>
					${ shellCfg?.commentsAi
						? html`
							<div class="desktop-mode-features__item">
								<wpd-checkbox-label
									label=${ __( 'Score new comments with AI' ) }
									?checked=${ aiState.enabled }
									?disabled=${ aiState.saving || ! aiState.providerConfigured }
									@wpd-checkbox-change=${ onCommentsAiToggle }
								></wpd-checkbox-label>
								<p class="desktop-mode-features__hint">
									${ aiState.providerConfigured
										? __(
											'When a new comment lands, your configured AI provider scores it for spam and hostility. The verdict appears in the per-row chip and is folded into the spam confidence score. Token usage applies — admin-only site setting.',
										)
										: __(
											'Configure an AI provider in OS Settings → AI first. Once a provider is set up, this toggle becomes available and every new comment is scored on arrival.',
										) }
								</p>
							</div>
						`
						: '' }
					<div class="desktop-mode-features__item">
						<wpd-checkbox-label
							label=${ __(
								'Show desktop when clicking the wallpaper',
							) }
							?checked=${ ctx.state.showDesktopOnWallpaperClick }
							@wpd-checkbox-change=${ onShowDesktopOnClickToggle }
						></wpd-checkbox-label>
						<p class="desktop-mode-features__hint">
							${ __(
								'macOS-style gesture: a left click on the empty desktop minimizes every window, and a second click restores them. When on, the matching "Show desktop" entry is removed from the wallpaper context menu — the click gesture replaces it. Off by default.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__item">
						<label class="desktop-mode-features__select-label">
							<span class="desktop-mode-features__select-title">${ __(
								'WordPress Heartbeat rate',
							) }</span>
							<wpd-select
								value=${ String( ctx.state.heartbeatRate ) }
								@wpd-pick=${ onHeartbeatRateChange }
							>
								<wpd-option value="15">${ __( 'Fast — 15s (not recommended)' ) }</wpd-option>
								<wpd-option value="30">${ __( 'Medium — 30s' ) }</wpd-option>
								<wpd-option value="45">${ __( 'Slow — 45s' ) }</wpd-option>
								<wpd-option value="60">${ __( 'Very slow — 60s (default)' ) }</wpd-option>
							</wpd-select>
						</label>
						<p class="desktop-mode-features__hint">
							${ __(
								'How often the WordPress Heartbeat API runs. Faster = quicker live updates (autosaves, lock checks, the heartbeat widget) at the cost of more server traffic. 15 s triples server load vs. the 60 s default — use sparingly. 30 s and 45 s require a page reload to apply exactly; 15 s and 60 s take effect immediately.',
							) }
						</p>
					</div>
					<div class="desktop-mode-features__row">
						<wpd-button
							variant="secondary"
							?disabled=${ resetting }
							@click=${ onResetIntros }
						>
							${ resetting
								? __( 'Resetting…' )
								: __( 'Reset what’s-new dialogs' ) }
						</wpd-button>
						<p class="desktop-mode-features__hint">
							${ __(
								'Re-shows the one-time introduction dialog the next time you open each redesigned native window.',
							) }
						</p>
					</div>
				</wpd-section>
			`,
			wrapper,
		);

	paint();
	return wrapper;
}
