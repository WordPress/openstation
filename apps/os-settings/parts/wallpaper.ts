import { __, html, sprintf } from '@openstation/app';
import * as registry from '../../../src/wallpapers/registry';
import {
	getWallpaperSettings,
	publishWallpaperSettings,
	type WallpaperSettings,
} from '../../../src/wallpapers/settings-store';
import type {
	WallpaperConfigContext,
	WallpaperDef,
	WallpaperTeardown,
} from '../../../src/wallpapers/types';
import { render } from '../../../src/ui/core';

import '../../../src/ui/components/os-modal/os-modal';
import '../../../src/ui/components/os-button/os-button';
import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from '../../../src/settings/constants';
import { isPromise } from '../../../src/settings/utils';
import { customGradientCss } from '../../../src/settings/wallpaper-defs';
import { customImageSection } from './custom-image';
import { settings, update } from './store';
import { pickedValue, uiOf, type Ctx, type Section } from './types';

const EDITOR_SLOT = '[data-os-editor-slot]';

function wallpaperContext( id: string ) {
	return {
		id,
		pluginUrl: '',
		prefersReducedMotion:
			typeof window.matchMedia === 'function' &&
			window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches,
		visible: ! document.hidden,
		settings: getWallpaperSettings( id ),
	};
}

export function syncEditor( ctx: Ctx ): void {
	const slot = ctx.root.querySelector< HTMLElement >( EDITOR_SLOT );
	if ( ! slot ) {
		return;
	}
	const ui = uiOf( ctx );
	const id = settings().wallpaper;

	if ( ui.editor.id === id && slot.firstElementChild ) {
		return;
	}
	teardownEditor( ctx );
	ui.editor.id = id;
	const inner = document.createElement( 'div' );
	inner.className = 'os-settings__editor-slot-inner';
	slot.textContent = '';
	slot.appendChild( inner );

	const def = registry.get( id );
	if ( ! def?.renderEditor ) {
		return;
	}
	try {
		const result = def.renderEditor( inner, wallpaperContext( def.id ) );
		if ( isPromise( result ) ) {
			result.then( ( teardown: WallpaperTeardown ) => {
				ui.editor.teardown = teardown;
			} );
		} else {
			ui.editor.teardown = result;
		}
	} catch ( err ) {
		console.error( `[openstation] Wallpaper "${ def.id }" renderEditor threw:`, err );
	}
}

export function teardownEditor( ctx: Ctx ): void {
	const ui = uiOf( ctx );
	if ( ui.editor.teardown ) {
		try {
			ui.editor.teardown();
		} catch ( err ) {
			console.error( '[openstation] Wallpaper editor teardown threw:', err );
		}
	}
	ui.editor = { id: '', teardown: null };
}

export function renderGradientEditor( container: HTMLElement ): WallpaperTeardown {
	container.classList.add( 'os-settings__gradient-editor-inner' );
	const write = ( patch: Partial< ReturnType< typeof settings >[ 'customGradient' ] > ): void => {
		update( { customGradient: { ...settings().customGradient, ...patch } } );
		paint();
	};
	const paint = (): void => {
		const { from, to, angle } = settings().customGradient;
		render(
			html`
				<div class="os-settings__gradient-row">
					<os-color-field
						variant="block"
						label=${ __( 'From' ) }
						value=${ from }
						@os-color-change=${ ( e: Event ) => write( { from: pickedValue( e ) } ) }
					></os-color-field>
					<os-color-field
						variant="block"
						label=${ __( 'To' ) }
						value=${ to }
						@os-color-change=${ ( e: Event ) => write( { to: pickedValue( e ) } ) }
					></os-color-field>
				</div>
				<os-range-field
					label=${ __( 'Angle' ) }
					min="0"
					max="360"
					step="1"
					suffix="°"
					value=${ String( angle ) }
					@os-range-change=${ ( e: Event ) => write( { angle: Number( pickedValue( e ) ) } ) }
				></os-range-field>
			`,
			container,
		);
	};
	paint();

	return () => undefined;
}

