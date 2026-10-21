<?php
/**
 * OpenStation — Pinned notes: Markdown on the server.
 *
 * A note's text is Markdown, rendered in the shell by `src/markdown.ts`.
 * Two server paths need to understand it too:
 *
 *   - "Convert to post" turns it into block markup — headings, lists,
 *     checklists, quotes, code — rather than pasting the source into
 *     paragraphs (`openstation_notes_text_to_blocks()`).
 *   - The note's derived post title drops the markers, so a note that
 *     opens with `# Groceries` is titled "Groceries"
 *     (`openstation_notes_markdown_plain_line()`).
 *
 * The block grammar is the same subset the shell renders, line for
 * line, so what the draft says is what the pinned note showed. The
 * markup is Core's own serialization for each block, so the editor
 * opens the draft without asking to recover a block.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Fence that opens or closes a code block. */
const OPENSTATION_NOTES_MD_FENCE = '/^(`{3,}|~{3,})/';

/**
 * Inline Markdown to safe HTML: code, links, bare URLs, bold, italic,
 * strikethrough. Escapes first; links are http(s) only.
 *
 * @param string $text One line of note text.
 * @return string HTML.
 */
function openstation_notes_markdown_inline( $text ) {
	$stash = array();
	$keep  = static function ( $html ) use ( &$stash ) {
		$stash[] = $html;
		return "\u{E000}" . ( count( $stash ) - 1 ) . "\u{E000}";
	};
	$link  = static function ( $label, $url ) {
		$url = html_entity_decode( trim( $url ), ENT_QUOTES, 'UTF-8' );
		if ( ! preg_match( '#^https?://#i', $url ) ) {
			return $label;
		}
		return '<a href="' . esc_url( $url ) . '">' . $label . '</a>';
	};

	$html = esc_html( (string) $text );
	$html = preg_replace_callback(
		'/`([^`\n]+?)`/',
		static function ( $m ) use ( $keep ) {
			return $keep( '<code>' . $m[1] . '</code>' );
		},
		$html
	);
	$html = preg_replace_callback(
		'/\[([^\]]+)\]\(([^)\s]+)\)/',
		static function ( $m ) use ( $keep, $link ) {
			return $keep( $link( openstation_notes_markdown_emphasis( $m[1] ), $m[2] ) );
		},
		$html
	);
	$html = preg_replace_callback(
		'/\bhttps?:\/\/(?:&amp;|[^\s<>&\x{E000}])+/iu',
		static function ( $m ) use ( $keep, $link ) {
			$url      = $m[0];
			$trailing = preg_match( '/[.,;:!?)\]\'*_~]+$/', $url, $t ) ? $t[0] : '';
			$url      = substr( $url, 0, strlen( $url ) - strlen( $trailing ) );
			return $keep( $link( $url, $url ) ) . $trailing;
		},
		$html
	);

	// A link's label can hold a code span, so a restored span can carry
	// another placeholder; each index is earlier than its container's.
	$restore = static function ( $html ) use ( &$stash, &$restore ) {
		return preg_replace_callback(
			'/\x{E000}(\d+)\x{E000}/u',
			static function ( $m ) use ( &$stash, $restore ) {
				return isset( $stash[ (int) $m[1] ] ) ? $restore( $stash[ (int) $m[1] ] ) : '';
			},
			$html
		);
	};
	return $restore( openstation_notes_markdown_emphasis( $html ) );
}

/**
 * Emphasis tokens on escaped text that carries no code or links.
 *
 * Strikethrough is `<s>`, the element Core's strikethrough format writes.
 *
 * @param string $html Escaped text.
 * @return string HTML.
 */
function openstation_notes_markdown_emphasis( $html ) {
	$html = preg_replace( '/\*\*([^*\n]+?)\*\*/', '<strong>$1</strong>', $html );
	$html = preg_replace( '/(?<![*\w])\*([^*\n]+?)\*(?![*\w])/u', '<em>$1</em>', $html );
	$html = preg_replace( '/(?<![_\w])_([^_\n]+?)_(?![_\w])/u', '<em>$1</em>', $html );
	return preg_replace( '/~~([^~\n]+?)~~/', '<s>$1</s>', $html );
}

/**
 * One line of note text with its Markdown markers dropped — the
 * heading hashes, list bullet, task box, quote marker, emphasis and
 * link syntax — for the derived post title.
 *
 * @param string $line One line.
 * @return string Plain text ('' for a line that is only markup, a rule
 *                or a fence).
 */
function openstation_notes_markdown_plain_line( $line ) {
	$line = trim( (string) $line );
	if ( preg_match( OPENSTATION_NOTES_MD_FENCE, $line ) || preg_match( '/^(-{3,}|\*{3,}|_{3,})$/', $line ) ) {
		return '';
	}
	$line = preg_replace( '/^#{1,6}\s+/', '', $line );
	$line = preg_replace( '/^>\s?/', '', $line );
	$line = preg_replace( '/^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\](?:\s+|$))?/', '', $line );
	$line = preg_replace( '/\[([^\]]+)\]\([^)\s]+\)/', '$1', $line );
	$line = preg_replace( '/(\*\*|~~|`)(.+?)\1/', '$2', $line );
	$line = preg_replace( '/(?<![*\w])\*([^*]+?)\*(?![*\w])/u', '$1', $line );
	$line = preg_replace( '/(?<![_\w])_([^_]+?)_(?![_\w])/u', '$1', $line );
	return trim( $line );
}

