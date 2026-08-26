---
title: "feat: Wall-clock budget for synchronous agent runs"
type: feat
status: draft
date: 2026-08-25
---

# feat: Wall-clock budget for synchronous agent runs

## Summary

Give `openstation_agent_runner_loop()` a wall-clock budget. The loop records its start, and after every turn's tool results are appended it checks elapsed time against a filterable budget (`openstation_agent_run_time_budget`, default 45 seconds). Over budget, it stops calling tools and drops into the existing forced tool-less summary path, with a prompt that tells the model it is wrapping up so the answer reports what was done and what was left, not a pretended completion. Each provider call is additionally ceilinged at the remaining budget, so one slow generation cannot blow through it, and the transient-error retry is skipped once the budget is spent. The result, the invocation log and the `openstation_agent_completed` payload gain `stopReason` and `elapsed`, and the chat renders a "stopped early" caption from them. The real long-term fix, asynchronous runs with a run id and progress polling, is named and deliberately deferred.

---

## Problem Frame

`POST /wp-json/desktop-mode/v1/agents/{id}/invoke` runs the whole agent inside one PHP request. `openstation_agent_runner_loop()` (`includes/agents/runner.php:491`) loops up to `OPENSTATION_AGENT_RUNNER_MAX_TURNS = 8` generate turns (`runner.php:68`, loop at `:508`), each a provider HTTP call allowed `OPENSTATION_AGENT_HTTP_TIMEOUT = 180` seconds (`runner.php:86`), dispatching tool calls between turns and, on the cap, forcing one tool-less summary generate (`runner.php:609-644`). Nothing in the runner measures time; the only `time()` call is the log timestamp (`runner.php:1266`). The bound on a run is therefore nine provider calls at 180 seconds each, plus retries.

Every production gateway in front of PHP has a shorter opinion. nginx's default `fastcgi_read_timeout` is 60 seconds, Cloudflare gives 100, managed hosts sit anywhere between 30 and 120. Verified today on the wordpress-develop nginx stack: two ordinary runs (5 turns / 4 tool calls, and 9 turns / 8 tool calls on claude-sonnet-5) took about 95 seconds each. nginx returned 504 at 60 seconds, the chat showed the error, and PHP-FPM kept going. Both runs sit in the agent's invocation log (`_desktop_mode_agent_runs`, written by `openstation_agent_runner_log_invocation()`, `runner.php:1256`) as `status: done`, finishing 35 seconds after the client had been told they failed. The user retried, and a second full run executed, `desktop-mode/update-post` calls included.

So three failures from one cause: the answer is lost, the work continues as a ghost after the error, and a retry duplicates side effects. wp-env (Apache mod_php, no gateway) and Playground never hit it, which is why the shipped defaults were tuned against runs that simply cannot complete on most real hosts. A client-side patch already on this branch (`src/agents-dispatch.ts:313-328`, tested at `tests/vitest/agents-dispatch.test.ts:267`) turns the bare "HTTP 504" into a message that warns against retrying. That fixes the wording, not the run.

---

## Requirements

- R1. A run stops calling tools once a wall-clock budget is spent, and finishes with a final answer instead of running on past the gateway's patience.
- R2. The budget is filterable (`openstation_agent_run_time_budget`), and returning `0` restores today's unbounded behaviour, mirroring `openstation_agent_http_timeout`'s `0` contract (`runner.php:1030-1034`).
- R3. The default budget plus one summary generate lands under 60 seconds in the common case. The worst case must be documented, not hidden.
- R4. No single provider call may run past the remaining budget: the per-turn HTTP timeout is ceilinged at what is left, with a floor so a turn that starts late still has a usable window.
- R5. The transient-error retry (`runner.php:509-517`) never runs once the budget is spent. A retry doubles a turn's cost; the budget must account for it.
- R6. When the run stops early, the answer says so. The forced summary is prompted to report completed work from the tool transcript, what was not done, and the next step, and never to claim completion it cannot show.
- R7. The result carries `stopReason` (`null`, `'time_budget'`, `'turn_cap'`) and `elapsed` (seconds). They reach the REST response, the invocation log entry, and `openstation_agent_completed`.
- R8. If the summary itself fails after the budget is spent, the run still returns a result with the tool trace and a server-composed fallback text, never a `WP_Error` that discards what was done.
- R9. The chat renders the early stop honestly: a caption on the answer row, distinct from an error row, that survives conversation persistence.
- R10. Existing turn-cap behaviour (`runner.php:609-644`, pinned by `tests/phpunit/tests/agentsRunner.php:549` and `:583`) is unchanged except for the additive `stopReason: 'turn_cap'` and the wrap-up prompt.
- R11. Docs that describe the result shape and the runner's bounds change in the same PR: `docs/hooks-reference.md`, `docs/javascript-reference.md`, `docs/agents-security.md`, `docs/examples/agents.md`, `includes/rest/README.md`.

