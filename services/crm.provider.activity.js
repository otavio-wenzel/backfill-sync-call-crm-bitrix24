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

  function directionFromActivity(a) {
    const d = parseInt(a.DIRECTION, 10) || 0;
    if (d === 1) return "OUTBOUND";
    if (d === 2) return "INBOUND";
    return "UNKNOWN";
  }

  function directionFromCallType(callType) {
    const t = parseInt(callType, 10) || 0;
    if (t === 1) return "OUTBOUND";
    if (t === 2 || t === 3) return "INBOUND";
    return "UNKNOWN";
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

  function normalizeCallPhone(call) {
    const p =
      call.PHONE_NUMBER ||
      call.CALL_PHONE_NUMBER ||
      call.PHONE ||
      call.CALLER_ID ||
      call.CALL_FROM ||
      call.CALL_TO ||
      call.NUMBER ||
      "";
    return BX.normalizePhone(p);
  }

  function stripDiacritics(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function norm(s) {
    return stripDiacritics(String(s || ""))
      .trim()
      .toUpperCase()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^\w]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function extractDispositionFromText(text) {
    const raw = safeStr(text);
    if (!raw) return { disposition: null, dispositionRaw: "" };

    // 1) RESULT prefix [DISPOSITION] X
    const prefix = String(App.config.ACTIVITY_RESULT_PREFIX || "[DISPOSITION]").toUpperCase();
    const up = raw.toUpperCase();
    const idx = up.indexOf(prefix);
    if (idx >= 0) {
      const after = raw.slice(idx + prefix.length).trim();
      if (after) return { disposition: after, dispositionRaw: raw };
    }

    // 2) fallback: procurar por itens conhecidos
    const list = App.config.DISPOSITIONS || [];
    for (const item of list) {
      const key = norm(item);
      if (key && norm(raw).includes(key)) {
        return { disposition: item, dispositionRaw: raw };
      }
    }

    return { disposition: null, dispositionRaw: raw };
  }

  function extractDispositionFromActivity(a) {
    // prioriza RESULT, depois DESCRIPTION
    const r = extractDispositionFromText(a.result || a.RESULT || "");
    if (r && r.disposition) return r;

    const d = extractDispositionFromText(a.desc || a.DESCRIPTION || "");
    if (d && d.disposition) return d;

    // raw: concatenar para auditoria se quiser
    const raw = safeStr(a.RESULT || "") || safeStr(a.DESCRIPTION || "");
    return { disposition: null, dispositionRaw: raw };
  }

  async function getActivities(dateFromIso, dateToIso, responsibleIds) {
    const filter = {
      ">=START_TIME": BX.isoToSpace(dateFromIso),
      "<=START_TIME": BX.isoToSpace(dateToIso),
      "TYPE_ID": 2 // CALL
    };

    if (Array.isArray(responsibleIds) && responsibleIds.length === 1) {
      filter["RESPONSIBLE_ID"] = String(responsibleIds[0]);
    } else if (Array.isArray(responsibleIds) && responsibleIds.length > 1) {
      filter["RESPONSIBLE_ID"] = responsibleIds.map(String);
    }

    const select = [
      "ID",
      "TYPE_ID",
      "DIRECTION",
      "RESPONSIBLE_ID",
      "START_TIME",
      "END_TIME",
      "CREATED",
      "LAST_UPDATED",
      "DESCRIPTION",
      "RESULT",
      "OWNER_TYPE_ID",
      "OWNER_ID",
      "ASSOCIATED_ENTITY_ID",
      "COMMUNICATIONS"
    ];

    const rows = await BX.listAll(
      "crm.activity.list",
      { filter, select, order: { "START_TIME": "ASC" } },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 200, maxRetries: 3 }
    );

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * ✅ Index por RESPONSIBLE (não por phone)
   * Isso elimina o “noact” causado por divergência de phone normalizado.
   */
  function indexActivitiesByResponsible(acts) {
    const map = new Map(); // respId -> entries[]
    for (const a of (acts || [])) {
      const resp = safeStr(a.RESPONSIBLE_ID || "0");
      const ts = activityTs(a);
      if (!ts || !resp) continue;

      const entry = {
        id: safeStr(a.ID),
        ts,
        resp,
        direction: directionFromActivity(a),
        phone: normalizeActivityPhone(a),
        ownerType: safeStr(a.OWNER_TYPE_ID),
        ownerId: safeStr(a.OWNER_ID),
        desc: safeStr(a.DESCRIPTION),
        result: safeStr(a.RESULT)
      };

      if (!map.has(resp)) map.set(resp, []);
      map.get(resp).push(entry);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    }
    return map;
  }

  /**
   * Resolve Activity para um CALL (do Vox)
   * Critérios:
   * 1) TYPE_ID já é 2 (só trazemos CALL)
   * 2) RESPONSIBLE == PORTAL_USER_ID
   * 3) janela fixa em ms
   * 4) direção compatível (quando possível)
   * 5) desempate: menor delta
   * 6) phone é só “preferência” (se houver)
   */
  function resolveForVoxCall(call, actByResp, windowMs) {
    const callId = safeStr(call.CALL_ID || call.ID || "");
    const resp = safeStr(call.PORTAL_USER_ID || "0");

    const callStartIso = call.CALL_START_DATE || call.CALL_START_DATE_FORMATTED || call.CALL_START_DATE_SHORT || "";
    const callStart = BX.parseDateToTs(callStartIso);
    if (!callStart || !resp) {
      return { callId, activityId: null, ambiguity: false, candidates: [] };
    }

    const bucket = (actByResp && actByResp.get(resp)) ? actByResp.get(resp) : [];
    if (!bucket.length) return { callId, activityId: null, ambiguity: false, candidates: [] };

    const from = callStart - windowMs;
    const to   = callStart + windowMs;

    const callDir = directionFromCallType(call.CALL_TYPE);
    const callPhone = normalizeCallPhone(call);

    // candidatos dentro da janela
    let candidates = bucket.filter(a => a.ts >= from && a.ts <= to);

    // direção compatível (se ambas conhecidas)
    candidates = candidates.filter(a => {
      if (callDir === "UNKNOWN") return true;
      if (a.direction === "UNKNOWN") return true;
      return a.direction === callDir;
    });

    if (!candidates.length) return { callId, activityId: null, ambiguity: false, candidates: [] };

    // ordenação: menor delta; com preferência por phone match quando existir
    candidates.sort((a, b) => {
      const da = Math.abs(a.ts - callStart);
      const db = Math.abs(b.ts - callStart);

      const aPhoneMatch = (callPhone && a.phone) ? (a.phone === callPhone) : false;
      const bPhoneMatch = (callPhone && b.phone) ? (b.phone === callPhone) : false;

      if (aPhoneMatch !== bPhoneMatch) return aPhoneMatch ? -1 : 1;
      return da - db;
    });

    const best = candidates[0];
    const { disposition, dispositionRaw } = extractDispositionFromActivity(best);

    return {
      callId,
      activityId: best.id,
      disposition,
      dispositionRaw,
      entityType: best.ownerType || null,
      entityId: best.ownerId || null,
      ambiguity: candidates.length > 1,
      candidates: candidates.slice(0, App.config.MATCH_MAX_CANDIDATES_LOG || 5).map(x => ({
        id: x.id, ts: x.ts, dir: x.direction, resp: x.resp, phone: x.phone
      }))
    };
  }

  /**
   * Resolve Activity para um SPA (já criado)
   * spaRow precisa conter:
   * - id
   * - USER_ID (uf)
   * - CALL_START_DT (uf)
   * - PHONE_NUMBER (uf) (opcional para preferência)
   * - CALL_DIRECTION (uf) (opcional)
   */
  function resolveForSpaRow(spaRow, actByResp, windowMs) {
    const resp = safeStr(spaRow.userId || "0");
    const callStart = BX.parseDateToTs(safeStr(spaRow.callStartDt || ""));
    const callPhone = safeStr(spaRow.phone || "");
    const callDirToken = safeStr(spaRow.callDirToken || "UNKNOWN");

    if (!resp || !callStart) return { activityId: null, ambiguity: false, candidates: [] };

    const bucket = (actByResp && actByResp.get(resp)) ? actByResp.get(resp) : [];
    if (!bucket.length) return { activityId: null, ambiguity: false, candidates: [] };

    const from = callStart - windowMs;
    const to   = callStart + windowMs;

    let candidates = bucket.filter(a => a.ts >= from && a.ts <= to);

    // direção: se spa não tiver token, não filtra
    candidates = candidates.filter(a => {
      if (callDirToken === "UNKNOWN") return true;
      if (a.direction === "UNKNOWN") return true;
      return a.direction === callDirToken;
    });

    if (!candidates.length) return { activityId: null, ambiguity: false, candidates: [] };

    const callPhoneNorm = BX.normalizePhone(callPhone);

    candidates.sort((a, b) => {
      const da = Math.abs(a.ts - callStart);
      const db = Math.abs(b.ts - callStart);

      const aPhoneMatch = (callPhoneNorm && a.phone) ? (a.phone === callPhoneNorm) : false;
      const bPhoneMatch = (callPhoneNorm && b.phone) ? (b.phone === callPhoneNorm) : false;

      if (aPhoneMatch !== bPhoneMatch) return aPhoneMatch ? -1 : 1;
      return da - db;
    });

    const best = candidates[0];
    const { disposition, dispositionRaw } = extractDispositionFromActivity(best);

    return {
      activityId: best.id,
      disposition,
      dispositionRaw,
      entityType: best.ownerType || null,
      entityId: best.ownerId || null,
      ambiguity: candidates.length > 1,
      candidates: candidates.slice(0, App.config.MATCH_MAX_CANDIDATES_LOG || 5).map(x => ({
        id: x.id, ts: x.ts, dir: x.direction, resp: x.resp, phone: x.phone
      }))
    };
  }

  App.svc.ActivityProvider = {
    getActivities,
    indexActivitiesByResponsible,
    resolveForVoxCall,
    resolveForSpaRow,
    directionFromCallType
  };

  log?.info?.("✅ ActivityProvider carregado", { hasGetActivities: true });
})(window);