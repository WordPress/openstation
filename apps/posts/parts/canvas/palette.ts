export interface CanvasPalette {
	surface: number;
	raised: number;
	fg: number;
	muted: number;
	faint: number;
	border: number;
	accent: number;
}

export function readCanvasPalette( host: HTMLElement ): CanvasPalette {
	const surface = readCanvasColor( host, '--os-ui-surface', '#ffffff', 0xffffff );
	return {
		surface,
		raised: readCanvasColor( host, '--os-ui-surface-elevated', '#ffffff', surface ),
		fg: readCanvasColor( host, '--os-ui-fg', '#1d2327', surface ),
		muted: readCanvasColor( host, '--os-ui-fg-muted', '#50575e', surface ),
		faint: readCanvasColor( host, '--os-ui-fg-faint', '#b0b3b8', surface ),
		border: readCanvasColor( host, '--os-ui-border', '#dcdcde', surface ),
		accent: readCanvasColor( host, '--os-ui-accent', '#2271b1', surface ),
	};
}

export function readCanvasColor( host: HTMLElement, token: string, fallback: string, background = 0xffffff ): number {
	const probe = document.createElement( 'span' ); probe.hidden = true;
	probe.style.color = `var(${ token }, ${ fallback })`; host.append( probe );
	const value = getComputedStyle( probe ).color; probe.remove();
	const channels = value.match( /[\d.]+/g )?.map( Number );
	if ( ! channels || channels.length < 3 ) {
		return parseInt( fallback.slice( 1 ), 16 );
	}
	const alpha = channels[ 3 ] ?? 1;
	const normalized = value.startsWith( 'color(srgb' );
	return [ 16, 8, 0 ].reduce( ( sum, shift, i ) => {
		const foreground = channels[ i ] * ( normalized ? 255 : 1 );
		const back = Math.floor( background / 2 ** shift ) % 256;
		return sum + Math.round( foreground * alpha + back * ( 1 - alpha ) ) * 2 ** shift;
	}, 0 );
}

export function watchCanvasPalette( host: HTMLElement, changed: () => void, additional?: () => unknown ): () => void {
	let previous = JSON.stringify( [ readCanvasPalette( host ), additional?.() ] );
	const update = (): void => {
		const next = JSON.stringify( [ readCanvasPalette( host ), additional?.() ] );
		if ( next !== previous ) {
			previous = next; changed();
		}
	};
	const observer = new MutationObserver( update );
	for ( let node: HTMLElement | null = host; node; node = node.parentElement ) {
		observer.observe( node, { attributes: true, attributeFilter: [ 'style', 'class' ] } );
	}
	document.addEventListener( 'os-desktop-theme-changed', update );
	return () => {
		observer.disconnect(); document.removeEventListener( 'os-desktop-theme-changed', update );
	};
}

export function badgeInk( background: number, palette: CanvasPalette ): number {
	const luminance = ( color: number ): number => [ 16, 8, 0 ].reduce( ( sum, shift, i ) => {
		const c = ( Math.floor( color / 2 ** shift ) % 256 ) / 255;
		return sum + ( c <= .04045 ? c / 12.92 : ( ( c + .055 ) / 1.055 ) ** 2.4 ) * [ .2126, .7152, .0722 ][ i ];
	}, 0 );
	const bg = luminance( background );
	const contrast = ( ink: number ): number => {
		const l = luminance( ink );
		return ( Math.max( l, bg ) + .05 ) / ( Math.min( l, bg ) + .05 );
	};
	return contrast( palette.fg ) >= contrast( palette.surface ) ? palette.fg : palette.surface;
}
