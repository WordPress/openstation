<?php

defined( 'ABSPATH' ) || exit;

function openstation_comments_window_spam_score( $comment ) {
	$comment = get_comment( $comment );
	if ( ! $comment instanceof WP_Comment ) {
		return 0;
	}

	$score = 0;

	$akismet_result = (string) get_comment_meta( $comment->comment_ID, 'akismet_result', true );
	if ( 'true' === $akismet_result ) {
		$score += 35;
	}

	if ( 'spam' === wp_get_comment_status( $comment ) ) {
		$score += 25;
	}

	$author_email = (string) $comment->comment_author_email;
	if ( '' !== $author_email ) {
		$prior_spam  = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'spam',
				'count'        => true,
			)
		);
		$prior_total = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'all',
				'count'        => true,
			)
		);
		if ( $prior_total >= 3 ) {
			$rate = $prior_spam / $prior_total;
			if ( $rate >= 0.5 ) {
				$score += 30;
			} elseif ( $rate >= 0.2 ) {
				$score += 20;
			}
		}
	}

	$link_count = preg_match_all( '#https?://#i', (string) $comment->comment_content );
	if ( $link_count >= 4 ) {
		$score += 15;
	} elseif ( $link_count >= 2 ) {
		$score += 5;
	}

	$disallowed = (string) get_option( 'disallowed_keys', '' );
	if ( '' !== trim( $disallowed ) ) {
		$keys = array_filter( array_map( 'trim', explode( "\n", $disallowed ) ) );
		foreach ( $keys as $key ) {
			if ( '' === $key ) {
				continue;
			}
			if ( false !== stripos( $comment->comment_content, $key )
				|| false !== stripos( $comment->comment_author, $key )
				|| false !== stripos( $comment->comment_author_email, $key )
				|| false !== stripos( $comment->comment_author_url, $key )
			) {
				$score += 10;
				break;
			}
		}
	}

	if ( 0 === (int) $comment->user_id ) {
		$prior_approved = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'approve',
				'count'        => true,
			)
		);
		if ( 0 === $prior_approved ) {
			$score += 10;
		}
	}

	$score = max( 0, min( 100, $score ) );

	$score = (int) apply_filters(
		'openstation_comments_window_spam_score',
		$score,
		$comment
	);

	return max( 0, min( 100, $score ) );
}