---

## Scope Boundaries

**In scope**

- The tool loop in `includes/agents/runner.php`: budget check, per-turn ceiling, retry gating, wrap-up prompt, result and log fields.
- `openstation_agent_with_http_timeout()` gaining an optional ceiling argument.
- REST response and TypeScript types for the two new fields; the chat caption; conversation persistence of `stopReason`.
- PHPUnit and Vitest coverage; doc updates listed in R11.

**Out of scope**

- **Asynchronous runs.** Start a run, return a run id, poll or stream progress. Needs a job store, a worker (WP-Cron, Action Scheduler, or a loopback request), a UI for in-flight runs, and a conversation model that can hold a run that is still going. This is the real fix for long tasks and the follow-up this plan exists to make survivable in the meantime. Separate plan.
- **Detecting a departed client.** `connection_aborted()` only learns that the socket closed when PHP writes to it, and the REST handler writes nothing until the JSON envelope at the end. Probing by flushing bytes mid-run would commit the headers and corrupt the response. See KD7 and OQ4.
- **Changing `OPENSTATION_AGENT_RUNNER_MAX_TURNS` or `OPENSTATION_AGENT_HTTP_TIMEOUT`.** Both keep their values and their docblocks; the budget composes with them rather than replacing them.
- **Resuming a stopped run from its tool trace.** The history replay carries text rows only (`runner.php:1172`, `rest.php:190-208`). A "continue" after an early stop resumes from the summary text, which is the existing multi-turn contract. Trace replay is an async-runs concern.
- **Raising `max_execution_time`.** See Context: it is not a wall clock on Linux and cannot serve as the budget.

---

## Context & Research

**The loop, as it is** (`includes/agents/runner.php`):

- `openstation_agent_invoke()` (`:142`) does the rate limits (`:170-178`), identity switch and cap ceiling (`:189-215`), then calls the loop inside `try/finally`. On `WP_Error` it logs a zero-turn entry with the message (`:220-232`) and returns; on success it logs and fires `openstation_agent_completed( $agent_user_id, $message, $result, $context )` (`:244`).
- `openstation_agent_runner_loop()` (`:491`) builds the neutral history, then `for ( $turn = 1; $turn <= MAX_TURNS; $turn++ )` (`:508`): generate (`:509`), one retry if `openstation_agent_generate_error_is_transient()` (`:510-517`, signatures at `:857-874`, which include `cURL error 28` and `Operation timed out`, i.e. exactly what a ceilinged call produces), return on a tool-less answer (`:530-547`), otherwise dispatch every call, build `$tool_trace` and `$results`, and append the `tool_results` row (`:604-607`). After the `for`, the forced tool-less generate (`:615`), with the same retry (`:616-618`), returns `turns = MAX_TURNS + 1` (`:633`) or the `openstation_agent_runner_max_turns` error (`:636-644`), which discards `$tool_trace`.
- `openstation_agent_runner_generate()` (`:926`) applies the `openstation_agent_runner_generate` pre-filter (`:942`) and, when it returns null, wraps `openstation_ai_client_generate()` in `openstation_agent_with_http_timeout()` (`:961-977`).
- `openstation_agent_with_http_timeout()` (`:1022`) reads `openstation_agent_http_timeout` (`:1030`) and installs raise-only closures on `http_request_timeout` and `wp_ai_client_default_request_timeout` at `PHP_INT_MAX` (`:1040-1063`). The raise-only rule is deliberate and tested (`tests/phpunit/tests/agentsRunner.php:828`, `test_http_timeout_never_lowers_a_larger_site_value`). The WordPress default is 5 seconds and Core's prompt builder pins 30, so both are far below any sensible ceiling; a site that set its own larger value keeps it.
- `openstation_agent_runner_compose_prompt()` (`:1079`) flattens history rows (`prior`, `user_text`, `tool_results`; `assistant` rows are skipped) into one user message. The transcript preamble (`:1132-1137`) tells the model not to repeat calls. There is no wrap-up instruction anywhere: the forced summary at `:615` sends the same instructions with `$tool_defs = array()`, so the model learns it has no tools but not that time or turns ran out.
- `openstation_agent_runner_log_invocation()` (`:1256`) writes `{ time, userId, userName, message, status, error, text, turns, toolCallsCount, toolNames }` (`:1265-1278`) to the `_desktop_mode_agent_runs` user meta (frozen key, `:97`), capped at 50. No in-tree reader besides the test (`agentsRunner.php:636`); it is the audit trail.

