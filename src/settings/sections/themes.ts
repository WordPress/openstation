/**
 * OS Settings → Themes.
 *
 * The tab has two jobs with very different audiences:
 *
 * - choosing a look is personal, instant, and available to everyone;
 * - installing or removing packages is site-wide administration.
 *
 * Keep those jobs visually separate. The current look gets a large
 * stage, the personal library is a preview-first radio group, and the
 * administrative tools live in their own disclosure at the bottom.
 *
 * Code-registered themes (`source: 'code'`) never get a delete action:
 * there is no file to remove and the REST route rightly 404s on them.
 * A plugin that ships a theme takes it away by unregistering it.
 */

import { __, _n, sprintf } from '../../i18n';
import { html, render } from '../../ui/core';
import { osConfirm } from '../../ui/components/os-confirm-dialog/os-confirm-dialog';
import {
	listDesktopThemes,
	removeDesktopTheme,
	subscribeDesktopThemes,
	upsertDesktopTheme,
} from '../../desktop-themes/registry';
import type { DesktopThemeEntry } from '../../desktop-themes/types';
import {
	deleteDesktopTheme,
	uploadDesktopTheme,
} from '../desktop-themes-api';
import {
	applyThemeRecommendations,
	hasApplicableThemeRecommendations,
} from '../theme-recommendations';
import type { SettingsCtx } from '../types';

/** Sentinel id for the shell's built-in look. */
const SYSTEM_DEFAULT = '';

/** Product name shown beside installed themes. */
const SYSTEM_DEFAULT_NAME = 'OpenStation';

/** The built-in look has no manifest, so its library copy lives here. */
const SYSTEM_DEFAULT_DESCRIPTION = __(
	'The original OpenStation look: graphite surfaces, Pulse accents, and the built-in icon set.',
);

/** Honest copy when a package omits its optional description. */
const THEME_FALLBACK_DESCRIPTION = __(
	'A complete desktop look for OpenStation.',
);

function descriptionFor( theme: DesktopThemeEntry | null ): string {
	if ( theme === null ) {
		return SYSTEM_DEFAULT_DESCRIPTION;
	}
	return theme.description || THEME_FALLBACK_DESCRIPTION;
}

/** Stable fallback for a theme that ships no preview image. */
function initialsFor( name: string ): string {
	const words = name.trim().split( /\s+/ ).filter( Boolean );
	if ( words.length === 0 ) {
		return '?';
	}
	if ( words.length >= 2 ) {
		return ( words[ 0 ][ 0 ] + words[ 1 ][ 0 ] ).toUpperCase();
	}
	return words[ 0 ].slice( 0, 2 ).toUpperCase();
}

/**
 * The shell falls back to the system look when a saved theme is no
 * longer registered. Mirror that resolution in the picker so it never
 * shows a desktop with no selected radio.
 */
function resolveActiveSlug(
	themes: DesktopThemeEntry[],
	savedSlug: string,
): string {
	if (
		savedSlug !== SYSTEM_DEFAULT &&
		themes.some( ( theme ) => theme.slug === savedSlug )
	) {
		return savedSlug;
	}
	return SYSTEM_DEFAULT;
}

