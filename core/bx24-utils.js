(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;

  function callMethod(method, params) {
    return new Promise((resolve, reject) => {
      try {
        BX24.callMethod(method, params || {}, function (res) {
          try {
            if (res && res.error && res.error()) return reject(new Error(res.error()));
            resolve(res);
          } catch (cbErr) {
            reject(cbErr);
          }
        });
      } catch (syncErr) {
        reject(syncErr);
      }
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isTimeoutErr(e) {
    const m = (e && e.message) ? e.message : String(e || "");
    if (!m) return false;
    if (m === "TIMEOUT") return true;
    if (m.startsWith("TIMEOUT_CALLMETHOD:")) return true;
    if (m.toUpperCase().includes("TIMEOUT")) return true;
    if (m.includes("504")) return true;
    if (m.includes("Gateway Timeout")) return true;
    return false;
  }

  async function callMethodWithTimeout(method, params, timeoutMs = 60000) {
    return await Promise.race([
      callMethod(method, params || {}),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT_CALLMETHOD:" + method)), timeoutMs)
      )
    ]);
  }

  function extractItemsFromData(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.items && Array.isArray(data.items)) return data.items;
    if (data.result && Array.isArray(data.result)) return data.result;
    if (data.result && data.result.items && Array.isArray(data.result.items)) return data.result.items;
    if (data.result && data.result.result && Array.isArray(data.result.result)) return data.result.result;
    return [];
  }

  function extractNext(res) {
    try {
      if (res && typeof res.more === "function" && typeof res.next === "function") {
        return res.more() ? res.next() : null;
      }
    } catch (_) {}

    let ans = null;
    try {
      ans = (res && typeof res.answer === "function") ? res.answer() : (res ? res.answer : null);
    } catch (_) {
      ans = (res ? res.answer : null);
    }

    if (!ans) return null;
    if (typeof ans.next !== "undefined") return ans.next;
    if (ans.result && typeof ans.result.next !== "undefined") return ans.result.next;
    if (ans.result && ans.result.result && typeof ans.result.result.next !== "undefined") return ans.result.result.next;
    return null;
  }

  async function listAll(method, params, opts) {
    let timeoutPerPageMs = (opts && opts.timeoutPerPageMs) || 120000;
    const maxTotalMs     = (opts && opts.maxTotalMs) || 900000;
    const pageDelayMs    = (opts && opts.pageDelayMs) || 150;
    const maxRetries     = (opts && opts.maxRetries) || 3;

    if (String(method).startsWith("voximplant.") && timeoutPerPageMs < 180000) {
      timeoutPerPageMs = 180000;
    }

    const started = Date.now();
    const out = [];
    let start = (params && typeof params.start !== "undefined") ? params.start : 0;

    while (true) {
      if ((Date.now() - started) > maxTotalMs) throw new Error("TIMEOUT");

      let res = null;
      let attempt = 0;

      while (true) {
        try {
          const pageParams = Object.assign({}, params || {}, { start });
          res = await callMethodWithTimeout(method, pageParams, timeoutPerPageMs);
          break;
        } catch (e) {
          if (isTimeoutErr(e) && attempt < maxRetries) {
            attempt++;
            log?.warn?.("TIMEOUT_PAGE_RETRY", { method, start, attempt, timeoutPerPageMs });
            await sleep(500 * attempt);
            continue;
          }
          const msg = (e && e.message) ? e.message : String(e || "");
          const err = new Error(msg);
          err.meta = { method, start, attempt, timeoutPerPageMs };
          throw err;
        }
      }

      const data = (typeof res.data === "function") ? res.data() : res.data;
      const items = extractItemsFromData(data);
      if (items.length) out.push(...items);

      const next = extractNext(res);
      if (next === null || typeof next === "undefined") break;

      start = next;
      await sleep(pageDelayMs);
    }

    return out;
  }

  function isoLocalStartEndFromDates(dateFromYYYYMMDD, dateToYYYYMMDD) {
    const df = dateFromYYYYMMDD + "T00:00:00";
    const dt = dateToYYYYMMDD + "T23:59:59";
    return { dateFromIso: df, dateToIso: dt };
  }

  function isoToSpace(dt) {
    return (dt && typeof dt === "string") ? dt.replace("T", " ") : dt;
  }

  function normalizePhone(raw) {
    if (!raw) return "";
    return String(raw).trim().replace(/[^\d+]/g, "");
  }

  function parseDateToTs(dt) {
    if (!dt) return 0;
    return new Date(String(dt).replace(" ", "T")).getTime();
  }

  function nowIso() {
    return nowIsoFromDate(new Date());
  }

  function nowIsoFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }

  function splitIntoChunks(dateFromIso, dateToIso, chunkDays) {
    const out = [];
    const step = Math.max(1, parseInt(chunkDays, 10) || 7);

    const end = new Date(dateToIso);
    end.setHours(23, 59, 59, 0);

    let cur = new Date(dateFromIso);
    cur.setHours(0, 0, 0, 0);

    while (cur <= end) {
      const cStart = new Date(cur);
      const cEnd = new Date(cur);
      cEnd.setDate(cEnd.getDate() + (step - 1));
      cEnd.setHours(23, 59, 59, 0);
      if (cEnd > end) cEnd.setTime(end.getTime());

      out.push({ dateFrom: nowIsoFromDate(cStart), dateTo: nowIsoFromDate(cEnd) });

      cur.setDate(cur.getDate() + step);
      cur.setHours(0, 0, 0, 0);
    }

    return out;
  }

  App.core = App.core || {};
  App.core.BX24 = {
    callMethod,
    callMethodWithTimeout,
    listAll,
    extractItemsFromData,
    isoLocalStartEndFromDates,
    isoToSpace,
    normalizePhone,
    parseDateToTs,
    nowIso,
    nowIsoFromDate,
    splitIntoChunks
  };
})(window);