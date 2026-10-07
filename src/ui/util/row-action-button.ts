export interface RowActionButtonOptions {

	label: string;

	glyph: Node;
	onClick: () => void;

	variant?: string;

	labelled?: boolean;
}

export function makeRowActionButton( opts: RowActionButtonOptions ): HTMLElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.setAttribute( 'data-noclick', '' );
	btn.setAttribute( 'aria-label', opts.label );
	btn.title = opts.label;

	const isDanger = opts.variant === 'danger';

	const restColor = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-fg-muted, #50575e )';
	const restBorder = isDanger
		? 'var( --os-ui-danger, #d63638 )'
		: 'var( --os-ui-border, #c3c4c7 )';
	const restBg = 'var( --os-ui-surface, #fff )';

	const applyRest = (): void => {
		btn.style.background = restBg;
		btn.style.color = restColor;
		btn.style.borderColor = restBorder;
	};
	const applyHover = (): void => {
		if ( isDanger ) {
			btn.style.background = 'var( --os-ui-danger, #d63638 )';
			btn.style.color = 'var( --os-ui-fg-on-accent, #fff )';
			btn.style.borderColor = 'var( --os-ui-danger, #d63638 )';
		} else {
			btn.style.background = 'var( --os-ui-hover, #f0f0f1 )';
			btn.style.color = 'var( --os-ui-fg, #1d2327 )';
			btn.style.borderColor = 'var( --os-ui-border-strong, #8c8f94 )';
		}
	};

	const labelled = opts.labelled === true;
	btn.style.cssText = [
		'display: inline-flex',
		'align-items: center',
		'justify-content: center',
		labelled ? 'gap: 6px' : '',
		labelled ? 'flex: 0 0 auto' : 'flex: 0 0 30px',
		labelled ? 'width: auto' : 'width: 30px',
		labelled ? 'height: 36px' : 'height: 30px',
		labelled ? 'padding: 0 12px' : 'padding: 0',
		labelled ? 'font-size: 13px' : '',
		labelled ? 'font-weight: 600' : '',
		'margin: 0',
		'border: 1px solid ' + restBorder,
		'border-radius: 6px',
		'background: ' + restBg,
		'color: ' + restColor,
		'cursor: pointer',
		'box-sizing: border-box',
		'line-height: 1',
		'font: inherit',
		'transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease',
	].join( ';' );

	btn.addEventListener( 'mouseenter', applyHover );
	btn.addEventListener( 'mouseleave', applyRest );
	btn.addEventListener( 'focus', applyHover );
	btn.addEventListener( 'blur', applyRest );

	btn.appendChild( opts.glyph );

	if ( labelled ) {
		const text = document.createElement( 'span' );
		text.textContent = opts.label;
		text.style.cssText = 'white-space: nowrap; line-height: 1;';
		btn.appendChild( text );
	}

	btn.addEventListener( 'click', ( e: Event ) => {
		e.stopPropagation();
		opts.onClick();
	} );

	return btn;
}
