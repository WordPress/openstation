function escapeHtmlForMd( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function renderInlineMd( s: string ): string {
	return s

		.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			( _m, label: string, url: string ) => {
				if ( ! /^https?:\/\//i.test( url.trim() ) ) {
					return label;
				}
				return `<a href="${ url.trim() }" target="_blank" rel="noopener noreferrer">${ label }</a>`;
			},
		)

		.replace( /\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>' )

		.replace( /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>' )

		.replace( /(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>' )

		.replace( /`([^`\n]+?)`/g, '<code>$1</code>' );
}

export function renderMarkdown( md: string ): string {
	if ( ! md ) {
		return '';
	}

	const safe = escapeHtmlForMd( md );

	const out: string[] = [];
	let para: string[] = [];
	let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

	const flushPara = () => {
		if ( para.length > 0 ) {
			out.push( `<p>${ para.join( '<br>' ) }</p>` );
			para = [];
		}
	};
	const flushList = () => {
		if ( list ) {
			out.push(
				`<${ list.tag }>${ list.items.join( '' ) }</${ list.tag }>`,
			);
			list = null;
		}
	};

	for ( const rawLine of safe.split( /\n/ ) ) {
		const line = rawLine.trim();
		if ( line === '' ) {
			flushPara();
			flushList();
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec( line );
		if ( heading ) {
			flushPara();
			flushList();

			const level = Math.min( 6, heading[ 1 ].length + 2 );
			out.push(
				`<h${ level }>${ renderInlineMd( heading[ 2 ] ) }</h${ level }>`,
			);
			continue;
		}

		if ( /^(-{3,}|\*{3,}|_{3,})$/.test( line ) ) {
			flushPara();
			flushList();
			out.push( '<hr>' );
			continue;
		}

		const ulItem = /^[-*]\s+(.*)$/.exec( line );
		const olItem = /^\d+\.\s+(.*)$/.exec( line );
		if ( ulItem || olItem ) {
			flushPara();
			const tag = ulItem ? 'ul' : 'ol';
			if ( ! list || list.tag !== tag ) {
				flushList();
				list = { tag, items: [] };
			}
			list.items.push(
				`<li>${ renderInlineMd( ( ulItem ?? olItem )![ 1 ] ) }</li>`,
			);
			continue;
		}

		flushList();
		para.push( renderInlineMd( line ) );
	}
	flushPara();
	flushList();

	return out.join( '' );
}
