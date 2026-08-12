(function () {
  if (window.__adcAnalyticsLoaded) return;
  window.__adcAnalyticsLoaded = true;

  function track() {
    if (location.pathname.startsWith("/admin")) return;

    var payload = JSON.stringify({
      path: location.pathname,
      title: document.title,
      referrer: document.referrer
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics/track", new Blob([payload], { type: "application/json" }));
      return;
    }

    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", track);
  } else {
    track();
  }
})();
