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
}

export function buildFeaturesSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onNativePostsToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.nativePostsEnabled = checked;
		ctx.save();
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
