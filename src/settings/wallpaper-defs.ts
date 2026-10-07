import { __ } from '../i18n';
import * as registry from '../wallpapers/registry';
import type { WallpaperEditor } from '../wallpapers/types';
import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from './constants';
import type { OsSettingsState } from './types';

export function customGradientCss(
	state: Pick< OsSettingsState, 'customGradient' >,
): string {
	const { from, to, angle } = state.customGradient;
	return `linear-gradient(${ angle }deg, ${ from }, ${ to })`;
}

export function registerCustomGradient(
	read: () => OsSettingsState,
	renderEditor?: WallpaperEditor,
): void {
	registry.register( {
		id: CUSTOM_GRADIENT_ID,
		label: __( 'Custom gradient' ),
		type: 'css',
		preview: customGradientCss( read() ),
		description: __(
			'Mix your own two-colour gradient and set the angle — your desk, your palette.',
		),
		resolveValue: () => customGradientCss( read() ),
		...( renderEditor ? { renderEditor } : {} ),
	} );
}

export function registerCustomImageIfPresent( state: OsSettingsState ): void {
	if ( ! state.customImage ) {
		if ( registry.get( CUSTOM_IMAGE_ID ) ) {
			registry.unregister( CUSTOM_IMAGE_ID );
		}
		return;
	}
	const safeUrl = encodeURI( state.customImage.url );
	const value = `url("${ safeUrl }") center/cover no-repeat, #1d2327`;
	const existing = registry.get( CUSTOM_IMAGE_ID );
	if ( existing && existing.type === 'css' && existing.value === value ) {
		return;
	}
	registry.register( {
		id: CUSTOM_IMAGE_ID,
		label: __( 'Custom image' ),
		type: 'css',
		value,
		preview: value,
		description: __(
			'Any image from your media library or an upload, sized to cover the whole desk.',
		),
	} );
}