export function buildThemesSection( ctx: SettingsCtx ): HTMLElement {
	const host = document.createElement( 'div' );
	host.className = 'os-settings__themes';

	let errorText = '';
	let uploadBusy = false;
	let deletingSlug = '';
	const canManage = !! ctx.config.canManageDesktopThemes;

	const pick = ( id: string ): void => {
		if ( ctx.state.desktopTheme === id ) {
			return;
		}
		ctx.state.desktopTheme = id;
		// Recommendations seed only on first activation. Rewearing a
		// theme never undoes preferences the user changed afterwards.
		applyThemeRecommendations( ctx.state, id );
		ctx.save();
		ctx.apply();
		paint();
	};

	/**
	 * Arrow keys move focus through the library WITHOUT selecting.
	 *
	 * A native radio group selects as focus moves, and here selecting
	 * is not editing a preference — it is an action. `pick()` swaps
	 * the desktop stylesheet, repaints every themed icon, and the
	 * first time a user wears a theme it seeds that theme's
	 * recommended dock size, layout and effects over whatever they had
	 * arranged, then records the slug so the offer is never made
	 * again. Arrowing past six themes on the way to the seventh would
	 * fire all of that six times and burn six one-shot seeds, silently
	 * and unrecoverably.
	 *
	 * So the group is manual-activation: arrows move, Space or Enter
	 * commits, a click commits. That is the bargain every other picker
	 * in this panel already makes — `<os-swatch>` tiles are buttons
	 * inside a `role="radiogroup"` and have never selected on focus.
	 */
	const ARROW_STEPS: Record< string, number > = {
		ArrowRight: 1,
		ArrowDown: 1,
		ArrowLeft: -1,
		ArrowUp: -1,
	};

	const onLibraryKeydown = ( e: KeyboardEvent ): void => {
		const radios = Array.from(
			( e.currentTarget as HTMLElement ).querySelectorAll< HTMLInputElement >(
				'.os-settings__theme-choice-input',
			),
		);
		const from = radios.indexOf( e.target as HTMLInputElement );
		if ( from === -1 ) {
			return;
		}
		// Enter is inert on a radio outside a form, so it has to be
		// wired by hand to be the second half of "Space or Enter".
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			pick( radios[ from ].value );
			return;
		}
		const step = ARROW_STEPS[ e.key ];
		if ( step === undefined ) {
			return;
		}
		// Without this the browser's own radio handling selects as it
		// moves, which is the whole thing we are here to prevent.
		e.preventDefault();
		radios[ ( from + step + radios.length ) % radios.length ].focus();
	};

	const applyRecommended = ( themeSlug: string ): void => {
		const applied = applyThemeRecommendations( ctx.state, themeSlug, {
			force: true,
		} );
		if ( Object.keys( applied ).length === 0 ) {
			return;
		}
		ctx.save();
		ctx.apply();
		paint();
	};

	const doUpload = async ( file: File ): Promise< void > => {
		if ( uploadBusy ) {
			return;
		}
		uploadBusy = true;
		errorText = '';
		paint();
		try {
			const entry = await uploadDesktopTheme( ctx.config, file );
			// Make a successful upload pickable immediately rather than
			// waiting for the next server-payload refresh.
			upsertDesktopTheme( entry );
		} catch ( err ) {
			errorText =
				err instanceof Error
					? err.message
					: __( 'That theme could not be installed.' );
		} finally {
			uploadBusy = false;
			paint();
		}
	};

	const doDelete = async ( theme: DesktopThemeEntry ): Promise< void > => {
		if ( deletingSlug !== '' ) {
			return;
		}
		const ok = await osConfirm( {
			title: __( 'Delete this theme?' ),
			message: sprintf(
				/* translators: %s: theme name. */
				__( '“%s” will be removed from this site for everyone. This cannot be undone.' ),
				theme.name,
			),
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}

		deletingSlug = theme.slug;
		errorText = '';
		paint();
		try {
			await deleteDesktopTheme( ctx.config, theme.slug );
			removeDesktopTheme( theme.slug );
			// Reset this user immediately when the deleted package was
			// active. Other users resolve the missing package server-side.
			if ( ctx.state.desktopTheme === theme.slug ) {
				ctx.state.desktopTheme = SYSTEM_DEFAULT;
				ctx.save();
				ctx.apply();
			}
		} catch ( err ) {
			errorText =
				err instanceof Error
					? err.message
					: __( 'That theme could not be deleted.' );
		} finally {
			deletingSlug = '';
			paint();
		}
	};

	const onFileInput = ( e: Event ): void => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[ 0 ];
		if ( file ) {
			void doUpload( file );
		}
		// Re-picking the same archive should fire change again.
		input.value = '';
	};

	const onDrop = ( e: DragEvent ): void => {
		e.preventDefault();
		( e.currentTarget as HTMLElement ).classList.remove(
			'os-settings__theme-upload--dragover',
		);
		const file = e.dataTransfer?.files?.[ 0 ];
		if ( file ) {
			void doUpload( file );
		}
	};

	/** Stylized but truthful miniature for the built-in shell. */
	const systemArtwork = () => html`
		<span class="os-settings__theme-system-scene" aria-hidden="true">
			<span class="os-settings__theme-system-window">
				<span class="os-settings__theme-system-titlebar">
					<span></span><span></span><span></span>
				</span>
				<span class="os-settings__theme-system-content">
					<span></span><span></span><span></span>
				</span>
			</span>
			<span class="os-settings__theme-system-dock">
				<span></span><span></span><span></span><span></span><span></span>
			</span>
		</span>
	`;

	const artworkContent = ( theme: DesktopThemeEntry | null ) => {
		if ( theme === null ) {
			return systemArtwork();
		}
		if ( theme.previewUrl !== '' ) {
			return html`<img
				src=${ theme.previewUrl }
				alt=""
				aria-hidden="true"
				draggable="false"
			/>`;
		}
		return html`<span
			class="os-settings__theme-initials"
			aria-hidden="true"
			>${ initialsFor( theme.name ) }</span
		>`;
	};

	const artwork = (
		theme: DesktopThemeEntry | null,
		variant: 'stage' | 'card' | 'manage',
	) => html`
		<span class="os-settings__theme-artwork os-settings__theme-artwork--${ variant }">
			${ artworkContent( theme ) }
		</span>
	`;

	const themeChoice = (
		theme: DesktopThemeEntry | null,
		activeSlug: string,
	) => {
		const slug = theme?.slug ?? SYSTEM_DEFAULT;
		const name = theme?.name ?? SYSTEM_DEFAULT_NAME;
		const description = descriptionFor( theme );
		const selected = activeSlug === slug;
		let byline = __( 'Desktop theme' );
		if ( theme === null ) {
			byline = __( 'Built into OpenStation' );
		} else if ( theme.author !== '' ) {
			byline = sprintf(
				/* translators: %s: theme author. */
				__( 'By %s' ),
				theme.author,
			);
		}

		return html`<label class="os-settings__theme-choice">
			<input
				type="radio"
				name="openstation-desktop-theme"
				.value=${ slug }
				class="os-settings__theme-choice-input"
				.checked=${ selected }
				@change=${ () => pick( slug ) }
			/>
			<span class="os-settings__theme-choice-card">
				<span class="os-settings__theme-choice-preview">
					${ artwork( theme, 'card' ) }
					${ selected
						? html`<span class="os-settings__theme-current-mark"
								>${ __( 'Current' ) }</span
							>`
						: '' }
				</span>
				<span class="os-settings__theme-choice-copy">
					<strong class="os-settings__theme-choice-name"
						>${ name }</strong
					>
					<span class="os-settings__theme-choice-description"
						>${ description }</span
					>
					<span class="os-settings__theme-choice-byline"
						>${ byline }</span
					>
				</span>
			</span>
		</label>`;
	};

	const activeStage = (
		themes: DesktopThemeEntry[],
		activeSlug: string,
	) => {
		const theme =
			activeSlug === SYSTEM_DEFAULT
				? null
				: themes.find( ( item ) => item.slug === activeSlug ) ?? null;
		const name = theme?.name ?? SYSTEM_DEFAULT_NAME;
		const description = descriptionFor( theme );
		const recommendationAvailable =
			hasApplicableThemeRecommendations( activeSlug );

		return html`<section
			class="os-settings__theme-stage"
			aria-labelledby="os-settings-current-theme"
		>
			<div class="os-settings__theme-stage-preview">
				${ artwork( theme, 'stage' ) }
			</div>
			<div class="os-settings__theme-stage-copy">
				<span class="os-settings__theme-eyebrow"
					>${ __( 'Currently wearing' ) }</span
				>
				<h4
					class="os-settings__theme-stage-name"
					id="os-settings-current-theme"
				>
					${ name }
				</h4>
				<p class="os-settings__theme-stage-description">
					${ description }
				</p>
				<div class="os-settings__theme-facts">
					${ theme?.author
						? html`<span>${ sprintf(
								/* translators: %s: theme author. */
								__( 'By %s' ),
								theme.author,
							) }</span>`
						: html`<span>${ __( 'OpenStation original' ) }</span>` }
					${ theme?.version
						? html`<span>${ sprintf(
								/* translators: %s: theme version string. */
								__( 'Version %s' ),
								theme.version,
							) }</span>`
						: '' }
				</div>
				${ recommendationAvailable
					? html`<div class="os-settings__theme-stage-actions">
							<os-button
								variant="secondary"
								@click=${ () => applyRecommended( activeSlug ) }
								>${ __( 'Restore recommended layout & effects' ) }</os-button
							>
						</div>`
					: '' }
			</div>
		</section>`;
	};

	const uploadControl = () => html`<div
		class=${ uploadBusy
			? 'os-settings__theme-upload os-settings__theme-upload--busy'
			: 'os-settings__theme-upload' }
		@dragover=${ ( e: DragEvent ) => {
			e.preventDefault();
			( e.currentTarget as HTMLElement ).classList.add(
				'os-settings__theme-upload--dragover',
			);
		} }
		@dragleave=${ ( e: DragEvent ) => {
			( e.currentTarget as HTMLElement ).classList.remove(
				'os-settings__theme-upload--dragover',
			);
		} }
		@drop=${ onDrop }
	>
		<label
			class="os-settings__theme-upload-label"
			aria-disabled=${ uploadBusy ? 'true' : 'false' }
		>
			<input
				type="file"
				accept=".zip,application/zip"
				class="os-settings__theme-file-input"
				?disabled=${ uploadBusy }
				@change=${ onFileInput }
			/>
			<span class="os-settings__theme-upload-icon" aria-hidden="true">+</span>
			<span class="os-settings__theme-upload-copy">
				<strong
					>${ uploadBusy
						? __( 'Installing theme…' )
						: __( 'Install a theme package' ) }</strong
				>
				<span
					>${ __( 'Drop a .zip here or choose one from your computer.' ) }</span
				>
			</span>
			<span class="os-settings__theme-upload-action"
				>${ __( 'Choose .zip' ) }</span
			>
		</label>
	</div>`;

	const managementPanel = ( themes: DesktopThemeEntry[] ) => {
		const removable = themes.filter( ( theme ) => theme.source === 'upload' );
		return html`<details class="os-settings__theme-management">
			<summary class="os-settings__theme-management-summary">
				<span>
					<strong>${ __( 'Manage theme packages' ) }</strong>
					<span
						>${ __( 'Install or remove themes for everyone on this site.' ) }</span
					>
				</span>
			</summary>
			<div class="os-settings__theme-management-body">
				${ uploadControl() }
				<div class="os-settings__theme-packages">
					<div class="os-settings__theme-packages-heading">
						<strong>${ __( 'Removable packages' ) }</strong>
						<span>${ sprintf(
							/* translators: %d: number of removable theme packages. */
							_n( '%d theme', '%d themes', removable.length ),
							removable.length,
						) }</span>
					</div>
					${ removable.length === 0
						? html`<p class="os-settings__theme-packages-empty">
								${ __( 'Themes installed from .zip files will appear here.' ) }
							</p>`
						: html`<ul class="os-settings__theme-package-list">
								${ removable.map(
									( theme ) => html`<li>
										${ artwork( theme, 'manage' ) }
										<span class="os-settings__theme-package-copy">
											<strong>${ theme.name }</strong>
											<span
												>${ theme.version
													? sprintf(
															/* translators: %s: theme version string. */
															__( 'Version %s' ),
															theme.version,
														)
													: __( 'Installed package' ) }</span
											>
										</span>
										<os-button
											variant="danger"
											?busy=${ deletingSlug === theme.slug }
											?disabled=${ deletingSlug !== '' &&
											deletingSlug !== theme.slug }
											@click=${ () => void doDelete( theme ) }
											>${ deletingSlug === theme.slug
												? __( 'Removing…' )
												: __( 'Remove' ) }</os-button
										>
									</li>`,
								) }
							</ul>` }
				</div>
			</div>
		</details>`;
	};

	function paint(): void {
		const themes = listDesktopThemes();
		const activeSlug = resolveActiveSlug( themes, ctx.state.desktopTheme );
		const lookCount = themes.length + 1;

		render(
			html`
				<header class="os-settings__themes-header">
					<span class="os-settings__theme-eyebrow"
						>${ __( 'Desktop themes' ) }</span
					>
					<h3 class="os-settings__themes-title">
						${ __( 'Change the whole station.' ) }
					</h3>
					<p class="os-settings__themes-intro">
						${ __(
							'Themes reshape the desktop, window chrome, dock, type, and icons. Your choice is personal and applies instantly.',
						) }
					</p>
				</header>
				${ errorText !== ''
					? html`<os-notice tone="error">${ errorText }</os-notice>`
					: '' }
				${ activeStage( themes, activeSlug ) }
				<fieldset class="os-settings__theme-library">
					<legend class="os-settings__theme-library-heading">
						<span>
							<span class="os-settings__theme-eyebrow"
								>${ __( 'Your library' ) }</span
							>
							<strong>${ __( 'Pick your next look' ) }</strong>
						</span>
						<span class="os-settings__theme-count">${ sprintf(
							/* translators: %d: number of available desktop looks. */
							_n( '%d look', '%d looks', lookCount ),
							lookCount,
						) }</span>
					</legend>
					<div
						class="os-settings__theme-grid"
						@keydown=${ onLibraryKeydown }
					>
						${ themeChoice( null, activeSlug ) }
						${ themes.map( ( theme ) =>
							themeChoice( theme, activeSlug ),
						) }
					</div>
				</fieldset>
				${ canManage ? managementPanel( themes ) : '' }
			`,
			host,
		);
	}

	paint();

	// Repaint on plugin activation/deactivation or a server-payload
	// refresh. Detached Settings windows unsubscribe on the next change.
	const unsubscribe = subscribeDesktopThemes( () => {
		if ( ! host.isConnected ) {
			unsubscribe();
			return;
		}
		paint();
	} );

	return host;
}