**Time is never measured.** `grep -nE 'microtime|hrtime|time\(\)|set_time_limit' includes/agents/` finds only the log timestamp. The Copilot search endpoint is the nearest precedent: `includes/ai-copilot/search.php:1958-1962` raises `set_time_limit( 120 )` because its own loop overruns a 30-second `max_execution_time`. That limit counts CPU time on Linux, not time blocked in a socket, which is why a 95-second I/O-bound agent run sails past a 30-second `max_execution_time` today. It is a ceiling on PHP's own work, not a wall clock, and reading `ini_get( 'max_execution_time' )` can only ever be a sanity bound on the budget, never the budget.

**REST and client.** The route (`includes/agents/rest.php:171-210`) accepts `{ message, source, history }`; the handler (`:444-483`) returns `rest_ensure_response( $result )` unchanged, so whatever the loop returns is the wire shape: `{ text, callToActions, toolCalls, turns }` (`src/my-wordpress/agents-types.ts:117`). `invokeAgentIntoTranscript()` (`src/agents-dispatch.ts:266`) pushes a pending row (`:282-289`), POSTs (`:293-307`), maps 504 to the "took too long" message (`:313-328`), copies `text`, `toolCalls`, `callToActions` onto the pending row (`:338-346`) and turns any throw into an `error` row (`:347-350`). `messageRow()` in `src/agent-run-window.ts:551` renders a caption element for attachments (`:605-611`), markdown for agent rows (`:623-630`) and a `<details>` of tool calls (`:633-650`). Rows persist through `openstation_agent_conversation_sanitize_messages()` (`includes/agents/conversations.php:104`), which whitelists fields explicitly (`callToActions` at `:132`, `toolCalls` at `:149-163`), so a new row field is dropped unless added there.

**Tests.** `tests/phpunit/tests/agentsRunner.php` fakes generation through the pre-filter (`stub_generate()`, `:40-42`), which makes slow turns trivial to simulate: the stub can `usleep()`, and it receives `$history` and `$tool_defs`, so it can assert on the wrap-up row and the empty tool list. The two turn-cap tests (`:549`, `:583`) are the template for the budget tests. `agentsRest.php:307` and `:340` cover the invoke round trip and error propagation. `tests/vitest/agents-dispatch.test.ts:247` and `:267` cover error rows and the 504 message; `agent-run-window.test.ts` exists for row rendering.

**Observed timings** that size the defaults: 95 seconds for 9 turns and 8 tool calls, roughly 10 seconds per turn including dispatch, on claude-sonnet-5. A final tool-less answer over that transcript is one more call of the same order.

**Docs that state the current contract**: `docs/hooks-reference.md:4637-4646` (`openstation_agent_completed`, result `{ text, toolCalls, turns }`), `:4668-4683` (`openstation_agent_runner_generate`, lists the history row types), `:4822-4846` (`openstation_agent_http_timeout`, "only ever raises", "bounds a single request, not the whole run: the loop makes up to 8"), `:4866` (the `openstation_agent_invoke()` helper line, "turn cap 8"); `docs/javascript-reference.md:6991-6993` (invoke returns `{ text, toolCalls, turns }`); `docs/agents-security.md:183-194` (Rate limits, the section a time budget belongs next to); `docs/examples/agents.md:67-84` (server-side invoke with the result comment) and `:180` (Safety knobs); `includes/rest/README.md:64` (the invoke row).

