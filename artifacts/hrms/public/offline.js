/*
 * Offline page behaviour (public/offline.html). Progressive enhancement only:
 * the Retry link works without this file.
 *
 * - Retry reloads the page the person was trying to open.
 * - When the browser reports the connection is back, the page reloads itself
 *   so the application resumes without another tap.
 */
(function () {
  var status = document.getElementById('status');
  var retry = document.getElementById('retry');

  function reload() {
    if (status) status.textContent = 'Reconnecting…';
    window.location.reload();
  }

  if (retry) {
    retry.addEventListener('click', function (event) {
      event.preventDefault();
      if (navigator.onLine === false) {
        if (status) status.textContent = 'Still offline. Check your connection and try again.';
        return;
      }
      reload();
    });
  }

  window.addEventListener('online', reload);
})();
