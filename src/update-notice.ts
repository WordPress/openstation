import { showToast } from './toast';
import type { ReleaseCardOptions } from './release-card';
import type { ReleaseArt } from './release-art';
import { loadVendorScript } from './wallpapers/vendor-loader';
import {
	isNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/os-notice/storage';
import { __, sprintf } from './i18n';

interface ReleaseCardApi {
	showReleaseCard: ( opts: ReleaseCardOptions ) => unknown;
	resolveReleaseArt: (
		branch: string,
		announcementPending?: boolean,
	) => Promise< ReleaseArt | null >;
	preloadImage: ( url: string ) => Promise< boolean >;
}

async function loadReleaseCardApi(): Promise< ReleaseCardApi | null > {
	const w = window as unknown as {
		openStationReleaseCard?: ReleaseCardApi;
		openStationConfig?: { releaseCardBundleUrl?: string };
	};
	if ( w.openStationReleaseCard ) {
		return w.openStationReleaseCard;
	}
	const url = w.openStationConfig?.releaseCardBundleUrl ?? '';
	if ( ! url ) {
		return null;
	}
	try {
		await loadVendorScript( url );
	} catch {
		return null;
	}
	return w.openStationReleaseCard ?? null;
}

export interface CoreUpdateInfo {

	version: string;

	available?: string;

	branch?: string;
	url: string;

	crossing?: boolean;
}

export interface UpdateNoticeDeps {

	update: CoreUpdateInfo | null | undefined;

	openUrl: ( args: { url: string; title: string } ) => void;

	resolveArt?: (
		branch: string,
		announcementPending?: boolean,
	) => Promise< ReleaseArt | null >;

	loadImage?: ( url: string ) => Promise< boolean >;

	showCard?: ( opts: ReleaseCardOptions ) => void;
}

export function updateMessage( version: string, name: string ): string {
	if ( name ) {
		const withName = __( 'WordPress %1$s "%2$s" is available.' );
		return sprintf( withName, version, name );
	}

	const versionOnly = __( 'WordPress %s is available.' );
	return sprintf( versionOnly, version );
}

export async function maybeShowUpdate( deps: UpdateNoticeDeps ): Promise< boolean > {
	const { update, openUrl } = deps;
	if (
		! update ||
		typeof update.version !== 'string' ||
		! update.version ||
		typeof update.url !== 'string' ||
		! update.url
	) {
		return false;
	}

	const version = update.version;
	const branch =
		typeof update.branch === 'string' && update.branch
			? update.branch
			: version;
	const crossing = update.crossing === true;

	const exact =
		typeof update.available === 'string' && update.available
			? update.available
			: version;
	const dismissKey = `desktop-mode/core-update:${ exact }`;
	if ( isNoticeDismissed( dismissKey ) ) {
		return false;
	}

	const toastDismissKey = `${ dismissKey }:no-art`;

	const openUpdateScreen = (): void =>
		openUrl( { url: update.url, title: __( 'WordPress Updates' ) } );

	const injected = deps.resolveArt && deps.loadImage && deps.showCard;
	const api = injected ? null : await loadReleaseCardApi();

	const resolveArt = deps.resolveArt ?? api?.resolveReleaseArt;
	const load = deps.loadImage ?? api?.preloadImage;
	const showCard = deps.showCard ?? api?.showReleaseCard;

	const art = resolveArt ? await resolveArt( branch, crossing ) : null;
	if ( art && art.artUrl && load && showCard && ( await load( art.artUrl ) ) ) {
		showCard( {
			message: updateMessage( version, crossing ? art.name : '' ),
			artUrl: art.artUrl,
			dismissKey,
			onUpdate: openUpdateScreen,
		} );
		return true;
	}

	if ( isNoticeDismissed( toastDismissKey ) ) {
		return false;
	}
	showToast( {
		message: updateMessage( version, '' ),
		persistent: true,
		dismissible: true,
		onDismiss: () => markNoticeDismissed( toastDismissKey ),
		action: {
			label: __( 'Update now' ),
			onClick: openUpdateScreen,
		},
	} );
	return true;
}
