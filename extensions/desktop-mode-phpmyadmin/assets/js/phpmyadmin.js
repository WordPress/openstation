(function() {
  "use strict";
  const ROOT_SELECTOR = "[data-osc-phpmyadmin-root]";
  function getConfig() {
    const cfg = window.openStationPhpMyAdminConfig;
    if (!cfg || typeof cfg.vendorUrl !== "string" || cfg.vendorUrl === "") {
      return null;
    }
    return cfg;
  }
  function renderError(root, message) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "osc-phpmyadmin__error";
    wrap.textContent = message;
    root.appendChild(wrap);
  }
  function renderPhpMyAdmin(body) {
    const root = body.querySelector(ROOT_SELECTOR);
    if (!root) {
      return;
    }
    const cfg = getConfig();
    if (!cfg) {
      renderError(
        root,
        "phpMyAdmin is not available — bundle missing or configuration not loaded."
      );
      return;
    }

    root.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;";
    root.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.className = "osc-phpmyadmin__frame";

    iframe.style.cssText = "flex:1 1 auto;width:100%;height:100%;border:0;display:block;";
    iframe.src = cfg.vendorUrl + "/index.php?_=" + Date.now();
    iframe.title = "phpMyAdmin";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
    );
    root.appendChild(iframe);
  }
  const registry = window.openStationNativeWindows ?? (window.openStationNativeWindows = {});
  registry["wpdc-phpmyadmin"] = (body) => {
    renderPhpMyAdmin(body);
  };

  const skeletons = document.querySelectorAll("[data-osc-phpmyadmin-loading]");
  skeletons.forEach((skel) => {
    const body = skel.closest(".os-window__body");
    if (body) {
      renderPhpMyAdmin(body);
    }
  });
})();