/**
 * Convert a note's Markdown into Gutenberg block markup.
 *
 * Paragraphs (single newlines become `<br>`), headings (`#` is an
 * `h2` — the post title is the page's `h1` — and every level below
 * follows), bullet and numbered lists, checklists (a list whose
 * items open with ☐ / ☑; Core has no checklist block, and a glyph
 * survives any theme and any export), quotes, code blocks and
 * separators. Anything else is a paragraph, so no text is ever lost.
 *
 * @param string $text Note text.
 * @return string Serialized block markup (empty string for empty text).
 */
function openstation_notes_text_to_blocks( $text ) {
	$lines  = explode( "\n", str_replace( array( "\r\n", "\r" ), "\n", (string) $text ) );
	$blocks = array();
	$para   = array();
	$quote  = array();
	$list   = null;
	$code   = null;

	$flush_para  = static function () use ( &$para, &$blocks ) {
		if ( $para ) {
			$blocks[] = "<!-- wp:paragraph -->\n<p>" . implode( "<br>\n", $para ) . "</p>\n<!-- /wp:paragraph -->";
			$para     = array();
		}
	};
	$flush_quote = static function () use ( &$quote, &$blocks ) {
		if ( $quote ) {
			$blocks[] = "<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\"><!-- wp:paragraph -->\n<p>"
				. implode( "<br>\n", $quote )
				. "</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->";
			$quote    = array();
		}
	};
	$flush_list  = static function () use ( &$list, &$blocks ) {
		if ( $list ) {
			$items    = array();
			foreach ( $list['items'] as $item ) {
				$items[] = "<!-- wp:list-item -->\n<li>{$item}</li>\n<!-- /wp:list-item -->";
			}
			$tag      = $list['ordered'] ? 'ol' : 'ul';
			$attrs    = $list['ordered'] ? ' {"ordered":true}' : '';
			$blocks[] = "<!-- wp:list{$attrs} -->\n<{$tag} class=\"wp-block-list\">"
				. implode( "\n\n", $items )
				. "</{$tag}>\n<!-- /wp:list -->";
			$list     = null;
		}
	};
	$flush_all   = static function () use ( $flush_para, $flush_quote, $flush_list ) {
		$flush_para();
		$flush_quote();
		$flush_list();
	};
	$flush_code  = static function () use ( &$code, &$blocks ) {
		// Core's code block escapes `[` so a shortcode in the sample
		// stays a sample.
		$body     = str_replace( '[', '&#91;', esc_html( implode( "\n", $code ) ) );
		$blocks[] = "<!-- wp:code -->\n<pre class=\"wp-block-code\"><code>{$body}</code></pre>\n<!-- /wp:code -->";
		$code     = null;
	};

	foreach ( $lines as $raw_line ) {
		$line = trim( $raw_line );

		if ( null !== $code ) {
			if ( preg_match( '/^(`{3,}|~{3,})$/', $line ) ) {
				$flush_code();
			} else {
				$code[] = $raw_line;
			}
			continue;
		}
		if ( preg_match( OPENSTATION_NOTES_MD_FENCE, $line ) ) {
			$flush_all();
			$code = array();
			continue;
		}

		if ( '' === $line ) {
			$flush_all();
			continue;
		}

		if ( preg_match( '/^(#{1,6})\s+(.*)$/', $line, $m ) ) {
			$flush_all();
			$level    = min( 6, strlen( $m[1] ) + 1 );
			$attrs    = 2 === $level ? '' : ' {"level":' . $level . '}';
			$blocks[] = "<!-- wp:heading{$attrs} -->\n<h{$level} class=\"wp-block-heading\">"
				. openstation_notes_markdown_inline( $m[2] )
				. "</h{$level}>\n<!-- /wp:heading -->";
			continue;
		}

		if ( preg_match( '/^(-{3,}|\*{3,}|_{3,})$/', $line ) ) {
			$flush_all();
			$blocks[] = "<!-- wp:separator -->\n<hr class=\"wp-block-separator has-alpha-channel-opacity\"/>\n<!-- /wp:separator -->";
			continue;
		}

		if ( preg_match( '/^>\s?(.*)$/', $line, $m ) ) {
			$flush_para();
			$flush_list();
			$quote[] = openstation_notes_markdown_inline( $m[1] );
			continue;
		}
		$flush_quote();

		if ( preg_match( '/^(?:([-*+])|\d+\.)\s+(.*)$/', $line, $m ) ) {
			$flush_para();
			$ordered = '' === $m[1];
			if ( ! $list || $list['ordered'] !== $ordered ) {
				$flush_list();
				$list = array(
					'ordered' => $ordered,
					'items'   => array(),
				);
			}
			$content = $m[2];
			if ( preg_match( '/^\[([ xX])\](?:\s+(.*))?$/', $content, $task ) ) {
				$box     = ' ' === $task[1] ? "\u{2610}" : "\u{2611}";
				$content = isset( $task[2] ) ? $task[2] : '';
				$item    = $box . ( '' === $content ? '' : ' ' . openstation_notes_markdown_inline( $content ) );
			} else {
				$item = openstation_notes_markdown_inline( $content );
			}
			$list['items'][] = $item;
			continue;
		}

		$flush_list();
		$para[] = openstation_notes_markdown_inline( $line );
	}
	if ( null !== $code ) {
		$flush_code();
	}
	$flush_all();

	return implode( "\n\n", $blocks );
}
