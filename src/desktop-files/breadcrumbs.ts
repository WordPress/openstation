import { __ } from '../i18n';

export interface BreadcrumbSegment {

	label: string;

	onClick?: () => void;
}

export interface BreadcrumbsOptions {

	onBack?: () => void;

	backDisabled?: boolean;
}

const ROOT_CLASS = 'os-breadcrumbs';

export function renderBreadcrumbs(
	host: HTMLElement,
	segments: BreadcrumbSegment[],
	opts: BreadcrumbsOptions = {},
): void {
	host.replaceChildren();
	host.classList.add( ROOT_CLASS );

	if ( opts.onBack ) {
		const back = document.createElement( 'button' );
		back.type = 'button';
		back.className = `${ ROOT_CLASS }__back`;
		back.setAttribute( 'aria-label', __( 'Back', 'desktop-mode' ) );
		back.title = __( 'Back', 'desktop-mode' );
		const arrow = document.createElement( 'span' );
		arrow.className = 'dashicons dashicons-arrow-left-alt2';
		arrow.setAttribute( 'aria-hidden', 'true' );
		back.appendChild( arrow );
		if ( opts.backDisabled ) {
			back.disabled = true;
		}
		const onBack = opts.onBack;
		back.addEventListener( 'click', () => {
			if ( back.disabled ) {
				return;
			}
			onBack();
		} );
		host.appendChild( back );
	}

	const nav = document.createElement( 'nav' );
	nav.className = `${ ROOT_CLASS }__crumbs`;
	nav.setAttribute( 'aria-label', __( 'Breadcrumb', 'desktop-mode' ) );

	segments.forEach( ( seg, idx ) => {
		if ( idx > 0 ) {
			const sep = document.createElement( 'span' );
			sep.className = `${ ROOT_CLASS }__sep`;
			sep.setAttribute( 'aria-hidden', 'true' );
			sep.textContent = '›';
			nav.appendChild( sep );
		}

		if ( ! seg.onClick ) {
			const here = document.createElement( 'span' );
			here.className = `${ ROOT_CLASS }__crumb ${ ROOT_CLASS }__crumb--current`;
			here.setAttribute( 'aria-current', 'page' );
			here.textContent = seg.label;
			nav.appendChild( here );
			return;
		}
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = `${ ROOT_CLASS }__crumb`;
		btn.textContent = seg.label;
		const onClick = seg.onClick;
		btn.addEventListener( 'click', () => {
			onClick();
		} );
		nav.appendChild( btn );
	} );

	host.appendChild( nav );
}