---

## Key Technical Decisions

- **KD1. The budget bounds the tool loop; the summary is one more bounded call.** `openstation_agent_run_time_budget` (int seconds, default `OPENSTATION_AGENT_RUN_TIME_BUDGET = 45`, receives `$agent_user_id`) is checked after each turn's `tool_results` row is appended (`runner.php:604-607`). When `elapsed >= budget` the loop breaks to the summary path. The summary generate runs with its own ceiling, `OPENSTATION_AGENT_RUNNER_SUMMARY_TIMEOUT = 20`. Arithmetic with defaults: the last loop turn starts before 45 s and ends within its ceiling; the summary adds up to 20 s. Typical total is around 55 s (observed turns average 10 s); worst case is 45 + 10 (turn floor, KD2) + 20 = 75 s plus tool dispatch. Rejected: a whole-run budget with the summary reserved out of it, which reads better to an operator but makes the loop stop at "budget minus reserve", a number nobody set. OQ1 keeps the question open.

- **KD2. Per-turn ceiling, with a floor, through the existing helper.** `openstation_agent_with_http_timeout( callable $callback, $ceiling = 0 )`: the target the raise closures use becomes `min( $filtered_timeout, $ceiling )` when `$ceiling > 0`. The loop passes `max( $budget - $elapsed, OPENSTATION_AGENT_RUNNER_TURN_FLOOR = 10 )`. The closures still `max()` against the site's current value, so the raise-only rule and its test (`agentsRunner.php:828`) stand: a site that set 300 s keeps 300 s, and the budget then cannot bound that turn, which the docs say. Rejected: no ceiling at all. Without it a single slow generation (the 180-second case the constant was sized for, `runner.php:78-85`) ignores the budget entirely, and behind nginx that answer was never going to arrive anyway. The floor exists because a ceiling of 2 s is a guaranteed `cURL error 28`, which wastes the provider's work for nothing.

- **KD3. No retry past the budget.** The retry at `runner.php:510-517` becomes conditional on `elapsed < budget`. A ceilinged call that times out produces exactly the signatures `openstation_agent_generate_error_is_transient()` matches (`:861-866`), so without this gate every budget exhaustion would cost a second full ceiling. The same gate applies to the summary's retry (`:616-618`).

- **KD4. The model is told it is wrapping up, through the history.** A new neutral row `{ type: 'wrap_up', reason: 'time_budget'|'turn_cap' }` is appended before the forced generate, and `openstation_agent_runner_compose_prompt()` renders it as a closing paragraph: no more tools are available; report what was completed using only the tool transcript above; state what was not done; give the one next step, offered as a call to action when it is a resumable "continue"; do not describe as done anything the transcript does not show. Chosen over a new generate parameter because the pre-filter already receives `$history`, so tests and alternative runtimes see it without a signature change, and because the prompt builder is a pure function with its own tests. The answer schema (`runner.php:661`) is unchanged, so the "Continue where you left off" button rides the existing call-to-action mechanism and the next run gets the context through history replay.

