(function (global) {
  const App = global.App = global.App || {};
  App.svc = App.svc || {};

  const BX = App.core.BX24;
  const log = App.log;

  function safeStr(v) { return (v === null || v === undefined) ? "" : String(v); }

  function activityTs(a) {
    const dt = a.START_TIME || a.CREATED || a.LAST_UPDATED || a.END_TIME || "";
    return BX.parseDateToTs(dt);
  }

  function normalizeActivityPhone(a) {
    const comm0 =
      a.COMMUNICATIONS && Array.isArray(a.COMMUNICATIONS) && a.COMMUNICATIONS[0]
        ? a.COMMUNICATIONS[0]
        : null;

    const p =
      (comm0 && (comm0.VALUE_NORMALIZED || comm0.VALUE || comm0.VALUE_ORIGINAL)) ||
      a.PHONE_NUMBER ||
      a.CALL_PHONE_NUMBER ||
      a.CALL_FROM ||
      a.CALL_TO ||
      a.COMMUNICATION ||
      "";

    return BX.normalizePhone(p);
  }

  function stripDiacritics(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function norm(s) {
    return stripDiacritics(String(s || ""))
      .trim()
      .toUpperCase();
  }

  function extractDispositionFromText(text) {
    const raw = safeStr(text);
    const up = norm(raw);
    const list = App.config.DISPOSITIONS || [];
    for (const item of list) {
      const key = norm(item);
      if (key && up.includes(key)) return { disposition: item, dispositionRaw: raw };
    }
    return { disposition: null, dispositionRaw: raw };
  }

  async function getCallActivities(dateFromIso, dateToIso, responsibleIds) {
    const filter = {
      ">=START_TIME": BX.isoToSpace(dateFromIso),
      "<=START_TIME": BX.isoToSpace(dateToIso),
      "TYPE_ID": 2
    };

    if (Array.isArray(responsibleIds) && responsibleIds.length === 1) {
      filter["RESPONSIBLE_ID"] = String(responsibleIds[0]);
    } else if (Array.isArray(responsibleIds) && responsibleIds.length > 1) {
      filter["RESPONSIBLE_ID"] = responsibleIds.map(String);
    }

    const select = [
      "ID","TYPE_ID","DIRECTION","RESPONSIBLE_ID","START_TIME","END_TIME","CREATED","LAST_UPDATED",
      "DESCRIPTION","RESULT","OWNER_TYPE_ID","OWNER_ID","ASSOCIATED_ENTITY_ID","COMMUNICATIONS"
    ];

    const rows = await BX.listAll(
      "crm.activity.list",
      { filter, select, order: { "START_TIME": "ASC" } },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 200, maxRetries: 3 }
    );

    return Array.isArray(rows) ? rows : [];
  }

  function indexActivities(acts) {
    const map = new Map();

    for (const a of (acts || [])) {
      const resp = safeStr(a.RESPONSIBLE_ID || "0");
      const phone = normalizeActivityPhone(a);
      if (!phone) continue;

      const t = activityTs(a);
      if (!t) continue;

      const entry = {
        id: safeStr(a.ID),
        ts: t,
        phone,
        resp,
        ownerType: safeStr(a.OWNER_TYPE_ID),
        ownerId: safeStr(a.OWNER_ID),
        desc: safeStr(a.DESCRIPTION),
        result: safeStr(a.RESULT)
      };

      const key = `${resp}|${phone}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    }

    return map;
  }

  function resolveByUserPhoneTime(params, actIndex, windowMs) {
    const callStartTs = params.callStartTs || 0;
    const phone = BX.normalizePhone(params.phone || "");
    const resp = String(params.respId || "0");

    if (!callStartTs || !phone || !resp) return { activityId: null, disposition: null, dispositionRaw: null };

    const key = `${resp}|${phone}`;
    const bucket = actIndex && actIndex.get(key) ? actIndex.get(key) : [];
    if (!bucket.length) return { activityId: null, disposition: null, dispositionRaw: null };

    const from = callStartTs - windowMs;
    const to   = callStartTs + windowMs;

    const candidates = bucket.filter(a => a.ts >= from && a.ts <= to);
    if (!candidates.length) return { activityId: null, disposition: null, dispositionRaw: null };

    candidates.sort((a, b) => Math.abs(a.ts - callStartTs) - Math.abs(b.ts - callStartTs));
    const best = candidates[0];

    const { disposition, dispositionRaw } = extractDispositionFromText(best.desc || best.result);

    return {
      activityId: best.id,
      disposition,
      dispositionRaw,
      entityType: best.ownerType || null,
      entityId: best.ownerId || null,
      ambiguity: candidates.length > 1,
      candidates: candidates.slice(0, 5).map(x => ({ id: x.id, ts: x.ts, resp: x.resp }))
    };
  }

  async function tryWriteDispositionToActivity(activityId, dispositionLabel) {
    if (!App.config.WRITE_DISPOSITION_TO_ACTIVITY) return { ok: false, skipped: true };

    const aid = String(activityId || "").trim();
    const disp = String(dispositionLabel || "").trim();
    if (!aid || !disp) return { ok: false, skipped: true };

    const prefix = App.config.ACTIVITY_RESULT_PREFIX || "[DISPOSITION]";
    const resultText = `${prefix} ${disp}`;

    try {
      await BX.callMethod("crm.activity.update", { id: aid, fields: { RESULT: resultText } });
      log?.info?.("ACTIVITY_DISPOSITION_RESULT_OK", { activityId: aid, result: resultText });
      return { ok: true };
    } catch (e) {
      log?.warn?.("ACTIVITY_DISPOSITION_RESULT_FAIL", { activityId: aid, err: e?.message || String(e) });
      return { ok: false };
    }
  }

  App.svc.ActivityProvider = {
    getCallActivities,
    indexActivities,
    resolveByUserPhoneTime,
    tryWriteDispositionToActivity
  };

  log?.info?.("✅ ActivityProvider carregado", { hasGetActivities: true });
})(window);