export function openWallpaperConfigDialog( def: WallpaperDef ): void {
	if ( typeof def.renderConfig !== 'function' ) {
		return;
	}
	const modal = document.createElement( 'os-modal' );
	modal.setAttribute( 'size', 'sm' );
	modal.setAttribute(
		'title',
		sprintf(

			__( '%s settings' ),
			def.label,
		),
	);

	const body = document.createElement( 'div' );
	body.className = 'os-settings__wallpaper-config-form';
	modal.appendChild( body );

	const done = document.createElement( 'os-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	modal.appendChild( done );

	let configTeardown: WallpaperTeardown | null = null;
	let closed = false;
	const close = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		try {
			configTeardown?.();
		} catch ( err ) {
			console.error( `[openstation] Wallpaper "${ def.id }" config teardown threw:`, err );
		}
		configTeardown = null;
		modal.remove();
	};
	done.addEventListener( 'click', close );
	modal.addEventListener( 'os-modal-cancel', close );

	const configCtx: WallpaperConfigContext = {
		...wallpaperContext( def.id ),
		setSettings: ( partial ) => {
			const current = settings();
			const merged: WallpaperSettings = {
				...( current.wallpaperSettings[ def.id ] ?? {} ),
				...partial,
			};
			update( { wallpaperSettings: { ...current.wallpaperSettings, [ def.id ]: merged } } );
			publishWallpaperSettings( def.id, merged );
		},
	};

	document.body.appendChild( modal );
	modal.setAttribute( 'open', '' );

	try {
		const result = def.renderConfig( body, configCtx );
		if ( isPromise( result ) ) {
			result.then( ( teardown: WallpaperTeardown ) => {
				if ( closed ) {
					try {
						teardown();
					} catch {

					}
					return;
				}
				configTeardown = teardown;
			} );
		} else {
			configTeardown = result;
		}
	} catch ( err ) {
		console.error( `[openstation] Wallpaper "${ def.id }" renderConfig threw:`, err );
		close();
	}
}

export const wallpaperSection: Section = ( s, ctx ) => {
	const ui = uiOf( ctx );
	const active = registry.get( s.wallpaper );
	const hasConfig = typeof active?.renderConfig === 'function';
	const hasEditor = typeof active?.renderEditor === 'function';
	const onPick = ( e: Event ): void => {
		const def = registry.get( pickedValue( e ) );
		if ( def && def.id !== CUSTOM_IMAGE_ID ) {
			update( { wallpaper: def.id } );
		}
	};
	const tiles = registry
		.all()
		.filter( ( def ) => def.id !== CUSTOM_IMAGE_ID )

		.sort(
			( a, b ) =>
				Number( a.id === CUSTOM_GRADIENT_ID ) - Number( b.id === CUSTOM_GRADIENT_ID ),
		);
	return html`
		<os-section
			heading=${ __( 'Wallpaper' ) }
			description=${ __(
				'The backdrop behind your windows. Pick a preset, mix your own gradient, or drop in an image.',
			) }
		>
			<div class="os-settings__grid os-settings__grid--wallpapers" @os-pick=${ onPick }>
				${ tiles.map(
					( def ) => html`<os-swatch
						value=${ def.id }
						label=${ def.label }
						preview=${ def.id === CUSTOM_GRADIENT_ID ? customGradientCss( s ) : def.preview }
						variant="wallpaper"
						data-wallpaper-id=${ def.id }
						?selected=${ s.wallpaper === def.id }
					>
						<span class="os-settings__swatch-label">${ def.label }</span>
					</os-swatch>`,
				) }
				<button
					type="button"
					class="os-settings__wallpaper-add"
					aria-expanded=${ ui.imagePickerOpen ? 'true' : 'false' }
					@click=${ () => {
						ui.imagePickerOpen = ! ui.imagePickerOpen;
						ctx.repaint();
					} }
				>
					<span class="os-settings__wallpaper-add-plus" aria-hidden="true">+</span>
					<span>${ __( 'Use your own image' ) }</span>
				</button>
			</div>
			<div
				class="os-settings__wallpaper-config-slot"
				data-expanded=${ hasConfig ? 'true' : 'false' }
				style=${ hasConfig ? 'margin-top:12px' : '' }
			>
				<div class="os-settings__wallpaper-config-slot-inner">
					${ hasConfig
						? html`<div class="os-settings__wallpaper-config">
							<os-button variant="secondary" @click=${ () => openWallpaperConfigDialog( active! ) }>
								<os-icon name="admin-generic"></os-icon>
								${ __( 'Wallpaper settings' ) }
							</os-button>
						</div>`
						: '' }
				</div>
			</div>
			<div
				class="os-settings__editor-slot"
				data-os-editor-slot
				data-expanded=${ hasEditor ? 'true' : 'false' }
			></div>
			<div class="os-settings__image-picker-slot" data-expanded=${ ui.imagePickerOpen ? 'true' : 'false' }>
				<div class="os-settings__image-picker-slot-inner">${ customImageSection( s, ctx ) }</div>
			</div>
		</os-section>
	`;
};
