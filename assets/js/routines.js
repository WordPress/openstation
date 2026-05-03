(function() {
  "use strict";
  function el$1(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    const { class: className, dataset, ...rest } = props;
    if (className) {
      node.className = className;
    }
    if (dataset) {
      for (const [k, v] of Object.entries(dataset)) {
        node.dataset[k] = v;
      }
    }
    Object.assign(node, rest);
    for (const child of children) {
      node.append(child);
    }
    return node;
  }
  function openModal(body, title) {
    const overlay = el$1("div", { class: "wpdm-routines__modal" });
    const card = el$1("div", { class: "wpdm-routines__modal-card" });
    const heading = el$1("h3", { class: "wpdm-routines__modal-heading" });
    heading.textContent = title;
    card.append(heading);
    overlay.append(card);
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        close();
      }
    };
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        close();
      }
    });
    document.addEventListener("keydown", onKey);
    body.append(overlay);
    return { card, close };
  }
  function groupBy(items, key) {
    const out = /* @__PURE__ */ new Map();
    for (const item of items) {
      const raw = item[String(key)];
      const k = String(raw ?? "") || "—";
      const bucket = out.get(k);
      if (bucket) {
        bucket.push(item);
      } else {
        out.set(k, [item]);
      }
    }
    return out;
  }
  function attachAutocomplete(input, suggestionsOf) {
    const state2 = {
      popover: null,
      highlight: 0,
      suggestions: []
    };
    const close = () => {
      state2.popover?.remove();
      state2.popover = null;
      state2.highlight = 0;
      state2.suggestions = [];
    };
    const open = () => {
      const ctx = activeContext(input);
      if (!ctx) {
        close();
        return;
      }
      const all = suggestionsOf();
      const q = ctx.query.toLowerCase();
      const filtered = all.filter((s) => {
        if (!q) {
          return true;
        }
        return s.path.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      });
      state2.suggestions = filtered.slice(0, 12);
      state2.highlight = 0;
      render(input, state2, (s) => insert(input, ctx, s, close));
    };
    input.addEventListener("input", open);
    input.addEventListener("click", open);
    input.addEventListener("keyup", (ev) => {
      const k = ev.key;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) {
        open();
      }
    });
    input.addEventListener("keydown", (e) => {
      const ev = e;
      if (!state2.popover || state2.suggestions.length === 0) {
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        state2.highlight = (state2.highlight + 1) % state2.suggestions.length;
        repaint(state2);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        state2.highlight = (state2.highlight - 1 + state2.suggestions.length) % state2.suggestions.length;
        repaint(state2);
      } else if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        const ctx = activeContext(input);
        const pick = state2.suggestions[state2.highlight];
        if (ctx && pick) {
          insert(input, ctx, pick, close);
        }
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(close, 120);
    });
  }
  function activeContext(input) {
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const lastOpen = before.lastIndexOf("{{");
    if (lastOpen < 0) {
      return null;
    }
    const lastClose = before.lastIndexOf("}}");
    if (lastClose > lastOpen) {
      return null;
    }
    const query = before.slice(lastOpen + 2).replace(/^\s+/, "");
    const after = value.slice(caret);
    const closeIdx = after.indexOf("}}");
    const tokenEnd = closeIdx >= 0 ? caret + closeIdx + 2 : caret;
    return { tokenStart: lastOpen, tokenEnd, query };
  }
  function render(input, state2, pickHandler) {
    if (state2.suggestions.length === 0) {
      state2.popover?.remove();
      state2.popover = null;
      return;
    }
    if (!state2.popover) {
      state2.popover = el$1("ul", { class: "wpdm-routines__ac" });
      input.parentElement?.append(state2.popover);
    }
    state2.popover.replaceChildren();
    state2.suggestions.forEach((s, i) => {
      const li = el$1("li", {
        class: "wpdm-routines__ac-item" + (i === state2.highlight ? " is-active" : "")
      });
      const path = el$1("span", { class: "wpdm-routines__ac-path" });
      path.textContent = s.path;
      const type = el$1("span", { class: "wpdm-routines__ac-type" });
      type.textContent = s.type;
      li.append(path, type);
      if (s.description) {
        const desc = el$1("span", { class: "wpdm-routines__ac-desc" });
        desc.textContent = s.description;
        li.append(desc);
      }
      li.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        pickHandler(s);
      });
      li.addEventListener("mouseenter", () => {
        input.dispatchEvent(
          new CustomEvent("wpdm-routines-highlight", {
            bubbles: true,
            detail: { source: s.path }
          })
        );
      });
      li.addEventListener("mouseleave", () => {
        input.dispatchEvent(
          new CustomEvent("wpdm-routines-highlight", {
            bubbles: true,
            detail: { source: null }
          })
        );
      });
      state2.popover.append(li);
    });
  }
  function repaint(state2) {
    if (!state2.popover) {
      return;
    }
    const items = state2.popover.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("is-active", i === state2.highlight);
    }
  }
  function insert(input, ctx, pick, close) {
    const before = input.value.slice(0, ctx.tokenStart);
    const after = input.value.slice(ctx.tokenEnd);
    const inserted = `{{${pick.path}}}`;
    input.value = before + inserted + after;
    const caret = before.length + inserted.length;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }
  function renderInspector(ctx) {
    const panel = el$1("aside", { class: "wpdm-routines__inspector" });
    const header = el$1("header", { class: "wpdm-routines__inspector-head" });
    const heading = el$1("h3", {});
    const closeBtn = el$1("button", {
      class: "wpdm-routines__icon-btn",
      type: "button",
      title: "Close"
    });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", ctx.onClose);
    header.append(heading, closeBtn);
    panel.append(header);
    const body = el$1("div", { class: "wpdm-routines__inspector-body" });
    panel.append(body);
    if (ctx.target.kind === "trigger") {
      heading.textContent = "Trigger";
      body.append(renderTriggerEditor(ctx));
    } else if (ctx.target.kind === "condition") {
      heading.textContent = "Top-level condition";
      body.append(renderConditionsEditor(ctx));
    } else if (ctx.target.step) {
      heading.textContent = stepHeading(ctx.target.step);
      body.append(renderStepEditor(ctx, ctx.target.step));
    }
    return panel;
  }
  function stepHeading(step) {
    const kindLabel = {
      command: "Command",
      ai_tool: "AI tool",
      action: "Action",
      email: "Email",
      http: "HTTP request",
      log: "Log",
      wait: "Wait",
      if: "Branch (if / else)",
      stop: "Stop",
      set_var: "Set variable"
    };
    return kindLabel[step.kind] + (step.id ? ` — ${step.id}` : "");
  }
  function renderTriggerEditor(ctx) {
    const wrap = el$1("div", { class: "wpdm-routines__form" });
    const declared = ctx.catalog.triggers.find(
      (t) => t.id === ctx.def.trigger.id
    );
    wrap.append(
      formRow("Trigger", readOnly(ctx.def.trigger.id)),
      formRow("Kind", readOnly(ctx.def.trigger.kind)),
      formRow(
        "Priority",
        numberField(String(ctx.def.trigger.priority), (v) => {
          ctx.def.trigger.priority = parseInt(v, 10) || 10;
          ctx.onChange();
        })
      )
    );
    if (declared) {
      const schemaKeys = Object.keys(declared.payload_schema || {});
      if (schemaKeys.length > 0) {
        const schemaSection = el$1("section", {
          class: "wpdm-routines__schema"
        });
        const h = el$1("h4", {});
        h.textContent = "Available variables";
        schemaSection.append(h);
        const list = el$1("ul", { class: "wpdm-routines__schema-list" });
        for (const path of schemaKeys) {
          const entry = declared.payload_schema[path];
          const li = el$1("li", {});
          const code = el$1("code", {});
          code.textContent = `{{payload.${path}}}`;
          li.append(code);
          if (entry?.description) {
            li.append(" — ", entry.description);
          }
          if (entry?.type) {
            li.append(` (${entry.type})`);
          }
          list.append(li);
        }
        schemaSection.append(list);
        wrap.append(schemaSection);
      }
    } else {
      const note = el$1("p", { class: "wpdm-routines__hint" }, [
        "This trigger is not declared by any plugin. Variable autocomplete uses positional `{{payload.arg0}}`, `{{payload.arg1}}`, … fallbacks."
      ]);
      wrap.append(note);
    }
    return wrap;
  }
  function renderConditionsEditor(ctx) {
    const wrap = el$1("div", { class: "wpdm-routines__form" });
    const intro = el$1("p", { class: "wpdm-routines__hint" }, [
      "Top-level conditions ALL must pass for the steps to run. Use them as a coarse filter; per-step branching belongs in `if` steps."
    ]);
    wrap.append(intro);
    const list = el$1("div", { class: "wpdm-routines__conditions-list" });
    const repaint2 = () => {
      list.replaceChildren();
      ctx.def.conditions.forEach((cond, i) => {
        list.append(
          conditionRow(
            cond,
            ctx,
            () => {
              ctx.def.conditions.splice(i, 1);
              ctx.onChange();
              repaint2();
            }
          )
        );
      });
    };
    repaint2();
    wrap.append(list);
    const addBtn = el$1(
      "button",
      { class: "wpdm-routines__btn", type: "button" },
      ["+ Add condition"]
    );
    addBtn.addEventListener("click", () => {
      ctx.def.conditions.push({ left: "", op: "eq", right: "" });
      ctx.onChange();
      repaint2();
    });
    wrap.append(addBtn);
    return wrap;
  }
  function conditionRow(cond, ctx, onRemove) {
    const row = el$1("div", { class: "wpdm-routines__condition" });
    const remove = el$1(
      "button",
      {
        class: "wpdm-routines__icon-btn wpdm-routines__condition-remove",
        type: "button",
        title: "Remove condition"
      },
      ["×"]
    );
    remove.addEventListener("click", onRemove);
    row.append(remove);
    row.append(
      labelledValueField("Left", String(cond.left ?? ""), ctx, (v) => {
        cond.left = v;
        ctx.onChange();
      }),
      formRow(
        "Operator",
        operatorSelect(ctx.catalog.operators, cond.op, (v) => {
          cond.op = v;
          ctx.onChange();
        })
      ),
      labelledValueField(
        "Right",
        String(cond.right ?? ""),
        ctx,
        (v) => {
          cond.right = v;
          ctx.onChange();
        }
      )
    );
    return row;
  }
  function labelledValueField(label, initial, ctx, onInput) {
    const wrap = el$1("div", { class: "wpdm-routines__form-row" });
    const lab = el$1("label", { class: "wpdm-routines__form-label" });
    lab.textContent = label;
    wrap.append(lab);
    const inputWrap = el$1("div", { class: "wpdm-routines__value-input" });
    const input = textField(initial, onInput);
    attachAutocomplete(input, () => suggestionsFor(ctx));
    const picker = buildVarPickerButton(input, ctx);
    inputWrap.append(input, picker);
    wrap.append(inputWrap);
    return wrap;
  }
  function buildVarPickerButton(input, ctx) {
    const btn = el$1("button", {
      class: "wpdm-routines__var-picker-btn",
      type: "button",
      title: "Pick a variable"
    });
    btn.textContent = "{x}";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openVarPickerPopover(btn, input, ctx);
    });
    return btn;
  }
  function openVarPickerPopover(anchor, input, ctx) {
    document.querySelectorAll(".wpdm-routines__var-popover").forEach((n) => n.remove());
    const list = suggestionsFor(ctx);
    if (list.length === 0) {
      return;
    }
    const pop = el$1("div", { class: "wpdm-routines__var-popover" });
    const groups = /* @__PURE__ */ new Map();
    const labels = {
      payload: "Trigger payload",
      vars: "Upstream step results",
      site: "Site",
      user: "User",
      custom: "Other"
    };
    for (const s of list) {
      const arr = groups.get(s.source) ?? [];
      arr.push(s);
      groups.set(s.source, arr);
    }
    const order = [
      "payload",
      "vars",
      "site",
      "user",
      "custom"
    ];
    for (const key of order) {
      const items = groups.get(key);
      if (!items || items.length === 0) {
        continue;
      }
      const heading = el$1("h5", { class: "wpdm-routines__var-popover-h" });
      heading.textContent = labels[key];
      pop.append(heading);
      for (const s of items) {
        const item = el$1("button", {
          class: "wpdm-routines__var-popover-item",
          type: "button"
        });
        const path = el$1("span", {
          class: "wpdm-routines__var-popover-path"
        });
        path.textContent = s.path;
        item.append(path);
        if (s.type) {
          const ty = el$1("span", {
            class: "wpdm-routines__var-popover-type"
          });
          ty.textContent = s.type;
          item.append(ty);
        }
        if (s.description) {
          const desc = el$1("span", {
            class: "wpdm-routines__var-popover-desc"
          });
          desc.textContent = s.description;
          item.append(desc);
        }
        item.addEventListener("mouseenter", () => {
          input.dispatchEvent(
            new CustomEvent("wpdm-routines-highlight", {
              bubbles: true,
              detail: { source: s.path }
            })
          );
        });
        item.addEventListener("mouseleave", () => {
          input.dispatchEvent(
            new CustomEvent("wpdm-routines-highlight", {
              bubbles: true,
              detail: { source: null }
            })
          );
        });
        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          input.value = `{{${s.path}}}`;
          input.dispatchEvent(
            new Event("input", { bubbles: true })
          );
          close();
          input.focus();
        });
        pop.append(item);
      }
    }
    const ar = anchor.getBoundingClientRect();
    pop.style.top = `${ar.bottom + 4}px`;
    pop.style.left = `${ar.left}px`;
    document.body.append(pop);
    const close = () => {
      pop.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey);
    };
    const onOutside = (ev) => {
      if (!pop.contains(ev.target)) {
        close();
      }
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        close();
      }
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey);
    }, 0);
  }
  function renderStepEditor(ctx, step) {
    const wrap = el$1("div", { class: "wpdm-routines__form" });
    wrap.append(
      formRow(
        "Step ID",
        textField(step.id, (v) => {
          step.id = v;
          ctx.onChange();
        }),
        "Optional — used to reference this step's result via {{vars.<id>}}."
      )
    );
    switch (step.kind) {
      case "log":
        wrap.append(logFields(ctx, step));
        break;
      case "email":
        wrap.append(emailFields(ctx, step));
        break;
      case "http":
        wrap.append(httpFields(ctx, step));
        break;
      case "wait":
        wrap.append(waitFields(ctx, step));
        break;
      case "set_var":
        wrap.append(setVarFields(ctx, step));
        break;
      case "stop":
        wrap.append(stopFields(ctx, step));
        break;
      case "if":
        wrap.append(ifFields(ctx, step));
        break;
      case "action":
      case "ai_tool":
      case "command":
        wrap.append(dynamicArgsFields(ctx, step));
        break;
    }
    return wrap;
  }
  function logFields(ctx, step) {
    const wrap = el$1("div", {});
    const args = step.args;
    wrap.append(
      formRow(
        "Level",
        selectField(
          ["info", "warning", "error"],
          args.level || "info",
          (v) => {
            args.level = v;
            ctx.onChange();
          }
        )
      )
    );
    const ta = textareaField(
      args.message || "",
      (v) => {
        args.message = v;
        ctx.onChange();
      }
    );
    attachAutocomplete(ta, () => suggestionsFor(ctx));
    wrap.append(formRow("Message", ta));
    return wrap;
  }
  function emailFields(ctx, step) {
    const wrap = el$1("div", {});
    const args = step.args;
    const toEl = textField(args.to || "", (v) => {
      args.to = v;
      ctx.onChange();
    });
    attachAutocomplete(toEl, () => suggestionsFor(ctx));
    const subEl = textField(args.subject || "", (v) => {
      args.subject = v;
      ctx.onChange();
    });
    attachAutocomplete(subEl, () => suggestionsFor(ctx));
    const bodyEl = textareaField(args.body || "", (v) => {
      args.body = v;
      ctx.onChange();
    });
    attachAutocomplete(bodyEl, () => suggestionsFor(ctx));
    wrap.append(
      formRow("To", toEl, "Defaults to admin email when blank."),
      formRow("Subject", subEl),
      formRow("Body", bodyEl)
    );
    return wrap;
  }
  function httpFields(ctx, step) {
    const wrap = el$1("div", {});
    const args = step.args;
    const urlEl = textField(String(args.url || ""), (v) => {
      args.url = v;
      ctx.onChange();
    });
    attachAutocomplete(urlEl, () => suggestionsFor(ctx));
    const bodyEl = textareaField(
      typeof args.body === "string" ? args.body : JSON.stringify(args.body ?? ""),
      (v) => {
        try {
          args.body = JSON.parse(v);
        } catch {
          args.body = v;
        }
        ctx.onChange();
      }
    );
    attachAutocomplete(bodyEl, () => suggestionsFor(ctx));
    wrap.append(
      formRow(
        "URL",
        urlEl,
        "Host must be in `wp_desktop_routine_http_allowlist` (default: empty)."
      ),
      formRow(
        "Method",
        selectField(
          ["GET", "POST", "PUT", "PATCH", "DELETE"],
          String(args.method || "GET").toUpperCase(),
          (v) => {
            args.method = v;
            ctx.onChange();
          }
        )
      ),
      formRow("Body", bodyEl, "JSON or raw string.")
    );
    return wrap;
  }
  function waitFields(ctx, step) {
    const args = step.args;
    const wrap = el$1("div", {});
    wrap.append(
      formRow(
        "Seconds",
        numberField(
          String(args.seconds ?? 1),
          (v) => {
            args.seconds = Math.max(0, Math.min(5, parseInt(v, 10) || 0));
            ctx.onChange();
          }
        ),
        "Capped at 5 seconds. Longer waits land in Phase 3 via Action Scheduler."
      )
    );
    return wrap;
  }
  function setVarFields(ctx, step) {
    const args = step.args;
    const wrap = el$1("div", {});
    wrap.append(
      formRow(
        "Name",
        textField(args.name || "", (v) => {
          args.name = v;
          ctx.onChange();
        })
      )
    );
    const valEl = textField(
      typeof args.value === "string" ? args.value : JSON.stringify(args.value ?? ""),
      (v) => {
        try {
          args.value = JSON.parse(v);
        } catch {
          args.value = v;
        }
        ctx.onChange();
      }
    );
    attachAutocomplete(valEl, () => suggestionsFor(ctx));
    wrap.append(formRow("Value", valEl));
    return wrap;
  }
  function stopFields(ctx, step) {
    const args = step.args;
    const wrap = el$1("div", {});
    const reasonEl = textField(args.reason || "", (v) => {
      args.reason = v;
      ctx.onChange();
    });
    attachAutocomplete(reasonEl, () => suggestionsFor(ctx));
    wrap.append(formRow("Reason", reasonEl));
    return wrap;
  }
  function ifFields(ctx, step) {
    const wrap = el$1("div", {});
    if (!step.condition) {
      step.condition = { left: "", op: "eq", right: "" };
    }
    const cond = step.condition;
    wrap.append(
      labelledValueField("Left", String(cond.left ?? ""), ctx, (v) => {
        cond.left = v;
        ctx.onChange();
      }),
      formRow(
        "Operator",
        operatorSelect(ctx.catalog.operators, cond.op, (v) => {
          cond.op = v;
          ctx.onChange();
        })
      ),
      labelledValueField("Right", String(cond.right ?? ""), ctx, (v) => {
        cond.right = v;
        ctx.onChange();
      }),
      el$1("p", { class: "wpdm-routines__hint" }, [
        "Edit `then` and `else` branches by clicking their cards on the canvas."
      ])
    );
    return wrap;
  }
  function dynamicArgsFields(ctx, step) {
    const wrap = el$1("div", {});
    let schema = null;
    if (step.kind === "action") {
      const found = ctx.catalog.actions.find((a) => a.id === step.id);
      schema = found?.args_schema || null;
    } else if (step.kind === "ai_tool") {
      const found = ctx.catalog.ai_tools.find((t) => t.name === step.id);
      const params = found?.parameters;
      schema = params?.properties || null;
    }
    const args = step.args;
    if (!schema || Object.keys(schema).length === 0) {
      const ta = textareaField(JSON.stringify(args, null, 2), (v) => {
        try {
          step.args = JSON.parse(v);
          ctx.onChange();
        } catch {
        }
      });
      attachAutocomplete(ta, () => suggestionsFor(ctx));
      wrap.append(formRow("Args (JSON)", ta));
      return wrap;
    }
    for (const key of Object.keys(schema)) {
      const desc = schema[key] || {};
      const cur = args[key];
      let initial = "";
      if (cur !== void 0 && cur !== null) {
        initial = typeof cur === "string" ? cur : JSON.stringify(cur);
      }
      const input = textField(initial, (v) => {
        if (desc.type === "integer" || desc.type === "number") {
          const n = parseFloat(v);
          args[key] = Number.isFinite(n) ? n : v;
        } else {
          args[key] = v;
        }
        ctx.onChange();
      });
      attachAutocomplete(input, () => suggestionsFor(ctx));
      wrap.append(
        formRow(key, input, desc.description || `Type: ${desc.type || "string"}`)
      );
    }
    return wrap;
  }
  function formRow(label, control, hint) {
    const row = el$1("div", { class: "wpdm-routines__form-row" });
    const lab = el$1("label", { class: "wpdm-routines__form-label" });
    lab.textContent = label;
    row.append(lab, control);
    if (hint) {
      const h = el$1("p", { class: "wpdm-routines__form-hint" });
      h.textContent = hint;
      row.append(h);
    }
    return row;
  }
  function textField(value, onChange) {
    const input = el$1("input", {
      class: "wpdm-routines__input",
      type: "text",
      value
    });
    input.addEventListener("input", () => onChange(input.value));
    return input;
  }
  function numberField(value, onChange) {
    const input = el$1("input", {
      class: "wpdm-routines__input",
      type: "number",
      value
    });
    input.addEventListener("input", () => onChange(input.value));
    return input;
  }
  function textareaField(value, onChange) {
    const ta = el$1("textarea", {
      class: "wpdm-routines__textarea",
      spellcheck: false
    });
    ta.value = value;
    ta.addEventListener("input", () => onChange(ta.value));
    return ta;
  }
  function selectField(options, value, onChange) {
    const sel = el$1("select", { class: "wpdm-routines__input" });
    for (const opt of options) {
      const o = el$1("option", { value: opt });
      o.textContent = opt;
      if (opt === value) {
        o.selected = true;
      }
      sel.append(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }
  function operatorSelect(operators, value, onChange) {
    const sel = el$1("select", { class: "wpdm-routines__input" });
    for (const op of operators) {
      const o = el$1("option", { value: op });
      o.textContent = op;
      if (op === value) {
        o.selected = true;
      }
      sel.append(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }
  function readOnly(value) {
    const span = el$1("span", { class: "wpdm-routines__readonly" });
    span.textContent = value;
    return span;
  }
  function suggestionsFor(ctx) {
    const out = [];
    out.push(
      { path: "site.url", type: "string", description: "Site URL", source: "site" },
      { path: "site.name", type: "string", description: "Site name", source: "site" },
      { path: "user.id", type: "integer", description: "Run-as user id", source: "user" }
    );
    const declared = ctx.catalog.triggers.find(
      (t) => t.id === ctx.def.trigger.id
    );
    if (declared && declared.payload_schema) {
      for (const [path, raw] of Object.entries(declared.payload_schema)) {
        const d = raw || {};
        out.push({
          path: "payload." + path,
          type: d.type || "unknown",
          description: d.description || "",
          source: "payload"
        });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        out.push({
          path: `payload.arg${i}`,
          type: "unknown",
          description: "Positional hook arg",
          source: "payload"
        });
      }
    }
    const upstream = collectStepIds(ctx.def.steps, ctx.target.stepPath);
    for (const id of upstream) {
      out.push({
        path: `vars.${id}`,
        type: "unknown",
        description: "Result of an upstream step",
        source: "vars"
      });
    }
    return out;
  }
  function collectStepIds(steps, stopAt) {
    const out = [];
    const walk = (list, path) => {
      for (let i = 0; i < list.length; i++) {
        const here = [...path, i];
        if (stopAt && pathStartsWith(stopAt, here)) {
          return;
        }
        const step = list[i];
        if (step.id) {
          out.push(step.id);
        }
        if (step.kind === "if") {
          if (step.then) {
            walk(step.then, [...here, 0]);
          }
          if (step.else) {
            walk(step.else, [...here, 1]);
          }
        }
      }
    };
    walk(steps, []);
    return out;
  }
  function pathStartsWith(a, prefix) {
    if (prefix.length > a.length) {
      return false;
    }
    for (let i = 0; i < prefix.length; i++) {
      if (a[i] !== prefix[i]) {
        return false;
      }
    }
    return true;
  }
  async function mountPixiLayer(host, pluginUrl) {
    await ensurePixiLoaded(pluginUrl);
    const PIXI = window.PIXI;
    if (!PIXI) {
      throw new Error("PixiJS failed to load.");
    }
    const app = new PIXI.Application();
    await app.init({
      background: "transparent",
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      // Disable Pixi's EventSystem entirely — the layer is purely
      // presentational. Without this, Pixi v8 attaches pointer +
      // wheel listeners to the canvas (and document) that swallow
      // drag-to-move, click-to-focus, and double-click-to-maximize
      // gestures the host Desktop window relies on.
      eventMode: "none",
      eventFeatures: {
        move: false,
        globalMove: false,
        click: false,
        wheel: false
      }
    });
    app.stage.eventMode = "none";
    app.stage.interactiveChildren = false;
    const canvas = app.canvas;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none;";
    host.prepend(canvas);
    const bg = new PIXI.Graphics();
    const world = new PIXI.Container();
    const connectors = new PIXI.Graphics();
    const halos = new PIXI.Graphics();
    const overlay = new PIXI.Graphics();
    world.addChild(halos, connectors, overlay);
    app.stage.addChild(bg, world);
    const state2 = {
      app,
      bg,
      connectors,
      halos,
      overlay,
      anchors: [],
      t: 0
    };
    const burstParticles = [];
    const flowPackets = [];
    app.ticker.add((ticker) => {
      state2.t += ticker.deltaMS;
      drawBackground(state2);
      drawHalos(state2);
      drawConnectors(state2);
      drawOverlay(state2, burstParticles, flowPackets, ticker.deltaMS);
    });
    return {
      setAnchors: (anchors) => {
        state2.anchors = anchors;
      },
      resize: (w, h) => {
        app.renderer.resize(Math.max(1, w), Math.max(1, h));
        drawBackground(state2);
        drawHalos(state2);
        drawConnectors(state2);
        drawOverlay(state2, burstParticles, flowPackets, 0);
        app.renderer.render(app.stage);
      },
      setTransform: (zoom, panX, panY) => {
        world.scale.set(zoom);
        world.position.set(panX, panY);
      },
      pulse: (anchorId, kind) => {
        const a = state2.anchors.find((x) => x.id === anchorId);
        if (!a) {
          return;
        }
        let colour = 2257329;
        if (kind === "success") {
          colour = 1096065;
        } else if (kind === "error") {
          colour = 15680580;
        }
        emitBurst(burstParticles, a.x + a.width / 2, a.y + a.height / 2, colour);
      },
      playRun: (sequence) => {
        const centres = [];
        const trigger = state2.anchors.find((a) => a.kind === "trigger");
        if (trigger) {
          centres.push({
            id: trigger.id,
            x: trigger.x + trigger.width / 2,
            y: trigger.y + trigger.height / 2,
            ok: true
          });
        }
        for (const entry of sequence) {
          const a = state2.anchors.find((x) => x.id === entry.id);
          if (a) {
            centres.push({
              id: a.id,
              x: a.x + a.width / 2,
              y: a.y + a.height / 2,
              ok: entry.ok
            });
          }
        }
        for (let i = 1; i < centres.length; i++) {
          flowPackets.push({
            from: centres[i - 1],
            to: centres[i],
            t: 0,
            duration: 240 + i * 80,
            delay: i * 220,
            ok: centres[i].ok,
            emitted: false
          });
        }
      },
      destroy: () => {
        app.destroy(true, { children: true, texture: true });
      }
    };
  }
  let pixiPromise = null;
  function ensurePixiLoaded(pluginUrl) {
    if (window.PIXI) {
      return Promise.resolve();
    }
    if (pixiPromise) {
      return pixiPromise;
    }
    const url = `${pluginUrl}/assets/vendor/pixi.min.js`;
    pixiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(
        `script[src="${url}"]`
      );
      if (existing) {
        if (window.PIXI) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve());
        existing.addEventListener(
          "error",
          () => reject(new Error("pixi.min.js failed to load."))
        );
        return;
      }
      const tag = document.createElement("script");
      tag.src = url;
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error("pixi.min.js failed to load."));
      document.head.append(tag);
    });
    return pixiPromise;
  }
  function drawBackground(state2) {
    const { bg, app, t } = state2;
    bg.clear();
    const w = app.renderer.width / (window.devicePixelRatio || 1);
    const h = app.renderer.height / (window.devicePixelRatio || 1);
    const drift = t / 80 % 24;
    const spacing = 24;
    const rows = Math.ceil(h / spacing) + 2;
    const cols = Math.ceil(w / spacing) + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * spacing - drift;
        const y = r * spacing - drift;
        bg.circle(x, y, 1);
      }
    }
    bg.fill({ color: 0, alpha: 0.04 });
  }
  function drawHalos(state2) {
    const { halos, anchors, t } = state2;
    halos.clear();
    for (const a of anchors) {
      if (a.kind === "add") {
        continue;
      }
      const cx = a.x + a.width / 2;
      const cy = a.y + a.height / 2;
      const radius = Math.max(a.width, a.height) * 0.55;
      const speed = a.kind === "trigger" ? 1.1 : 0.6;
      const pulse = 0.5 + 0.5 * Math.sin(t / 1e3 * speed);
      const alpha = 0.04 + pulse * 0.05;
      const colour = haloColour(a);
      halos.circle(cx, cy, radius * (1 + pulse * 0.06));
      halos.fill({ color: colour, alpha });
    }
  }
  function haloColour(a) {
    if (a.state === "success") {
      return 1096065;
    }
    if (a.state === "error") {
      return 15680580;
    }
    if (a.kind === "trigger") {
      return 2257329;
    }
    if (a.kind === "conditions") {
      return 16096779;
    }
    if (a.kind === "branch-then") {
      return 1096065;
    }
    if (a.kind === "branch-else") {
      return 11032055;
    }
    return 7041664;
  }
  function drawConnectors(state2) {
    const { connectors, anchors, t } = state2;
    connectors.clear();
    const byId = /* @__PURE__ */ new Map();
    for (const a of anchors) {
      byId.set(a.id, a);
    }
    const dashOffset = t / 14 % 16;
    for (const a of anchors) {
      if (a.parentId) {
        const parent = byId.get(a.parentId);
        if (parent) {
          drawBezier(
            connectors,
            parent.x + parent.width / 2,
            parent.y + parent.height,
            a.x + a.width / 2,
            a.y,
            dashOffset,
            edgeColour(a)
          );
        }
      }
      if (a.mergeFromIds) {
        for (const id of a.mergeFromIds) {
          const src = byId.get(id);
          if (!src) {
            continue;
          }
          drawBezier(
            connectors,
            src.x + src.width / 2,
            src.y + src.height,
            a.x + a.width / 2,
            a.y,
            dashOffset,
            10265519
          );
        }
      }
    }
  }
  function edgeColour(a) {
    if (a.kind === "branch-then") {
      return 1096065;
    }
    if (a.kind === "branch-else") {
      return 11032055;
    }
    return 10265519;
  }
  function drawBezier(g, x1, y1, x2, y2, dashOffset, colour) {
    const dy = y2 - y1;
    const cx1 = x1;
    const cy1 = y1 + dy * 0.45;
    const cx2 = x2;
    const cy2 = y2 - dy * 0.45;
    const segments = 24;
    const dash = 8;
    const gap = 8;
    const step = 1 / segments;
    let lastX = x1;
    let lastY = y1;
    let acc = -dashOffset;
    for (let i = 1; i <= segments; i++) {
      const t = i * step;
      const px = cubic(x1, cx1, cx2, x2, t);
      const py = cubic(y1, cy1, cy2, y2, t);
      const segLen = Math.hypot(px - lastX, py - lastY);
      let remaining = segLen;
      let cursorX = lastX;
      let cursorY = lastY;
      const dx = (px - lastX) / segLen || 0;
      const dyn = (py - lastY) / segLen || 0;
      while (remaining > 0) {
        const phase = (acc % (dash + gap) + (dash + gap)) % (dash + gap);
        const inDash = phase < dash;
        const room = inDash ? dash - phase : dash + gap - phase;
        const advance = Math.min(room, remaining);
        if (inDash) {
          const nx = cursorX + dx * advance;
          const ny = cursorY + dyn * advance;
          g.moveTo(cursorX, cursorY);
          g.lineTo(nx, ny);
        }
        cursorX += dx * advance;
        cursorY += dyn * advance;
        acc += advance;
        remaining -= advance;
      }
      lastX = px;
      lastY = py;
    }
    g.stroke({ color: colour, alpha: 0.7, width: 2 });
  }
  function cubic(a, b, c, d, t) {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }
  function drawOverlay(state2, bursts, packets, dt) {
    const { overlay } = state2;
    overlay.clear();
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.t += dt;
      const k = Math.min(1, p.t / p.duration);
      const ease = easeInOut(k);
      const px = p.from.x + (p.to.x - p.from.x) * ease;
      const py = p.from.y + (p.to.y - p.from.y) * ease;
      const colour = p.ok ? 6333946 : 15680580;
      overlay.circle(px, py, 6).fill({ color: colour, alpha: 0.85 });
      overlay.circle(px, py, 12).fill({ color: colour, alpha: 0.25 });
      if (k >= 1 && !p.emitted) {
        emitBurst(bursts, p.to.x, p.to.y, colour);
        p.emitted = true;
      }
      if (k >= 1) {
        packets.splice(i, 1);
      }
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const part = bursts[i];
      part.x += part.vx;
      part.y += part.vy;
      part.vx *= 0.94;
      part.vy *= 0.94;
      part.vy += 0.05;
      part.life += dt;
      const lifeT = Math.min(1, part.life / part.maxLife);
      const alpha = 0.85 * (1 - lifeT);
      const radius = 3 * (1 - lifeT * 0.5);
      overlay.circle(part.x, part.y, radius).fill({ color: part.colour, alpha });
      if (lifeT >= 1) {
        bursts.splice(i, 1);
      }
    }
  }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function emitBurst(out, cx, cy, colour) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      out.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 600 + Math.random() * 200,
        colour
      });
    }
  }
  function pickTrigger(body, catalog) {
    return new Promise((resolve) => {
      const { card, close } = openModal(body, "Pick a trigger");
      card.classList.add("wpdm-routines__modal-card--wide");
      const tabs = el$1("div", { class: "wpdm-routines__tabs" });
      const panel = el$1("div", { class: "wpdm-routines__tab-panel" });
      let activeTab = "common";
      const tabDefs = [
        { id: "common", label: "Common" },
        { id: "by-plugin", label: "By plugin" },
        { id: "hook", label: "Hook search" },
        { id: "broadcast", label: "Broadcast" }
      ];
      const renderTab = () => {
        panel.replaceChildren();
        if (activeTab === "common") {
          renderCommon(panel, catalog.triggers, (t) => {
            close();
            resolve({
              kind: t.kind,
              id: t.id,
              priority: t.priority,
              declared: t
            });
          });
        } else if (activeTab === "by-plugin") {
          renderByPlugin(panel, catalog.triggers, (t) => {
            close();
            resolve({
              kind: t.kind,
              id: t.id,
              priority: t.priority,
              declared: t
            });
          });
        } else if (activeTab === "hook") {
          renderHookSearch(panel, (t) => {
            close();
            resolve(t);
          });
        } else {
          renderBroadcast(panel, (t) => {
            close();
            resolve(t);
          });
        }
      };
      for (const def of tabDefs) {
        const btn = el$1("button", {
          class: "wpdm-routines__tab" + (def.id === activeTab ? " is-active" : ""),
          type: "button"
        });
        btn.textContent = def.label;
        btn.addEventListener("click", () => {
          activeTab = def.id;
          for (const child of tabs.children) {
            child.classList.toggle(
              "is-active",
              child === btn
            );
          }
          renderTab();
        });
        tabs.append(btn);
      }
      card.append(tabs, panel);
      renderTab();
      const cancel = el$1(
        "button",
        { class: "wpdm-routines__btn", type: "button" },
        ["Cancel"]
      );
      cancel.addEventListener("click", () => {
        close();
        resolve(null);
      });
      card.append(cancel);
    });
  }
  function renderCommon(host, triggers, onPick) {
    const hooks = triggers.filter((t) => t.kind === "hook");
    if (hooks.length === 0) {
      host.append(
        el$1("p", { class: "wpdm-routines__empty-text" }, [
          "No declared triggers yet — try Hook search to use any WordPress action by name."
        ])
      );
      return;
    }
    const groups = groupBy(hooks, "group");
    for (const [group, list] of groups) {
      const section = el$1("section", { class: "wpdm-routines__picker-group" });
      const heading = el$1("h4", {});
      heading.textContent = group || "Other";
      section.append(heading);
      for (const t of list) {
        section.append(triggerCard(t, onPick));
      }
      host.append(section);
    }
  }
  function renderByPlugin(host, triggers, onPick) {
    const builtIn = /* @__PURE__ */ new Set(["Content", "Comments", "Users", "Site"]);
    const pluginTriggers = triggers.filter(
      (t) => t.group && !builtIn.has(t.group)
    );
    if (pluginTriggers.length === 0) {
      host.append(
        el$1("p", { class: "wpdm-routines__empty-text" }, [
          "No plugin-declared triggers found. Plugin authors register them with `wp_register_desktop_routine_trigger()`."
        ])
      );
      return;
    }
    renderCommon(host, pluginTriggers, onPick);
  }
  function renderHookSearch(host, onPick) {
    host.append(
      el$1("p", { class: "wpdm-routines__hint" }, [
        "Type any WordPress action name (e.g. `save_post`, `wp_login`). The routine will fire whenever that action runs."
      ])
    );
    const input = el$1("input", {
      class: "wpdm-routines__hook-input",
      type: "text",
      placeholder: "hook_name"
    });
    const priority = el$1("input", {
      class: "wpdm-routines__hook-priority",
      type: "number",
      value: "10"
    });
    const useBtn = el$1(
      "button",
      { class: "wpdm-routines__btn wpdm-routines__btn--primary", type: "button" },
      ["Use this hook"]
    );
    useBtn.addEventListener("click", () => {
      const id = input.value.trim();
      if (!id) {
        input.focus();
        return;
      }
      onPick({
        kind: "hook",
        id,
        priority: parseInt(priority.value, 10) || 10
      });
    });
    const row = el$1("div", { class: "wpdm-routines__hook-row" });
    row.append(
      el$1("label", {}, ["Hook", input]),
      el$1("label", {}, ["Priority", priority]),
      useBtn
    );
    host.append(row);
  }
  function renderBroadcast(host, onPick) {
    host.append(
      el$1("p", { class: "wpdm-routines__hint" }, [
        "Listen for a Desktop Mode broadcast topic — `wp-desktop.<domain>.changed`, `<plugin>/<event>`, etc. Topics fire across windows in real time."
      ])
    );
    const input = el$1("input", {
      class: "wpdm-routines__hook-input",
      type: "text",
      placeholder: "wp-desktop.post.changed"
    });
    const useBtn = el$1(
      "button",
      { class: "wpdm-routines__btn wpdm-routines__btn--primary", type: "button" },
      ["Use this topic"]
    );
    useBtn.addEventListener("click", () => {
      const id = input.value.trim();
      if (!id) {
        input.focus();
        return;
      }
      onPick({ kind: "broadcast", id, priority: 10 });
    });
    const row = el$1("div", { class: "wpdm-routines__hook-row" });
    row.append(el$1("label", {}, ["Topic", input]), useBtn);
    host.append(row);
  }
  function triggerCard(t, onPick) {
    const card = el$1("button", {
      class: "wpdm-routines__picker-card",
      type: "button"
    });
    const icon = el$1("span", {
      class: `dashicons ${t.icon || "dashicons-flag"}`
    });
    icon.setAttribute("aria-hidden", "true");
    const main = el$1("span", { class: "wpdm-routines__picker-card-main" });
    const title = el$1("span", { class: "wpdm-routines__picker-card-title" });
    title.textContent = t.label;
    const meta = el$1("span", { class: "wpdm-routines__picker-card-meta" });
    meta.textContent = `${t.id} • ${Object.keys(t.payload_schema || {}).length} fields`;
    main.append(title, meta);
    card.append(icon, main);
    card.addEventListener("click", () => onPick(t));
    return card;
  }
  function pickStep(body, catalog) {
    return new Promise((resolve) => {
      const { card, close } = openModal(body, "Add a step");
      card.classList.add("wpdm-routines__modal-card--wide");
      const builtIn = [
        { kind: "log", id: "", label: "Log a message" },
        { kind: "email", id: "", label: "Send email" },
        { kind: "http", id: "", label: "HTTP request" },
        { kind: "wait", id: "", label: "Wait" },
        { kind: "set_var", id: "", label: "Set a variable" },
        { kind: "if", id: "", label: "If / then / else" },
        { kind: "stop", id: "", label: "Stop the routine" }
      ];
      const sections = [
        { title: "Built-in steps", steps: builtIn },
        {
          title: "Plugin actions",
          steps: catalog.actions.map((a) => ({
            kind: "action",
            id: a.id,
            label: a.label
          }))
        },
        {
          title: "AI tools",
          steps: catalog.ai_tools.map((t) => ({
            kind: "ai_tool",
            id: t.name,
            label: t.description || t.name
          }))
        }
      ];
      for (const section of sections) {
        if (section.steps.length === 0) {
          continue;
        }
        const wrap = el$1("section", {
          class: "wpdm-routines__picker-group"
        });
        const h = el$1("h4", {});
        h.textContent = section.title;
        wrap.append(h);
        for (const step of section.steps) {
          const stepCard = el$1("button", {
            class: "wpdm-routines__picker-card",
            type: "button"
          });
          const main = el$1("span", {
            class: "wpdm-routines__picker-card-main"
          });
          const title = el$1("span", {
            class: "wpdm-routines__picker-card-title"
          });
          title.textContent = step.label;
          const meta = el$1("span", {
            class: "wpdm-routines__picker-card-meta"
          });
          meta.textContent = step.kind + (step.id ? ` • ${step.id}` : "");
          main.append(title, meta);
          stepCard.append(main);
          stepCard.addEventListener("click", () => {
            close();
            resolve(step);
          });
          wrap.append(stepCard);
        }
        card.append(wrap);
      }
      const cancel = el$1(
        "button",
        { class: "wpdm-routines__btn", type: "button" },
        ["Cancel"]
      );
      cancel.addEventListener("click", () => {
        close();
        resolve(null);
      });
      card.append(cancel);
    });
  }
  function humanizeCondition(cond, catalog, triggerId) {
    if (cond.op === "matches" && typeof cond.right === "string") {
      const words = extractRegexAlternation(cond.right);
      if (words) {
        return `${humanizeOperand(cond.left, catalog, triggerId)} contains any of: ${words.join(", ")}`;
      }
    }
    const left = humanizeOperand(cond.left, catalog, triggerId);
    const verb = OP_VERB[cond.op] ?? cond.op;
    if (cond.op === "truthy" || cond.op === "falsy") {
      return `${left} ${verb}`;
    }
    const right = humanizeOperand(cond.right, catalog, triggerId);
    return `${left} ${verb} ${right}`;
  }
  function humanizeStepSummary(step, catalog, triggerId) {
    const args = step.args ?? {};
    if (step.kind === "if" && step.condition) {
      return humanizeCondition(step.condition, catalog, triggerId);
    }
    if (step.kind === "log") {
      const msg = String(args.message ?? "");
      return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
    }
    if (step.kind === "email") {
      const to = humanizeOperand(args.to, catalog, triggerId) || "admin";
      const subject = String(args.subject ?? "");
      return `to ${to}${subject ? ` — ${subject.slice(0, 50)}` : ""}`;
    }
    if (step.kind === "http") {
      return `${String(args.method ?? "GET").toUpperCase()} ${String(args.url ?? "").slice(0, 60)}`;
    }
    if (step.kind === "wait") {
      return `${String(args.seconds ?? 1)}s`;
    }
    if (step.kind === "set_var") {
      return `${args.name} = ${JSON.stringify(args.value)}`;
    }
    if (step.kind === "stop") {
      return String(args.reason ?? "");
    }
    if (step.kind === "action" || step.kind === "ai_tool") {
      const keys = Object.keys(args);
      if (keys.length === 0) {
        return "";
      }
      const first = keys.slice(0, 3).map(
        (k) => `${k}: ${humanizeOperand(args[k], catalog, triggerId)}`
      ).join(", ");
      return first;
    }
    return "";
  }
  const OP_VERB = {
    eq: "is",
    neq: "is not",
    gt: "is greater than",
    gte: "is at least",
    lt: "is less than",
    lte: "is at most",
    contains: "contains",
    starts_with: "starts with",
    ends_with: "ends with",
    matches: "matches pattern",
    in: "is one of",
    not_in: "is not one of",
    truthy: "is set",
    falsy: "is empty"
  };
  function humanizeOperand(value, catalog, triggerId) {
    if (value === null || value === void 0 || value === "") {
      return "—";
    }
    if (typeof value !== "string") {
      return String(value);
    }
    const placeholder = parseSinglePlaceholder(value);
    if (!placeholder) {
      return value;
    }
    const path = placeholder;
    if (path.startsWith("payload.")) {
      const sub = path.slice("payload.".length);
      return labelForPayloadPath(sub, catalog, triggerId);
    }
    if (path.startsWith("vars.")) {
      return path.slice("vars.".length).replace(/\./g, " › ");
    }
    if (path === "site.url") {
      return "site URL";
    }
    if (path === "site.name") {
      return "site name";
    }
    if (path === "user.id") {
      return "current user ID";
    }
    return path;
  }
  function labelForPayloadPath(path, catalog, triggerId) {
    const trigger = catalog.triggers.find((t) => t.id === triggerId);
    if (trigger) {
      const schema = trigger.payload_schema;
      if (schema && schema[path]?.description) {
        return schema[path].description;
      }
    }
    const segments = path.split(".");
    const last = segments[segments.length - 1] ?? path;
    const friendly = last.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const head = segments.slice(0, -1).map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(" ");
    return (head ? `${head} ${friendly}` : friendly).charAt(0).toUpperCase() + (head ? `${head} ${friendly}` : friendly).slice(1);
  }
  function parseSinglePlaceholder(value) {
    const m = value.match(/^\s*\{\{\s*([a-zA-Z0-9_.\[\]\-]+)\s*\}\}\s*$/);
    return m ? m[1] : null;
  }
  function extractRegexAlternation(regex) {
    const m = regex.match(/^\/\(?([^/\\]+)\)?\/[a-z]*$/);
    if (!m) {
      return null;
    }
    const inner = m[1];
    if (!inner.includes("|")) {
      return null;
    }
    return inner.split("|").map((s) => s.trim()).filter(Boolean);
  }
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 2.5;
  const WHEEL_ZOOM_FACTOR = 15e-4;
  function mountViewport(host) {
    host.classList.add("wpdm-routines__viewport-host");
    const root = el$1("div", { class: "wpdm-routines__viewport" });
    const pixiHost = el$1("div", {
      class: "wpdm-routines__viewport-pixi"
    });
    const content = el$1("div", { class: "wpdm-routines__viewport-content" });
    root.append(pixiHost, content);
    const toolbar = buildToolbar();
    host.append(toolbar.node, root);
    const state2 = { pan: { x: 0, y: 0 }, zoom: 1 };
    const listeners = /* @__PURE__ */ new Set();
    const apply = () => {
      content.style.zoom = String(state2.zoom);
      content.style.transform = `translate(${state2.pan.x / state2.zoom}px, ${state2.pan.y / state2.zoom}px)`;
      toolbar.label.textContent = `${Math.round(state2.zoom * 100)}%`;
      listeners.forEach((cb) => cb());
    };
    const setZoom = (next, focal) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      if (focal) {
        const ratio = clamped / state2.zoom;
        state2.pan.x = focal.x - (focal.x - state2.pan.x) * ratio;
        state2.pan.y = focal.y - (focal.y - state2.pan.y) * ratio;
      }
      state2.zoom = clamped;
      apply();
    };
    const resetView = () => {
      state2.pan = { x: 0, y: 0 };
      state2.zoom = 1;
      apply();
    };
    const fitToContent = () => {
      content.style.zoom = "1";
      content.style.transform = "";
      void content.offsetHeight;
      const cardEls = content.querySelectorAll(
        ".wpdm-routines__card, .wpdm-routines__branch-head, .wpdm-routines__add"
      );
      if (cardEls.length === 0) {
        resetView();
        return;
      }
      const contentRect = content.getBoundingClientRect();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      cardEls.forEach((elNode) => {
        const r = elNode.getBoundingClientRect();
        const x = r.left - contentRect.left;
        const y = r.top - contentRect.top;
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x + r.width > maxX) {
          maxX = x + r.width;
        }
        if (y + r.height > maxY) {
          maxY = y + r.height;
        }
      });
      if (!Number.isFinite(minX)) {
        resetView();
        return;
      }
      const bboxW = maxX - minX;
      const bboxH = maxY - minY;
      const bboxCx = (minX + maxX) / 2;
      const bboxCy = (minY + maxY) / 2;
      const rootRect = root.getBoundingClientRect();
      const margin = 24;
      const fitX = (rootRect.width - margin * 2) / bboxW;
      const fitY = (rootRect.height - margin * 2) / bboxH;
      const fit = Math.max(
        MIN_ZOOM,
        Math.min(1, Math.min(fitX, fitY))
      );
      state2.zoom = fit;
      state2.pan = {
        x: rootRect.width / 2 - fit * bboxCx,
        y: rootRect.height / 2 - fit * bboxCy
      };
      apply();
    };
    root.addEventListener(
      "wheel",
      (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) {
          return;
        }
        ev.preventDefault();
        const rect = root.getBoundingClientRect();
        const focal = {
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top
        };
        const next = state2.zoom * Math.exp(-ev.deltaY * WHEEL_ZOOM_FACTOR);
        setZoom(next, focal);
      },
      { passive: false }
    );
    let dragging = null;
    root.addEventListener("pointerdown", (ev) => {
      const target = ev.target;
      if (target?.closest(
        ".wpdm-routines__card, .wpdm-routines__add, button, input, textarea, select, label, [contenteditable], .wpdm-routines__viewport-toolbar"
      )) {
        return;
      }
      if (ev.button !== 0 && ev.button !== 1) {
        return;
      }
      dragging = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        panX: state2.pan.x,
        panY: state2.pan.y
      };
      root.setPointerCapture(ev.pointerId);
      root.classList.add("is-panning");
    });
    root.addEventListener("pointermove", (ev) => {
      if (!dragging || ev.pointerId !== dragging.pointerId) {
        return;
      }
      state2.pan.x = dragging.panX + (ev.clientX - dragging.startX);
      state2.pan.y = dragging.panY + (ev.clientY - dragging.startY);
      apply();
    });
    const endDrag = (ev) => {
      if (!dragging || ev.pointerId !== dragging.pointerId) {
        return;
      }
      root.releasePointerCapture(ev.pointerId);
      root.classList.remove("is-panning");
      dragging = null;
    };
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);
    root.tabIndex = 0;
    root.addEventListener("keydown", (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) {
        return;
      }
      if (ev.key === "0") {
        ev.preventDefault();
        resetView();
      } else if (ev.key === "+" || ev.key === "=") {
        ev.preventDefault();
        setZoom(state2.zoom * 1.2);
      } else if (ev.key === "-") {
        ev.preventDefault();
        setZoom(state2.zoom / 1.2);
      }
    });
    toolbar.zoomOut.addEventListener("click", () => {
      setZoom(state2.zoom / 1.2);
    });
    toolbar.zoomIn.addEventListener("click", () => {
      setZoom(state2.zoom * 1.2);
    });
    toolbar.reset.addEventListener("click", () => resetView());
    toolbar.fit.addEventListener("click", () => fitToContent());
    apply();
    return {
      root,
      content,
      pixiHost,
      getState: () => state2,
      setZoom,
      resetView,
      fitToContent,
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }
    };
  }
  function buildToolbar() {
    const node = el$1("div", { class: "wpdm-routines__viewport-toolbar" });
    const zoomOut = el$1(
      "button",
      { class: "wpdm-routines__viewport-btn", type: "button", title: "Zoom out" },
      ["−"]
    );
    const label = el$1("span", { class: "wpdm-routines__viewport-label" });
    label.textContent = "100%";
    const zoomIn = el$1(
      "button",
      { class: "wpdm-routines__viewport-btn", type: "button", title: "Zoom in" },
      ["+"]
    );
    const sep = el$1("span", { class: "wpdm-routines__viewport-sep" });
    const fit = el$1(
      "button",
      { class: "wpdm-routines__viewport-btn", type: "button", title: "Fit to screen" },
      ["Fit"]
    );
    const reset = el$1(
      "button",
      { class: "wpdm-routines__viewport-btn", type: "button", title: "Reset view" },
      ["Reset"]
    );
    node.append(zoomOut, label, zoomIn, sep, fit, reset);
    return { node, zoomOut, zoomIn, reset, fit, label };
  }
  async function mountCanvas(host, ctx) {
    host.classList.add("wpdm-routines__canvas-host");
    const stage = el$1("div", { class: "wpdm-routines__canvas-stage" });
    const inspectorSlot = el$1("aside", {
      class: "wpdm-routines__canvas-inspector"
    });
    host.append(stage, inspectorSlot);
    let viewport = null;
    let inspectorTarget = null;
    const setInspector = (target) => {
      inspectorTarget = target;
      paintInspector();
    };
    const closeInspector = () => setInspector(null);
    const paintInspector = () => {
      inspectorSlot.replaceChildren();
      if (!inspectorTarget) {
        inspectorSlot.classList.remove("is-open");
        return;
      }
      inspectorSlot.classList.add("is-open");
      const panel = renderInspector({
        def: ctx.def,
        catalog: ctx.catalog,
        target: inspectorTarget,
        onChange: () => {
          ctx.onChange();
          rerender();
        },
        onClose: closeInspector
      });
      inspectorSlot.append(panel);
    };
    viewport = mountViewport(stage);
    let pixi = null;
    try {
      pixi = await mountPixiLayer(viewport.pixiHost, ctx.pluginUrl);
    } catch (err) {
      const hint = el$1(
        "p",
        { class: "wpdm-routines__pixi-hint" },
        ["Visual effects unavailable (PixiJS failed to load)."]
      );
      host.append(hint);
    }
    const cardLayer = el$1("div", { class: "wpdm-routines__cards" });
    viewport.content.append(cardLayer);
    let trackedAnchors = [];
    const rerender = () => {
      cardLayer.replaceChildren();
      const tracked = [];
      const triggerNode = renderTriggerCard(
        ctx,
        () => setInspector({ kind: "trigger" }),
        async () => {
          const picked = await pickTrigger(host, ctx.catalog);
          if (picked) {
            ctx.def.trigger.kind = picked.kind;
            ctx.def.trigger.id = picked.id;
            ctx.def.trigger.priority = picked.priority;
            ctx.onChange();
            rerender();
          }
        }
      );
      cardLayer.append(triggerNode);
      tracked.push({ id: "trigger", el: triggerNode, kind: "trigger" });
      const condNode = renderConditionsCard(
        ctx,
        () => setInspector({ kind: "condition" })
      );
      cardLayer.append(condNode);
      tracked.push({
        id: "conditions",
        el: condNode,
        kind: "conditions",
        parentId: "trigger"
      });
      const walkResult = walkSteps(
        ctx,
        ctx.def.steps,
        [],
        "conditions",
        cardLayer,
        tracked,
        setInspector,
        () => rerender(),
        host
      );
      const addNode = renderAddStepButton(
        ctx,
        [],
        host,
        () => rerender(),
        "root"
      );
      cardLayer.append(addNode);
      const lastStepEntry = [...tracked].reverse().find((t) => t.kind === "step");
      const trailingHasMerge = !!walkResult.mergeFromIds;
      tracked.push({
        id: "add-root",
        el: addNode,
        kind: "add",
        parentId: trailingHasMerge ? "" : lastStepEntry?.id ?? "conditions",
        mergeFromIds: walkResult.mergeFromIds
      });
      trackedAnchors = tracked;
      pushAnchorsToPixi();
    };
    let lastResizeW = 0;
    let lastResizeH = 0;
    const pushAnchorsToPixi = () => {
      if (!viewport) {
        return;
      }
      const pixiRect = viewport.pixiHost.getBoundingClientRect();
      const anchors = trackedAnchors.map((t) => {
        const r = t.el.getBoundingClientRect();
        return {
          id: t.id,
          x: r.left - pixiRect.left,
          y: r.top - pixiRect.top,
          width: r.width,
          height: r.height,
          kind: t.kind,
          parentId: t.parentId,
          mergeFromIds: t.mergeFromIds,
          state: "idle"
        };
      });
      const w = Math.round(viewport.pixiHost.clientWidth);
      const h = Math.round(viewport.pixiHost.clientHeight);
      if (w !== lastResizeW || h !== lastResizeH) {
        lastResizeW = w;
        lastResizeH = h;
        pixi?.resize(w, h);
      }
      pixi?.setTransform(1, 0, 0);
      pixi?.setAnchors(anchors);
    };
    rerender();
    const applyHighlight = (source) => {
      cardLayer.querySelectorAll(".is-highlighted").forEach((n) => n.classList.remove("is-highlighted"));
      if (!source) {
        return;
      }
      let targetId = null;
      if (source.startsWith("payload")) {
        targetId = "trigger";
      } else if (source.startsWith("vars.")) {
        const stepId = source.slice("vars.".length).split(".")[0];
        const found = trackedAnchors.find(
          (t) => t.kind === "step" && t.el.dataset.stepId === stepId
        );
        targetId = found?.id ?? null;
      }
      if (!targetId) {
        return;
      }
      const tracked = trackedAnchors.find((t) => t.id === targetId);
      if (!tracked) {
        return;
      }
      tracked.el.classList.add("is-highlighted");
      const r = tracked.el.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) {
        tracked.el.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest"
        });
      }
      pixi?.pulse(targetId, "active");
    };
    host.addEventListener("wpdm-routines-highlight", (ev) => {
      const detail = ev.detail;
      applyHighlight(detail?.source ?? null);
    });
    const ro = new ResizeObserver(() => {
      pushAnchorsToPixi();
    });
    ro.observe(stage);
    const offViewportChange = viewport.onChange(() => pushAnchorsToPixi());
    return {
      rerender,
      playRun: (log) => {
        if (!pixi) {
          return;
        }
        const sequence = log.map((entry, i) => ({
          id: entry.id && entry.id !== "" ? `step-${findStepIndexById(ctx.def.steps, entry.id, []) ?? i}` : `step-${i}`,
          ok: entry.ok,
          ms: entry.ms
        }));
        pixi.playRun(sequence);
      },
      destroy: () => {
        ro.disconnect();
        offViewportChange();
        pixi?.destroy();
      }
    };
  }
  function renderTriggerCard(ctx, onInspect, onChange) {
    const declared = ctx.catalog.triggers.find(
      (t) => t.id === ctx.def.trigger.id
    );
    const node = el$1("article", {
      class: "wpdm-routines__card wpdm-routines__card--trigger"
    });
    const head = el$1("header", { class: "wpdm-routines__card-head" });
    const icon = el$1("span", {
      class: `dashicons ${declared?.icon || "dashicons-flag"}`
    });
    icon.setAttribute("aria-hidden", "true");
    const titleWrap = el$1("div", { class: "wpdm-routines__card-title-wrap" });
    const eyebrow = el$1("span", { class: "wpdm-routines__card-eyebrow" });
    eyebrow.textContent = "Trigger";
    const title = el$1("h3", { class: "wpdm-routines__card-title" });
    title.textContent = declared?.label || ctx.def.trigger.id || "Pick a trigger";
    titleWrap.append(eyebrow, title);
    head.append(icon, titleWrap);
    node.append(head);
    const meta = el$1("p", { class: "wpdm-routines__card-meta" });
    meta.textContent = `${ctx.def.trigger.kind} • ${ctx.def.trigger.id || "—"} • priority ${ctx.def.trigger.priority}`;
    node.append(meta);
    const bar = el$1("div", { class: "wpdm-routines__card-bar" });
    const editBtn = el$1(
      "button",
      { class: "wpdm-routines__card-btn", type: "button" },
      ["Inspect"]
    );
    editBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onInspect();
    });
    const changeBtn = el$1(
      "button",
      { class: "wpdm-routines__card-btn", type: "button" },
      ["Change trigger"]
    );
    changeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onChange();
    });
    bar.append(editBtn, changeBtn);
    node.append(bar);
    node.addEventListener("click", onInspect);
    return node;
  }
  function renderConditionsCard(ctx, onInspect) {
    const node = el$1("article", {
      class: "wpdm-routines__card wpdm-routines__card--conditions"
    });
    const hasConditions = ctx.def.conditions.length > 0;
    if (!hasConditions) {
      node.classList.add("is-empty");
    }
    const head = el$1("header", { class: "wpdm-routines__card-head" });
    const icon = el$1("span", { class: "dashicons dashicons-filter" });
    icon.setAttribute("aria-hidden", "true");
    const titleWrap = el$1("div", { class: "wpdm-routines__card-title-wrap" });
    const eyebrow = el$1("span", { class: "wpdm-routines__card-eyebrow" });
    eyebrow.textContent = hasConditions ? "Run only if" : "Filter";
    const title = el$1("h3", { class: "wpdm-routines__card-title" });
    if (!hasConditions) {
      title.textContent = "Runs every time the trigger fires";
    } else if (ctx.def.conditions.length === 1) {
      title.textContent = "this is true";
    } else {
      title.textContent = "all of these are true";
    }
    titleWrap.append(eyebrow, title);
    head.append(icon, titleWrap);
    node.append(head);
    if (hasConditions) {
      const list = el$1("ul", { class: "wpdm-routines__cond-list" });
      for (const cond of ctx.def.conditions) {
        const li = el$1("li", { class: "wpdm-routines__cond-row" });
        const dot = el$1("span", { class: "wpdm-routines__cond-dot" });
        const phrase = el$1("span", { class: "wpdm-routines__cond-phrase" });
        phrase.textContent = humanizeCondition(
          cond,
          ctx.catalog,
          ctx.def.trigger.id
        );
        li.append(dot, phrase);
        list.append(li);
      }
      node.append(list);
    } else {
      const hint = el$1("p", { class: "wpdm-routines__cond-hint" });
      hint.textContent = "Click to add a filter — only let the steps run when conditions match.";
      node.append(hint);
    }
    node.addEventListener("click", onInspect);
    return node;
  }
  function renderAddStepButton(ctx, pathPrefix, host, rerender, variant = "branch") {
    const node = el$1("div", {
      class: "wpdm-routines__add" + (variant === "root" ? " wpdm-routines__add--root" : "")
    });
    const btn = el$1(
      "button",
      {
        class: "wpdm-routines__add-btn" + (variant === "root" ? " wpdm-routines__add-btn--root" : ""),
        type: "button"
      }
    );
    btn.append(variant === "root" ? "+ Step after this" : "+ Add step");
    btn.addEventListener("click", async () => {
      const picked = await pickStep(host.parentElement || host, ctx.catalog);
      if (!picked) {
        return;
      }
      const step = {
        kind: picked.kind,
        id: picked.id,
        args: defaultArgsFor(picked.kind)
      };
      if (picked.kind === "if") {
        step.condition = { left: "", op: "eq", right: "" };
        step.then = [];
        step.else = [];
      }
      const target = resolveStepList(ctx.def.steps, pathPrefix);
      target.push(step);
      ctx.onChange();
      rerender();
    });
    node.append(btn);
    return node;
  }
  function renderStepCard(ctx, step, path, onInspect, rerender) {
    const node = el$1("article", {
      class: `wpdm-routines__card wpdm-routines__card--step wpdm-routines__card--${step.kind}`,
      dataset: { stepId: step.id || "" }
    });
    const head = el$1("header", { class: "wpdm-routines__card-head" });
    const icon = el$1("span", { class: `dashicons ${iconFor(step)}` });
    icon.setAttribute("aria-hidden", "true");
    const titleWrap = el$1("div", { class: "wpdm-routines__card-title-wrap" });
    const eyebrow = el$1("span", { class: "wpdm-routines__card-eyebrow" });
    eyebrow.textContent = step.kind.replace("_", " ");
    const title = el$1("h3", { class: "wpdm-routines__card-title" });
    title.textContent = stepTitle(step, ctx);
    titleWrap.append(eyebrow, title);
    head.append(icon, titleWrap);
    node.append(head);
    const summary = humanizeStepSummary(
      step,
      ctx.catalog,
      ctx.def.trigger.id
    );
    if (summary) {
      const meta = el$1("p", { class: "wpdm-routines__card-meta" });
      meta.textContent = summary;
      node.append(meta);
    }
    const bar = el$1("div", { class: "wpdm-routines__card-bar" });
    const removeBtn = el$1(
      "button",
      {
        class: "wpdm-routines__card-btn wpdm-routines__card-btn--danger",
        type: "button"
      },
      ["Remove"]
    );
    removeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const list = resolveStepList(
        ctx.def.steps,
        path.slice(0, path.length - 1)
      );
      list.splice(path[path.length - 1], 1);
      ctx.onChange();
      rerender();
    });
    bar.append(removeBtn);
    node.append(bar);
    node.addEventListener(
      "click",
      () => onInspect({ kind: "step", stepPath: path, step })
    );
    return node;
  }
  function walkSteps(ctx, steps, pathPrefix, parentAnchor, host, tracked, setInspector, rerender, rootHost) {
    let prev = parentAnchor;
    let pendingMerge;
    steps.forEach((step, i) => {
      const path = [...pathPrefix, i];
      const stepAnchorId = `step-${pathToString(path)}`;
      const node = renderStepCard(ctx, step, path, setInspector, rerender);
      host.append(node);
      tracked.push({
        id: stepAnchorId,
        el: node,
        kind: "step",
        parentId: prev,
        mergeFromIds: pendingMerge
      });
      pendingMerge = void 0;
      prev = stepAnchorId;
      if (step.kind === "if") {
        const branchesRow = el$1("div", {
          class: "wpdm-routines__branches"
        });
        host.append(branchesRow);
        const thenCol = el$1("div", {
          class: "wpdm-routines__branch-col"
        });
        const thenAnchor = `${stepAnchorId}-then`;
        const thenHead = renderBranchHeader("then");
        thenCol.append(thenHead);
        tracked.push({
          id: thenAnchor,
          el: thenHead,
          kind: "branch-then",
          parentId: stepAnchorId
        });
        walkSteps(
          ctx,
          step.then ?? [],
          [...path, -1],
          thenAnchor,
          thenCol,
          tracked,
          setInspector,
          rerender,
          rootHost
        );
        const addThen = renderAddStepButton(
          ctx,
          [...path, -1],
          rootHost,
          rerender
        );
        thenCol.append(addThen);
        const thenTailId = `${stepAnchorId}-then-tail`;
        tracked.push({
          id: thenTailId,
          el: addThen,
          kind: "add"
        });
        const elseCol = el$1("div", {
          class: "wpdm-routines__branch-col"
        });
        const elseAnchor = `${stepAnchorId}-else`;
        const elseHead = renderBranchHeader("else");
        elseCol.append(elseHead);
        tracked.push({
          id: elseAnchor,
          el: elseHead,
          kind: "branch-else",
          parentId: stepAnchorId
        });
        walkSteps(
          ctx,
          step.else ?? [],
          [...path, -2],
          elseAnchor,
          elseCol,
          tracked,
          setInspector,
          rerender,
          rootHost
        );
        const addElse = renderAddStepButton(
          ctx,
          [...path, -2],
          rootHost,
          rerender
        );
        elseCol.append(addElse);
        const elseTailId = `${stepAnchorId}-else-tail`;
        tracked.push({
          id: elseTailId,
          el: addElse,
          kind: "add"
        });
        branchesRow.append(thenCol, elseCol);
        prev = "";
        pendingMerge = [thenTailId, elseTailId];
      }
    });
    return { mergeFromIds: pendingMerge };
  }
  function renderBranchHeader(kind) {
    const node = el$1("div", {
      class: `wpdm-routines__branch-head wpdm-routines__branch-head--${kind}`
    });
    const label = el$1("span", { class: "wpdm-routines__branch-label" });
    label.textContent = kind.toUpperCase();
    node.append(label);
    return node;
  }
  function iconFor(step) {
    switch (step.kind) {
      case "log":
        return "dashicons-text";
      case "email":
        return "dashicons-email";
      case "http":
        return "dashicons-cloud";
      case "wait":
        return "dashicons-clock";
      case "set_var":
        return "dashicons-tag";
      case "stop":
        return "dashicons-no";
      case "if":
        return "dashicons-randomize";
      case "action":
        return "dashicons-controls-play";
      case "ai_tool":
        return "dashicons-superhero";
      case "command":
        return "dashicons-arrow-right-alt";
    }
    return "dashicons-marker";
  }
  function stepTitle(step, ctx) {
    if (step.kind === "action") {
      const a = ctx.catalog.actions.find((x) => x.id === step.id);
      return a?.label || step.id || "Action";
    }
    if (step.kind === "ai_tool") {
      return step.id || "AI tool";
    }
    if (step.kind === "command") {
      return step.id || "Command";
    }
    if (step.kind === "if") {
      return "If / then / else";
    }
    if (step.kind === "log") {
      return "Log message";
    }
    if (step.kind === "email") {
      return "Send email";
    }
    if (step.kind === "http") {
      return "HTTP request";
    }
    if (step.kind === "wait") {
      return "Wait";
    }
    if (step.kind === "set_var") {
      return "Set variable";
    }
    if (step.kind === "stop") {
      return "Stop";
    }
    return step.kind;
  }
  function defaultArgsFor(kind) {
    switch (kind) {
      case "log":
        return { level: "info", message: "" };
      case "email":
        return { to: "", subject: "", body: "" };
      case "http":
        return { method: "GET", url: "", body: "" };
      case "wait":
        return { seconds: 1 };
      case "set_var":
        return { name: "", value: "" };
      case "stop":
        return { reason: "" };
      case "if":
        return {};
    }
    return {};
  }
  function resolveStepList(root, path) {
    let cur = root;
    for (let i = 0; i < path.length; i++) {
      const idx = path[i];
      if (idx === -1) {
        const parent = cur[path[i - 1]];
        cur = parent?.then ?? [];
        continue;
      }
      if (idx === -2) {
        const parent = cur[path[i - 1]];
        cur = parent?.else ?? [];
        continue;
      }
      if (i === path.length - 1) {
        return cur;
      }
    }
    return cur;
  }
  function pathToString(path) {
    return path.map((n) => {
      if (n === -1) {
        return "T";
      }
      if (n === -2) {
        return "E";
      }
      return String(n);
    }).join(".");
  }
  function findStepIndexById(steps, id, path) {
    for (let i = 0; i < steps.length; i++) {
      const here = [...path, i];
      if (steps[i].id === id) {
        return pathToString(here);
      }
      if (steps[i].kind === "if") {
        const inThen = findStepIndexById(
          steps[i].then ?? [],
          id,
          [...here, -1]
        );
        if (inThen) {
          return inThen;
        }
        const inElse = findStepIndexById(
          steps[i].else ?? [],
          id,
          [...here, -2]
        );
        if (inElse) {
          return inElse;
        }
      }
    }
    return null;
  }
  class RestError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  function cfg() {
    const c = window.wpDesktopRoutinesConfig;
    if (!c) {
      throw new RestError(0, "no_config", "Routines config missing.");
    }
    return c;
  }
  async function request(url, init = {}) {
    const c = cfg();
    const headers = new Headers(init.headers);
    headers.set("X-WP-Nonce", c.restNonce);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const j = json;
      throw new RestError(
        res.status,
        j?.code ?? `http_${res.status}`,
        j?.message ?? `Request failed (${res.status})`
      );
    }
    return json;
  }
  function listRoutines() {
    return request(cfg().rootUrl);
  }
  function createRoutine(body) {
    return request(cfg().rootUrl, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  function updateRoutine(id, body) {
    return request(`${cfg().rootUrl}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  }
  function deleteRoutine(id) {
    return request(`${cfg().rootUrl}/${id}`, { method: "DELETE" });
  }
  function testRoutine(id, payload) {
    return request(`${cfg().rootUrl}/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ payload })
    });
  }
  function runRoutine(id, payload) {
    return request(`${cfg().rootUrl}/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ payload })
    });
  }
  function setEnabled(id, enabled) {
    return request(`${cfg().rootUrl}/${id}/enable`, {
      method: "POST",
      body: JSON.stringify({ enabled })
    });
  }
  function listRuns(id, limit = 50) {
    return request(`${cfg().rootUrl}/${id}/runs?limit=${limit}`);
  }
  function fetchCatalog() {
    return request(cfg().catalogUrl);
  }
  function fetchTemplates() {
    return request(cfg().templatesUrl);
  }
  function generateFromPrompt(prompt) {
    return request(`${cfg().rootUrl}/from-prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt })
    });
  }
  function installTemplate(templateId, title) {
    return request(cfg().fromTemplateUrl, {
      method: "POST",
      body: JSON.stringify({ template_id: templateId, title })
    });
  }
  function buildComposer(ctx) {
    const root = el$1("section", { class: "wpdm-routines__composer" });
    const sparkle = el$1("span", { class: "wpdm-routines__composer-icon" });
    sparkle.textContent = "✨";
    const input = el$1("textarea", {
      class: "wpdm-routines__composer-input",
      spellcheck: true,
      placeholder: `Describe the routine you want — e.g. "When a comment with 'casino' arrives, trash it and email me."  (Cmd/Ctrl+Enter to generate)`,
      rows: 2
    });
    const generateBtn = el$1("button", {
      class: "wpdm-routines__composer-btn",
      type: "button"
    });
    generateBtn.textContent = "Generate";
    const status = el$1("span", { class: "wpdm-routines__composer-status" });
    root.append(sparkle, input, generateBtn, status);
    let busy = false;
    const submit = async () => {
      if (busy) {
        return;
      }
      const prompt = input.value.trim();
      if (!prompt) {
        input.focus();
        return;
      }
      busy = true;
      generateBtn.disabled = true;
      generateBtn.textContent = "Generating…";
      status.className = "wpdm-routines__composer-status";
      status.textContent = "";
      root.classList.add("is-busy");
      try {
        const result = await generateFromPrompt(prompt);
        ctx.onGenerated(result.def, {
          model: result.used_model,
          latencyMs: result.latency_ms
        });
        status.className = "wpdm-routines__composer-status is-success";
        status.textContent = `Generated in ${result.latency_ms}ms — review and Save when ready.`;
        input.value = "";
      } catch (err) {
        status.className = "wpdm-routines__composer-status is-error";
        status.textContent = describeError$1(err);
      } finally {
        busy = false;
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate";
        root.classList.remove("is-busy");
      }
    };
    generateBtn.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (ev) => {
      const e = ev;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    });
    return {
      root,
      focus: () => input.focus()
    };
  }
  function describeError$1(err) {
    if (err instanceof RestError) {
      return `${err.code} — ${err.message}`;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
  const ROOT = "[data-wpdm-routines-root]";
  const LIST = "[data-wpdm-routines-list]";
  const MAIN = "[data-wpdm-routines-main]";
  const NEW_BTN = "[data-wpdm-routines-new]";
  const TEMPLATES_BTN = "[data-wpdm-routines-templates]";
  const state = {
    routines: [],
    catalog: null,
    selectedId: null,
    dirty: false
  };
  const EMPTY_DEF = {
    version: 1,
    trigger: { kind: "hook", id: "publish_post", priority: 10 },
    conditions: [],
    steps: [
      {
        kind: "log",
        id: "log_it",
        args: { level: "info", message: "Routine fired: {{payload.post.title}}" }
      }
    ],
    run_as: "author",
    settings: {
      rate_limit: { max: 0, per_seconds: 60 },
      timeout_ms: 5e3,
      stop_on_error: true
    }
  };
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    const { class: className, dataset, ...rest } = props;
    if (className) {
      node.className = className;
    }
    if (dataset) {
      for (const [k, v] of Object.entries(dataset)) {
        node.dataset[k] = v;
      }
    }
    Object.assign(node, rest);
    for (const child of children) {
      node.append(child);
    }
    return node;
  }
  async function loadAll() {
    const [list, catalog] = await Promise.all([
      listRoutines(),
      fetchCatalog()
    ]);
    state.routines = list.items;
    state.catalog = catalog;
  }
  function renderList(body) {
    const list = body.querySelector(LIST);
    if (!list) {
      return;
    }
    list.replaceChildren();
    if (state.routines.length === 0) {
      list.append(
        el("p", { class: "wpdm-routines__list-empty" }, [
          "No routines yet — start from a template."
        ])
      );
      return;
    }
    for (const routine of state.routines) {
      const row = el("button", {
        class: "wpdm-routines__list-item" + (state.selectedId === routine.id ? " is-selected" : ""),
        type: "button",
        dataset: { id: String(routine.id) }
      });
      const title = el("span", { class: "wpdm-routines__list-title" });
      title.textContent = routine.title;
      const meta = el("span", { class: "wpdm-routines__list-meta" });
      meta.textContent = `${routine.def.trigger.id} • ${routine.stats.runs} runs`;
      const dot = el("span", {
        class: "wpdm-routines__list-dot" + (routine.enabled ? " is-on" : "")
      });
      dot.title = routine.enabled ? "Enabled" : "Disabled";
      row.append(dot, title, meta);
      row.addEventListener("click", () => {
        if (state.dirty && !confirm("Discard unsaved changes?")) {
          return;
        }
        state.selectedId = routine.id;
        state.dirty = false;
        renderList(body);
        renderEditor(body);
      });
      list.append(row);
    }
  }
  function renderEditor(body) {
    const main = body.querySelector(MAIN);
    if (!main) {
      return;
    }
    main.replaceChildren();
    const routine = state.selectedId !== null ? state.routines.find((r) => r.id === state.selectedId) : null;
    if (!routine) {
      main.append(
        el("div", { class: "wpdm-routines__empty" }, [
          el(
            "p",
            {},
            ["Pick a routine on the left, or start from a template."]
          )
        ])
      );
      return;
    }
    main.append(buildEditorPanel(body, routine));
  }
  function buildEditorPanel(body, routine) {
    const panel = el("section", { class: "wpdm-routines__editor" });
    let viewMode = "visual";
    let canvasHandle = null;
    const header = el("header", { class: "wpdm-routines__editor-header" });
    const titleField = el("input", {
      class: "wpdm-routines__title-field",
      type: "text",
      value: routine.title
    });
    titleField.addEventListener("input", () => {
      state.dirty = true;
    });
    const enabledLabel = el("label", { class: "wpdm-routines__enable" });
    const enabledInput = el("input", { type: "checkbox" });
    enabledInput.checked = routine.enabled;
    enabledInput.addEventListener("change", async () => {
      try {
        const updated = await setEnabled(routine.id, enabledInput.checked);
        Object.assign(routine, updated);
        renderList(body);
      } catch (err) {
        alert(describeError(err));
        enabledInput.checked = !enabledInput.checked;
      }
    });
    enabledLabel.append(enabledInput, document.createTextNode(" Enabled"));
    const viewToggle = el("div", { class: "wpdm-routines__view-toggle" });
    const visualBtn = el("button", {
      class: "wpdm-routines__view-btn is-active",
      type: "button"
    }, ["Visual"]);
    const jsonBtn = el("button", {
      class: "wpdm-routines__view-btn",
      type: "button"
    }, ["JSON"]);
    viewToggle.append(visualBtn, jsonBtn);
    header.append(titleField, enabledLabel, viewToggle);
    const viewBody = el("div", { class: "wpdm-routines__view-body" });
    const validation = el("p", { class: "wpdm-routines__validation" });
    const out = el("div", { class: "wpdm-routines__output" });
    const jsonEditor = el("textarea", {
      class: "wpdm-routines__json",
      spellcheck: false
    });
    jsonEditor.value = JSON.stringify(routine.def, null, 2);
    jsonEditor.addEventListener("input", () => {
      state.dirty = true;
    });
    const renderView = () => {
      viewBody.replaceChildren();
      canvasHandle?.destroy();
      canvasHandle = null;
      if (viewMode === "visual") {
        void mountCanvas(viewBody, {
          def: routine.def,
          catalog: state.catalog,
          pluginUrl: cfg().pluginUrl,
          onChange: () => {
            state.dirty = true;
            jsonEditor.value = JSON.stringify(routine.def, null, 2);
          },
          onTest: async () => null
          // canvas is presentational; test happens via the action bar
        }).then((h) => {
          canvasHandle = h;
        });
      } else {
        const wrap = el("div", { class: "wpdm-routines__json-wrap" });
        wrap.append(
          el(
            "label",
            { class: "wpdm-routines__json-label" },
            ["Definition (JSON)"]
          ),
          jsonEditor
        );
        viewBody.append(wrap);
      }
    };
    visualBtn.addEventListener("click", () => {
      if (viewMode === "visual") {
        return;
      }
      const parsed = parseJson(jsonEditor.value, validation);
      if (!parsed) {
        return;
      }
      routine.def = parsed;
      viewMode = "visual";
      visualBtn.classList.add("is-active");
      jsonBtn.classList.remove("is-active");
      renderView();
    });
    jsonBtn.addEventListener("click", () => {
      if (viewMode === "json") {
        return;
      }
      jsonEditor.value = JSON.stringify(routine.def, null, 2);
      viewMode = "json";
      jsonBtn.classList.add("is-active");
      visualBtn.classList.remove("is-active");
      renderView();
    });
    const bar = el("div", { class: "wpdm-routines__action-bar" });
    const saveBtn = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--primary",
      type: "button"
    }, ["Save"]);
    const testBtn = el("button", {
      class: "wpdm-routines__btn",
      type: "button"
    }, ["Test (dry-run)"]);
    const runBtn = el("button", {
      class: "wpdm-routines__btn",
      type: "button"
    }, ["Run now"]);
    const deleteBtn = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--danger",
      type: "button"
    }, ["Delete"]);
    bar.append(saveBtn, testBtn, runBtn, deleteBtn);
    const history = el("section", { class: "wpdm-routines__history" });
    const historyTitle = el("h4", {}, ["Recent runs"]);
    const historyList = el("div", { class: "wpdm-routines__history-list" });
    history.append(historyTitle, historyList);
    const syncDefFromEditor = () => {
      if (viewMode === "json") {
        const parsed = parseJson(jsonEditor.value, validation);
        if (!parsed) {
          return false;
        }
        routine.def = parsed;
      }
      return true;
    };
    saveBtn.addEventListener("click", async () => {
      if (!syncDefFromEditor()) {
        return;
      }
      try {
        const updated = await updateRoutine(routine.id, {
          title: titleField.value,
          def: routine.def
        });
        Object.assign(routine, updated);
        state.dirty = false;
        validation.textContent = "Saved.";
        validation.className = "wpdm-routines__validation is-success";
        renderList(body);
      } catch (err) {
        validation.textContent = describeError(err);
        validation.className = "wpdm-routines__validation is-error";
      }
    });
    testBtn.addEventListener("click", async () => {
      if (!syncDefFromEditor()) {
        return;
      }
      const trig = state.catalog?.triggers.find(
        (t) => t.id === routine.def.trigger.id
      );
      const payload = trig?.sample_payload ?? {};
      try {
        await updateRoutine(routine.id, {
          title: titleField.value,
          def: routine.def
        });
        const result = await testRoutine(routine.id, payload);
        renderRunResult(out, result);
        canvasHandle?.playRun(result.steps_log);
      } catch (err) {
        out.textContent = describeError(err);
      }
    });
    runBtn.addEventListener("click", async () => {
      if (!confirm(
        "Run the routine for real? Side effects (emails, HTTP) will execute."
      )) {
        return;
      }
      const trig = state.catalog?.triggers.find(
        (t) => t.id === routine.def.trigger.id
      );
      const payload = trig?.sample_payload ?? {};
      try {
        const result = await runRoutine(routine.id, payload);
        renderRunResult(out, result);
        canvasHandle?.playRun(result.steps_log);
        void refreshHistory(routine.id, historyList);
      } catch (err) {
        out.textContent = describeError(err);
      }
    });
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete "${routine.title}"? This cannot be undone.`)) {
        return;
      }
      try {
        await deleteRoutine(routine.id);
        state.routines = state.routines.filter(
          (r) => r.id !== routine.id
        );
        state.selectedId = null;
        state.dirty = false;
        renderList(body);
        renderEditor(body);
      } catch (err) {
        alert(describeError(err));
      }
    });
    const tabs = el("div", { class: "wpdm-routines__editor-tabs", role: "tablist" });
    const designerTab = el("button", {
      class: "wpdm-routines__editor-tab is-active",
      type: "button",
      role: "tab"
    }, ["Designer"]);
    const runsTab = el("button", {
      class: "wpdm-routines__editor-tab",
      type: "button",
      role: "tab"
    }, ["Recent runs"]);
    tabs.append(designerTab, runsTab);
    const designerPane = el("div", { class: "wpdm-routines__pane" });
    const runsPane = el("div", { class: "wpdm-routines__pane" });
    runsPane.hidden = true;
    const composer = buildComposer({
      onGenerated: (def) => {
        routine.def = def;
        state.dirty = true;
        renderView();
        jsonEditor.value = JSON.stringify(routine.def, null, 2);
        validation.className = "wpdm-routines__validation is-success";
        validation.textContent = "AI generated a routine — review on the canvas, then Save.";
      }
    });
    designerPane.append(composer.root, viewBody);
    runsPane.append(history);
    panel.addEventListener("keydown", (ev) => {
      const e = ev;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        designerTab.click();
        composer.focus();
      }
    });
    const setTab = (next) => {
      designerTab.classList.toggle("is-active", next === "designer");
      runsTab.classList.toggle("is-active", next === "runs");
      designerPane.hidden = next !== "designer";
      runsPane.hidden = next !== "runs";
    };
    designerTab.addEventListener("click", () => setTab("designer"));
    runsTab.addEventListener("click", () => {
      setTab("runs");
      void refreshHistory(routine.id, historyList);
    });
    panel.append(header, tabs, designerPane, runsPane, validation, bar, out);
    renderView();
    void refreshHistory(routine.id, historyList);
    return panel;
  }
  function parseJson(source, statusEl) {
    try {
      const parsed = JSON.parse(source);
      statusEl.textContent = "";
      statusEl.className = "wpdm-routines__validation";
      return parsed;
    } catch (err) {
      statusEl.textContent = `Invalid JSON: ${err.message}`;
      statusEl.className = "wpdm-routines__validation is-error";
      return null;
    }
  }
  function describeError(err) {
    if (err instanceof RestError) {
      return `${err.code} (${err.status}): ${err.message}`;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
  function renderRunResult(out, result) {
    out.replaceChildren();
    const head = el(
      "div",
      {
        class: `wpdm-routines__result wpdm-routines__result--${result.status}`
      },
      [`${result.status.toUpperCase()} in ${result.duration_ms}ms`]
    );
    out.append(head);
    if (result.error) {
      const err = el("pre", { class: "wpdm-routines__error" });
      err.textContent = result.error;
      out.append(err);
    }
    const log = el("ol", { class: "wpdm-routines__log" });
    for (const entry of result.steps_log) {
      const li = el("li", {
        class: entry.ok ? "wpdm-routines__log-ok" : "wpdm-routines__log-fail"
      });
      li.textContent = `${entry.kind} ${entry.id || ""} — ${entry.ms}ms${entry.error ? ` — ${entry.error}` : ""}${entry.branch ? ` [${entry.branch}]` : ""}`;
      log.append(li);
    }
    out.append(log);
  }
  async function refreshHistory(routineId, listNode) {
    listNode.replaceChildren(document.createTextNode("Loading…"));
    try {
      const { items } = await listRuns(routineId, 20);
      listNode.replaceChildren();
      if (items.length === 0) {
        listNode.append(
          el("p", { class: "wpdm-routines__history-empty" }, [
            "No runs yet."
          ])
        );
        return;
      }
      for (const r of items) {
        const row = el("div", {
          class: `wpdm-routines__history-row wpdm-routines__history-row--${r.status}`
        });
        row.textContent = `${r.started_at} — ${r.status} — ${r.duration_ms}ms${r.error ? ` — ${r.error}` : ""}`;
        listNode.append(row);
      }
    } catch (err) {
      listNode.replaceChildren(
        document.createTextNode(describeError(err))
      );
    }
  }
  async function openTemplatesPicker(body) {
    const dialog = el("div", { class: "wpdm-routines__modal" });
    const card = el("div", { class: "wpdm-routines__modal-card" });
    card.append(
      el("h3", {}, ["Browse templates"]),
      el(
        "p",
        { class: "wpdm-routines__modal-hint" },
        [
          "Each template installs as a disabled routine — review the JSON, then enable when you’re ready."
        ]
      )
    );
    const list = el("div", { class: "wpdm-routines__template-list" });
    card.append(list);
    const close = el("button", { class: "wpdm-routines__btn", type: "button" }, ["Close"]);
    close.addEventListener("click", () => dialog.remove());
    card.append(close);
    dialog.append(card);
    body.append(dialog);
    try {
      const { items } = await fetchTemplates();
      if (items.length === 0) {
        list.textContent = "No templates registered yet.";
        return;
      }
      for (const tpl of items) {
        list.append(renderTemplateCard(body, tpl, dialog));
      }
    } catch (err) {
      list.textContent = describeError(err);
    }
  }
  function renderTemplateCard(body, tpl, dialog) {
    const card = el("article", { class: "wpdm-routines__template-card" });
    const title = el("h4", {});
    title.textContent = tpl.title;
    const desc = el("p", {});
    desc.textContent = tpl.description;
    const meta = el("p", { class: "wpdm-routines__template-meta" });
    meta.textContent = `${tpl.group} • trigger: ${tpl.def.trigger.id}`;
    const install = el("button", {
      class: "wpdm-routines__btn wpdm-routines__btn--primary",
      type: "button"
    }, ["Install"]);
    install.addEventListener("click", async () => {
      try {
        const created = await installTemplate(tpl.id);
        state.routines = [created, ...state.routines];
        state.selectedId = created.id;
        renderList(body);
        renderEditor(body);
        dialog.remove();
      } catch (err) {
        alert(describeError(err));
      }
    });
    card.append(title, meta, desc, install);
    return card;
  }
  async function createBlankRoutine(body) {
    try {
      const created = await createRoutine({
        title: "Untitled routine",
        enabled: false,
        def: structuredClone(EMPTY_DEF)
      });
      state.routines = [created, ...state.routines];
      state.selectedId = created.id;
      renderList(body);
      renderEditor(body);
    } catch (err) {
      alert(describeError(err));
    }
  }
  async function renderRoutinesWindow(body) {
    const root = body.querySelector(ROOT);
    if (!root) {
      return;
    }
    const newBtn = body.querySelector(NEW_BTN);
    newBtn?.addEventListener("click", () => createBlankRoutine(body));
    const tplBtn = body.querySelector(TEMPLATES_BTN);
    tplBtn?.addEventListener("click", () => openTemplatesPicker(body));
    try {
      await loadAll();
    } catch (err) {
      const main = body.querySelector(MAIN);
      if (main) {
        main.replaceChildren();
        main.append(
          el("p", { class: "wpdm-routines__validation is-error" }, [
            describeError(err)
          ])
        );
      }
      return;
    }
    if (state.selectedId === null && state.routines.length > 0) {
      state.selectedId = state.routines[0].id;
    }
    renderList(body);
    renderEditor(body);
  }
  window.wpDesktopNativeWindows = window.wpDesktopNativeWindows ?? {};
  window.wpDesktopNativeWindows["wpdm-routines"] = (body) => {
    void renderRoutinesWindow(body);
  };
})();
