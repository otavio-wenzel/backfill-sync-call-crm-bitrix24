/* =========================
 * core/bx24-utils.js (CORRIGIDO E COMPLETO)
 * - Paginação robusta (start/next) compatível com REST do Bitrix24
 * - Timeout por página + retry com backoff
 * - Compatível com métodos que retornam:
 *    a) res.more()/res.next() (SDK)
 *    b) answer.next / answer.total / answer.result / answer.result_next (REST)
 * ========================= */
(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;

  function callMethod(method, params) {
    return new Promise((resolve, reject) => {
      BX24.callMethod(method, params || {}, function (res) {
        if (res.error && res.error()) return reject(res.error());
        resolve(res);
      });
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function errMsg(e) {
    return (e && e.message) ? e.message : String(e || "");
  }

  function isTimeoutErr(e) {
    return errMsg(e) === "TIMEOUT";
  }

  async function callWithTimeout(method, params, timeoutMs) {
    return await Promise.race([
      callMethod(method, params),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs))
    ]);
  }

  function getAnswer(res) {
    // SDK: res.answer costuma existir
    // Às vezes res tem diretamente .answer, às vezes não.
    return (res && res.answer) ? res.answer : null;
  }

  function extractRowsFromRes(res) {
    // SDK: res.data() (já lista de rows)
    // REST/answer: answer.result ou answer.result.items etc.
    try {
      if (res && typeof res.data === "function") {
        const d = res.data();
        return Array.isArray(d) ? d : (d ? [d] : []);
      }
    } catch {}

    const ans = getAnswer(res);
    if (!ans) return [];

    // Alguns métodos retornam direto em answer.result (array)
    if (Array.isArray(ans.result)) return ans.result;

    // crm.item.list -> answer.result.items
    if (ans.result && Array.isArray(ans.result.items)) return ans.result.items;

    // crm.activity.list -> answer.result (array) normalmente, mas mantemos fallback
    if (ans.result && typeof ans.result === "object") {
      // voximplant.statistic.get às vezes vem em result (array)
      if (Array.isArray(ans.result)) return ans.result;
      // Alguns endpoints podem devolver {items:[]}
      if (Array.isArray(ans.result.items)) return ans.result.items;
    }

    return [];
  }

  function extractNextFromRes(res) {
    // SDK preferencial: res.more()/res.next()
    try {
      if (res && typeof res.more === "function" && res.more()) {
        // No modo SDK, quem controla o cursor é res.next(); a gente não usa aqui.
        return { sdkMore: true, next: null };
      }
    } catch {}

    const ans = getAnswer(res);
    if (!ans) return { sdkMore: false, next: null };

    // Padrão REST: answer.next (offset próximo)
    if (typeof ans.next !== "undefined" && ans.next !== null) {
      return { sdkMore: false, next: ans.next };
    }

    // Alguns retornos vêm como result_next
    if (typeof ans.result_next !== "undefined" && ans.result_next !== null) {
      return { sdkMore: false, next: ans.result_next };
    }

    return { sdkMore: false, next: null };
  }

  /**
   * listAll(method, params, opts)
   * - Implementa paginação por offset "start" (REST) e também tolera SDK/res.next se aparecer.
   * - IMPORTANTE: NUNCA usa res.next() aqui, pois muitos erros “Script error.” foram por cruzar contexts
   *   e por timeouts; essa versão é totalmente baseada em novas chamadas com start.
   */
  async function listAll(method, params, opts) {
    const timeoutPerPageMs = (opts && opts.timeoutPerPageMs) || 120000;
    const maxTotalMs       = (opts && opts.maxTotalMs) || 900000;
    const pageDelayMs      = (opts && opts.pageDelayMs) || 150;
    const maxRetries       = (opts && opts.maxRetries) || 3;
    const pageSizeHint     = (opts && opts.pageSizeHint) || null; // opcional

    const started = Date.now();
    const out = [];

    let start = 0;

    while (true) {
      if ((Date.now() - started) > maxTotalMs) throw new Error("TIMEOUT");

      let res = null;
      let attempt = 0;

      while (true) {
        try {
          const pageParams = Object.assign({}, params || {}, { start });

          // alguns métodos aceitam "LIMIT" ou "limit" — se você quiser, injete via opts
          if (pageSizeHint && typeof pageParams.LIMIT === "undefined" && typeof pageParams.limit === "undefined") {
            pageParams.LIMIT = pageSizeHint;
          }

          res = await callWithTimeout(method, pageParams, timeoutPerPageMs);
          break;
        } catch (e) {
          if (isTimeoutErr(e) && attempt < maxRetries) {
            attempt++;
            log && log.warn && log.warn("TIMEOUT_PAGE_RETRY", { method, start, attempt, timeoutPerPageMs });
            await sleep(400 * attempt);
            continue;
          }
          throw e;
        }
      }

      const rows = extractRowsFromRes(res);
      if (rows.length) out.push(...rows);

      const nxt = extractNextFromRes(res);

      // Se por algum motivo o SDK indicar “more”, mas sem next,
      // a estratégia mais segura aqui é PARAR (evita loop infinito).
      if (nxt.sdkMore) {
        // tentamos achar answer.next mesmo assim
        const ans = getAnswer(res);
        const safeNext = ans && typeof ans.next !== "undefined" ? ans.next : null;
        if (safeNext === null || typeof safeNext === "undefined") break;
        start = safeNext;
        await sleep(pageDelayMs);
        continue;
      }

      // REST: se não vier next, acabou
      if (nxt.next === null || typeof nxt.next === "undefined") break;

      // Proteção: se next não muda, evita loop
      if (String(nxt.next) === String(start)) break;

      start = nxt.next;
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
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }

  function nowIsoFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }

  function splitIntoChunks(dateFromIso, dateToIso, chunkDays) {
    const out = [];
    const step = Math.max(1, parseInt(chunkDays, 10) || 7);

    const end = new Date(dateToIso);
    end.setHours(23,59,59,0);

    let cur = new Date(dateFromIso);
    cur.setHours(0,0,0,0);

    while (cur <= end) {
      const cStart = new Date(cur);
      const cEnd = new Date(cur);
      cEnd.setDate(cEnd.getDate() + (step - 1));
      cEnd.setHours(23,59,59,0);
      if (cEnd > end) cEnd.setTime(end.getTime());

      out.push({
        dateFrom: nowIsoFromDate(cStart),
        dateTo:   nowIsoFromDate(cEnd)
      });

      cur.setDate(cur.getDate() + step);
      cur.setHours(0,0,0,0);
    }

    return out;
  }

  App.core.BX24 = {
    callMethod,
    listAll,
    isoLocalStartEndFromDates,
    isoToSpace,
    normalizePhone,
    parseDateToTs,
    nowIso,
    nowIsoFromDate,
    splitIntoChunks
  };
})(window);