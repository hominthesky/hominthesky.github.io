"use strict";

(() => {
  const sensitiveQueryNames = new Set(["password", "pass", "pwd"]);
  const currentUrl = new URL(window.location.href);
  let changed = false;

  for (const name of [...currentUrl.searchParams.keys()]) {
    if (!sensitiveQueryNames.has(name.toLowerCase())) continue;
    currentUrl.searchParams.delete(name);
    changed = true;
  }

  if (changed) {
    const sanitizedUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState(window.history.state, "", sanitizedUrl);
  }

  // Bind before the deferred application module. If that module fails to load,
  // the browser must not fall back to a native GET form submission.
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target?.id === "unlock-form") event.preventDefault();
    },
    true,
  );
})();