- **KD5. One `stopReason` field, not a boolean per cause.** `stopReason: null | 'time_budget' | 'turn_cap'` and `elapsed: float` (seconds, one decimal, from `hrtime( true )`, monotonic and available since PHP 7.3 against the plugin's 7.4 floor). A `budgetExhausted: true` boolean would leave the turn cap as the opaque `turns = MAX_TURNS + 1` tell it is today (`:633`); one field names both, and the chat, the log and `openstation_agent_completed` listeners read one thing. Both fields are additive; `turns` keeps its meaning.

- **KD6. After the budget, a failed summary still returns a result.** If the wrap-up generate errors, times out, or still calls tools, the loop returns `{ text: <server-composed fallback>, callToActions: [], toolCalls: $tool_trace, turns, stopReason: 'time_budget', elapsed }`. The fallback text is translatable and lists the tool names that ran. Discarding the trace is precisely the bug this plan fixes; a `WP_Error` here would tell the user nothing happened when `update-post` already did. The turn-cap path keeps its existing `openstation_agent_runner_max_turns` error on a failed summary (R10): there the failure is the model calling tools when told not to, and the pinned test at `agentsRunner.php:549` says so.

- **KD7. Keep the run alive on purpose, and say so.** `ignore_user_abort( true )` at the top of the loop, with a docblock. Today the run survives a departed client by accident (PHP only notices on output, and there is none). Making it explicit means a future change that flushes mid-run cannot kill the script halfway through a side-effecting tool call. The budget is what bounds how long the ghost lives; detection of the departed client is out of scope (see Scope Boundaries).

- **KD8. Real sleeps in the PHPUnit tests, no clock seam.** A filtered budget of 1 s and a stub that `usleep()`s 600 ms per turn exhausts the budget on the second check, for about two seconds of test time. Rejected: an `openstation_agent_runner_clock` filter, which would be a permanent public hook whose only consumer is the suite. Revisit if the tests turn flaky (OQ3).

---

## Open Questions

- **OQ1. Loop budget or whole-run budget?** KD1 picks the loop. An operator with a 100-second Cloudflare limit would rather set one number and have the runner derive the rest. If that reads better after a round of use, the change is a subtraction inside the loop and a doc edit, not a contract break, as long as the default lands in the same place.
- **OQ2. Should `elapsed` also count the pre-loop work?** Rate-limit checks and `openstation_agent_runner_build_tools()` (`runner.php:443`) run before the loop starts its clock. They are milliseconds today; if ability catalogues grow, the clock should start in `openstation_agent_invoke()` instead.
- **OQ3. Are 600 ms sleeps stable in CI?** If the budget tests flake, a clock filter (rejected in KD8) is the fix; it would be documented as a test seam the way `openstation_agent_runner_generate` is.
- **OQ4. Is there any honest way to detect a departed client?** nginx does close the upstream connection on a 504, so a probe write would see it. But a probe commits the response headers, and a run that later fails could no longer return its status. If async runs land, the question disappears.
- **OQ5. Should the per-agent settings expose the budget?** Rate limit is already per agent (`openstation_agent_default_rate_limit`, overridable per agent). A per-agent budget is the same shape, but it is a knob for operators, not for authors, and the filter already receives `$agent_user_id`. Leave it to the filter until someone asks.

---

## High-Level Technical Design

One clock, three checkpoints, two new fields.

```
openstation_agent_runner_loop()
  $started  = hrtime( true )
  $budget   = (int) apply_filters( 'openstation_agent_run_time_budget', 45, $agent_user_id )
  ignore_user_abort( true )
  $stop     = null

  for turn 1..MAX_TURNS:
    $ceiling   = $budget > 0 ? max( $budget - elapsed(), TURN_FLOOR ) : 0
    $generated = generate( ..., $ceiling )
    if transient error and elapsed() < $budget:  retry once, same ceiling recomputed
    if error:                                    return humanized error (unchanged)
    if no function calls:                        return answer, stopReason null, elapsed
    dispatch tools, append tool_results row      (unchanged)
    if $budget > 0 and elapsed() >= $budget:     $stop = 'time_budget'; break

  if $stop is null:                              $stop = 'turn_cap'
  history[] = { type: 'wrap_up', reason: $stop }
  $generated = generate( ..., tools = [], ceiling = SUMMARY_TIMEOUT )
  retry once only if transient and elapsed() < $budget
  text answer  -> return { ..., turns, stopReason: $stop, elapsed }
  otherwise:
    'time_budget' -> return { text: fallback listing tool names, ..., stopReason, elapsed }
    'turn_cap'    -> return WP_Error openstation_agent_runner_max_turns   (unchanged)
```

**Result shape** (REST, `openstation_agent_completed`, `AgentInvokeResult`):

```
{ text, callToActions, toolCalls, turns,
  stopReason: null | 'time_budget' | 'turn_cap',
  elapsed: 46.3 }
```

**Log entry** (`_desktop_mode_agent_runs`, additive): `stopReason`, `elapsed`. Error entries carry `elapsed` too when the loop got far enough to measure it (the error path in `openstation_agent_invoke()` currently logs `turns: 0`; the loop can attach `elapsed` as error data for the log to pick up, or the log can leave it at `0`; decide in U6).

**Wrap-up paragraph** appended by `openstation_agent_runner_compose_prompt()` when a `wrap_up` row is present, in substance:

> You have no more tools for this request because it ran out of time (or: reached its turn limit). Write your final answer now from the tool calls listed above and nothing else. Say what was completed, say what was not, and give the single next step. If the work can be resumed, offer it as a call to action. Do not describe anything as done unless a tool result above shows it.

**Chat caption** under an agent row with `stopReason`:

- `time_budget`: "Stopped early: the agent ran out of time after 46 s. Ask it to continue where it left off."
- `turn_cap`: "Stopped early: the agent reached its turn limit."

Rendered with the existing `dm-agent-chat__msg-caption` element (`agent-run-window.ts:607-610`) plus a `--stopped` modifier in `assets/css/agents.css`. It is a caption on an answer, not an `error` row: the answer is real and the tool calls happened.

---

## Implementation Units

- **U1. Budget constants and filter.** `OPENSTATION_AGENT_RUN_TIME_BUDGET = 45`, `OPENSTATION_AGENT_RUNNER_TURN_FLOOR = 10`, `OPENSTATION_AGENT_RUNNER_SUMMARY_TIMEOUT = 20` next to the existing constants (`runner.php:68-86`), each with a docblock stating the nginx arithmetic. `apply_filters( 'openstation_agent_run_time_budget', OPENSTATION_AGENT_RUN_TIME_BUDGET, $agent_user_id )` at the top of the loop, `0` disables. Acceptance: a filter returning `0` reproduces today's behaviour byte for byte on the existing suite.

- **U2. Clock and checkpoint in the loop.** `hrtime( true )` at loop start, an `elapsed()` closure, the post-`tool_results` check (`runner.php:604-607`), `ignore_user_abort( true )` (KD7). Acceptance: with budget 1 s and a stub sleeping 600 ms per tool turn, the pre-filter is called exactly three times (two tool turns, one summary), the summary sees `$tool_defs === array()`, and the result has `stopReason === 'time_budget'`, `turns === 2`, `elapsed >= 1.2`.

- **U3. Per-turn ceiling.** `openstation_agent_with_http_timeout( $callback, $ceiling = 0 )` (`runner.php:1022`): target `min( $timeout, $ceiling )` when `$ceiling > 0`, closures otherwise unchanged. `openstation_agent_runner_generate()` gains a `$ceiling = 0` trailing parameter and forwards it (`:961`). The loop passes `max( remaining, TURN_FLOOR )`; the summary passes `SUMMARY_TIMEOUT`. Acceptance: a new sibling of the tests at `agentsRunner.php:756-856` asserts `http_request_timeout` and `wp_ai_client_default_request_timeout` resolve to the ceiling when it is below the filtered timeout, still never below a larger site value, and are released afterwards.

- **U4. Retry gating.** Both retry sites (`runner.php:510-517`, `:616-618`) check `elapsed() < $budget` (or `$budget <= 0`). Acceptance: a stub that returns a `cURL error 28` `WP_Error` on the turn after the budget is spent is called once for that turn, not twice, and the run proceeds to the summary.

- **U5. Wrap-up row and prompt.** `wrap_up` row appended before the forced generate; `openstation_agent_runner_compose_prompt()` renders it last (`runner.php:1079`, after the transcript block at `:1132-1137`). Acceptance: a compose-prompt unit test shows the paragraph present only when the row is present, with the reason-specific sentence; the U2 test asserts the summary call's `$history` ends with the `wrap_up` row.

- **U6. Result, log and action fields.** `stopReason` and `elapsed` on every return path of the loop (`null` on a normal finish); `openstation_agent_runner_log_invocation()` (`runner.php:1256`) copies both into the entry; the docblocks at `:234-243` and `:1247-1254` list them. Fallback text for the failed summary after a time budget (KD6). Acceptance: `test_invocations_are_logged` (`agentsRunner.php:622`) extended; a new test drives the summary to a `WP_Error` after budget exhaustion and asserts a result with the trace and `stopReason === 'time_budget'`; `openstation_agent_completed` (`agentsRunner.php:110`) receives the fields.

- **U7. REST.** No handler change (`rest.php:444-483` passes the array through). `agentsRest.php:307` gains assertions that `elapsed` is numeric and `stopReason` is `null` on a one-turn run. `includes/rest/README.md:64` mentions the budget and the two fields.

- **U8. TypeScript types and dispatch.** `AgentInvokeResult` (`src/my-wordpress/agents-types.ts:117`) and `AgentChatMessage` (`src/agents-chat-store.ts:42`) gain `stopReason?` and `elapsed?`; `invokeAgentIntoTranscript()` copies them onto the pending row next to `toolCalls` (`src/agents-dispatch.ts:338-346`). Acceptance: a Vitest case in `agents-dispatch.test.ts` feeds a result with `stopReason: 'time_budget'` and finds it on the transcript row, and the history replay (`:274-276`) still excludes only pending and error rows.

- **U9. Chat caption.** `messageRow()` (`src/agent-run-window.ts:551`) appends the caption for agent rows with a `stopReason`, after the text and before the tool-call `<details>`; modifier class in `assets/css/agents.css`. Acceptance: `agent-run-window.test.ts` renders a row with each reason and checks the caption text; a row without one renders no caption.

- **U10. Conversation persistence.** `openstation_agent_conversation_sanitize_messages()` (`includes/agents/conversations.php:104`) whitelists `stopReason` (enum) and `elapsed` (float) on agent rows. Acceptance: `agentsConversations.php` round-trips both and drops an unknown reason.

- **U11. Docs.** See Documentation Plan.

- **U12. Build and gates.** `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:js`, `npm run lint:php`, `npm run test:php -- --filter='Tests_OpenStation_Agents'`.

---

## System-Wide Impact

- **Behaviour on hosts without a gateway.** wp-env and Playground currently complete 95-second runs; after this they stop at the budget and summarise. That is the trade: correctness on the common deployment over maximal run length on the development one. The filter restores the old behaviour in one line, and the doc says so next to the default.
- **Provider cost.** A ceilinged call that times out still billed the provider for the tokens it generated. KD2's floor and KD3's retry gate keep that to at most one wasted call per run. Without the ceiling the same run wasted every turn after the 504, plus the retry's whole second run.
- **Public contract.** Two additive result fields on the REST response, `openstation_agent_completed`, and the log entry; one new filter; one new history row type visible to `openstation_agent_runner_generate` callbacks (they already ignore unknown row types by the documented shape, but the doc lists types, so it must list this one); one optional trailing parameter on `openstation_agent_with_http_timeout()` and `openstation_agent_runner_generate()`. Nothing existing changes shape or meaning.
- **Turn-cap path.** Gains the wrap-up prompt and `stopReason: 'turn_cap'`. The pinned call counts and error code at `agentsRunner.php:549` and `:583` hold.
- **Frozen keys.** `_desktop_mode_agent_runs` keeps its name; the entry gains keys, older entries lack them, and the log reader (tests only today) must treat them as optional.

---

## Risk Analysis & Mitigation

- **The budget still overshoots the gateway.** Worst case with defaults is about 75 s plus tool dispatch (KD1). Mitigated by the floor and the summary ceiling being small, by documenting the arithmetic so an operator on a 30-second host sets 20, and by OQ1 if a whole-run semantic proves clearer. The complete fix is async runs.
- **The summary times out and the fallback text is what the user sees.** Mitigated by KD6: the trace and the tool names survive, and the caption says the run stopped early. The fallback wording must name the tools that ran, since that is the only answer to "did it update the post?".
- **The model ignores the wrap-up and claims completion.** The paragraph tells it to use only the transcript, and the tool-call `<details>` on the row lets the user check. Mitigated further by the caption, which is rendered from `stopReason` rather than from anything the model wrote.
- **A ceilinged first turn cuts a legitimate long generation.** The 180-second constant was sized for a long post rewrite (`runner.php:78-85`). Behind a gateway that rewrite never arrived anyway; on a direct host the filter restores it. Documented next to `openstation_agent_http_timeout`, whose "only ever raises" sentence changes to "raises, then ceilings at the remaining budget".
- **Site-level timeout larger than the ceiling.** The raise-only closures cannot lower a site's own 300 s, so that turn ignores the budget. Documented; not worth breaking the raise-only rule over.
- **Flaky sleep-based tests.** OQ3; two seconds of sleep across the suite, and the assertions are on call counts and fields, not on measured durations beyond `>=`.
- **Ghost work still happens inside the budget window.** A client that gave up at 60 s while the server was at 50 s still sees the run finish and log. That is the same as today, bounded. The log entry now carries `elapsed`, so the operator can see it happened.

---

## Phased Delivery

- **P1. Runner.** U1 through U7 and the PHP half of U11. Ships the bound, the wrap-up, the fields, the log, the docs. Independently valuable: the REST response already carries everything the client needs, and the 504 message already on this branch covers the client until P2.
- **P2. Client.** U8 through U10 and the JS half of U11. The caption, the persisted field, the types.
- **P3. Async runs.** Separate plan. Run id, job store, worker, progress in the chat window, cancel. This plan's `stopReason` and `elapsed` stay meaningful there (a worker has its own budget), so nothing in P1 or P2 is throwaway.

---

## Documentation Plan

- `docs/hooks-reference.md`: new `### openstation_agent_run_time_budget` after `openstation_agent_http_timeout` (`:4822-4846`), with the default, the `0` contract, the arithmetic, the "set it to about three quarters of your gateway timeout" guidance, and the `max_execution_time` caveat; amend `openstation_agent_http_timeout` (`:4835-4837`) to say it raises and is then ceilinged at the remaining budget and the summary allowance; `openstation_agent_completed` result shape (`:4645`) gains `stopReason` and `elapsed`; `openstation_agent_runner_generate` (`:4680`) lists the `wrap_up` row; the `openstation_agent_invoke()` helper line (`:4866`) says "turn cap 8, wall-clock budget 45 s".
- `docs/javascript-reference.md:6991-6993`: the invoke result shape, and one sentence on reading `stopReason` in a custom intake.
- `docs/agents-security.md`: a `## Time budget` section after Rate limits (`:183-194`): the budget is also a blast-radius bound, since it caps how long a run can keep acting after its caller stopped listening; add the budget to the checklist at `:196`.
- `docs/examples/agents.md`: the result comment at `:78` and a filter snippet under Safety knobs (`:180`), for example `add_filter( 'openstation_agent_run_time_budget', fn() => 80 );` with a comment naming the gateway it is sized for.
- `includes/rest/README.md:64`: one clause on the budget and the two fields.
- `docs/api-index.md:189-200`: no change; it points at the hooks reference.
- No migration note: every change is additive.

---

## Sources & References

- `includes/agents/runner.php`: constants `:68`, `:86`; `openstation_agent_invoke()` `:142`, completion action `:244`; loop `:491-644`; transient signatures `:857-874`; generate and pre-filter `:926-991`; `openstation_agent_with_http_timeout()` `:1022-1066`; `openstation_agent_runner_compose_prompt()` `:1079-1141`; `openstation_agent_runner_log_invocation()` `:1256-1290`.
- `includes/agents/rest.php:171-210` (route), `:444-483` (handler).
- `includes/agents/conversations.php:104-170` (`openstation_agent_conversation_sanitize_messages()`).
- `includes/ai-copilot/search.php:1958-1962` (the `set_time_limit( 120 )` precedent and why it is not a wall clock).
- `src/agents-dispatch.ts:266-356`, `src/agent-run-window.ts:551-670`, `src/my-wordpress/agents-types.ts:117`, `src/agents-chat-store.ts:42`.
- `tests/phpunit/tests/agentsRunner.php:40-42` (`stub_generate()`), `:549` and `:583` (turn-cap tests), `:622-640` (log test), `:756-856` (HTTP timeout tests); `tests/phpunit/tests/agentsRest.php:307`, `:340`; `tests/vitest/agents-dispatch.test.ts:247`, `:267`.
- `docs/hooks-reference.md:4565` (AI Agents), `:4637`, `:4668`, `:4822`, `:4866`; `docs/javascript-reference.md:6963`, `:6991`; `docs/agents-security.md:183`, `:196`, `:232`; `docs/examples/agents.md:67`, `:180`; `includes/rest/README.md:64`; `docs/api-index.md:189`.
- Verified today on the wordpress-develop nginx stack: two ~95 s runs (5 turns / 4 tool calls; 9 turns / 8 tool calls, claude-sonnet-5), 504 at 60 s, both logged `status: done` about 35 s later, retry re-ran `desktop-mode/update-post`.
