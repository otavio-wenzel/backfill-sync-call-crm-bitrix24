(function (global) {
  const App = global.App = global.App || {};
  App.state = App.state || {};

  App.state.logs = App.state.logs || [];

  function ts() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${hh}:${mm}:${ss}`;
  }

  function fmt(level, msg, meta) {
    let line = `[${ts()}] ${level} ${msg}`;
    if (meta !== undefined) {
      try { line += " " + JSON.stringify(meta); }
      catch { line += " " + String(meta); }
    }
    return line;
  }

  function push(level, msg, meta) {
    const line = fmt(level, msg, meta);
    App.state.logs.push(line);
    if (App.state.logs.length > 5000) App.state.logs.shift();
    console.log(line);
    try {
      const el = document.getElementById('log-view');
      if (el) {
        el.textContent = App.state.logs.join("\n");
        el.scrollTop = el.scrollHeight;
      }
    } catch {}
  }

  App.log = {
    info: (m, meta) => push("INFO", m, meta),
    warn: (m, meta) => push("WARN", m, meta),
    error: (m, meta) => push("ERROR", m, meta),
    debug: (m, meta) => push("DEBUG", m, meta),
    clear: () => { App.state.logs = []; const el = document.getElementById('log-view'); if (el) el.textContent = ""; }
  };

  window.addEventListener('error', function (ev) {
    const payload = {
      message: ev && ev.message ? ev.message : "unknown",
      filename: ev && ev.filename ? ev.filename : null,
      lineno: ev && ev.lineno ? ev.lineno : null,
      colno: ev && ev.colno ? ev.colno : null,
      stack: ev && ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 2000) : null
    };
    App.log.error("JS_ERROR", payload);
  });

  window.addEventListener('unhandledrejection', function (ev) {
    let reason = ev && ev.reason ? ev.reason : "unknown";
    const payload = {
      reason: (reason && reason.message) ? reason.message : String(reason),
      stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : null
    };
    App.log.error("UNHANDLED_REJECTION", payload);
  });

})(window);