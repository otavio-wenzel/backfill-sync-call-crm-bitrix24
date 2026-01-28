(function (global) {
  const App = global.App = global.App || {};
  App.svc = App.svc || {};

  const BX = App.core.BX24;
  const log = App.log;

  // ===== Helpers =====
  function safeStr(v) { return (v === null || v === undefined) ? "" : String(v); }

  function activityTs(a) {
    // Bitrix costuma usar "YYYY-MM-DD HH:MM:SS"
    const dt = a.START_TIME || a.CREATED || a.LAST_UPDATED || a.END_TIME || "";
    return BX.parseDateToTs(dt);
  }

  function normalizeActivityPhone(a) {
    // Nem sempre vem, então tentamos alguns campos comuns
    const p =
      a.COMMUNICATIONS && Array.isArray(a.COMMUNICATIONS) && a.COMMUNICATIONS[0]
        ? (a.COMMUNICATIONS[0].VALUE || a.COMMUNICATIONS[0].VALUE_ORIGINAL || "")
        : (a.PHONE_NUMBER || a.CALL_PHONE_NUMBER || a.CALL_FROM || a.CALL_TO || a.COMMUNICATION || "");

    return BX.normalizePhone(p);
  }

  function directionFromActivity(a) {
    // a.DIRECTION: 1=outgoing, 2=incoming (em geral)
    const d = parseInt(a.DIRECTION, 10) || 0;
    if (d === 1) return "OUTBOUND";
    if (d === 2) return "INBOUND";
    return "UNKNOWN";
  }

  function directionFromCall(call) {
    const t = parseInt(call.CALL_TYPE, 10) || 0;
    if (t === 1) return "OUTBOUND";
    if (t === 2 || t === 3) return "INBOUND";
    return "UNKNOWN";
  }

  function extractDispositionFromDescription(desc) {
    const raw = safeStr(desc);
    const up = raw.toUpperCase();

    const list = App.config.DISPOSITIONS || [];
    for (const item of list) {
      const key = String(item).toUpperCase();
      if (key && up.includes(key)) {
        return { disposition: item, dispositionRaw: raw };
      }
    }
    return { disposition: null, dispositionRaw: raw };
  }

  // ===== API =====

  async function getActivities(dateFromIso, dateToIso) {
    // IMPORTANTE: crm.activity.list usa filtro por START_TIME normalmente.
    // Se no seu portal os campos diferirem, a consulta ainda retorna, só que menos.
    const filter = {
      ">=START_TIME": BX.isoToSpace(dateFromIso),
      "<=START_TIME": BX.isoToSpace(dateToIso),
      "TYPE_ID": 2 // CALL
    };

    const select = [
      "ID",
      "TYPE_ID",
      "DIRECTION",
      "START_TIME",
      "END_TIME",
      "CREATED",
      "LAST_UPDATED",
      "DESCRIPTION",
      "OWNER_TYPE_ID",
      "OWNER_ID",
      "ASSOCIATED_ENTITY_ID",
      "PROVIDER_ID",
      "PROVIDER_TYPE_ID",
      "PROVIDER_PARAMS",
      "COMMUNICATIONS"
    ];

    const rows = await BX.listAll(
      "crm.activity.list",
      { filter, select, order: { "START_TIME": "ASC" } },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 200, maxRetries: 3 }
    );

    return Array.isArray(rows) ? rows : [];
  }

  function indexActivities(acts) {
    // Index simples: phone -> lista ordenada por timestamp
    const map = new Map();

    for (const a of (acts || [])) {
      const phone = normalizeActivityPhone(a);
      if (!phone) continue;

      const t = activityTs(a);
      const entry = {
        id: safeStr(a.ID),
        ts: t,
        phone,
        direction: directionFromActivity(a),
        ownerType: safeStr(a.OWNER_TYPE_ID),
        ownerId: safeStr(a.OWNER_ID),
        desc: safeStr(a.DESCRIPTION)
      };

      if (!map.has(phone)) map.set(phone, []);
      map.get(phone).push(entry);
    }

    // ordena por ts
    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    }

    return map;
  }

  function resolveForCall(call, actIndex, windowMs) {
    const callStart = BX.parseDateToTs(call.CALL_START_DATE || call.CALL_START_DATE_FORMATTED || "");
    const callPhone = BX.normalizePhone(
      call.PHONE_NUMBER || call.CALL_PHONE_NUMBER || call.PHONE || call.CALL_FROM || call.CALL_TO || ""
    );
    const callDir = directionFromCall(call);

    if (!callStart || !callPhone) {
      return { activityId: null, disposition: null, dispositionRaw: null };
    }

    const bucket = actIndex && actIndex.get(callPhone) ? actIndex.get(callPhone) : [];
    if (!bucket.length) {
      return { activityId: null, disposition: null, dispositionRaw: null };
    }

    // pega candidatos na janela
    const from = callStart - windowMs;
    const to   = callStart + windowMs;

    const candidates = bucket
      .filter(a => a.ts >= from && a.ts <= to)
      .filter(a => (callDir === "UNKNOWN" || a.direction === "UNKNOWN" || a.direction === callDir));

    if (!candidates.length) {
      return { activityId: null, disposition: null, dispositionRaw: null };
    }

    // escolhe o mais próximo
    candidates.sort((a, b) => Math.abs(a.ts - callStart) - Math.abs(b.ts - callStart));
    const best = candidates[0];

    const { disposition, dispositionRaw } = extractDispositionFromDescription(best.desc);

    return {
      activityId: best.id,
      disposition,
      dispositionRaw,
      entityType: best.ownerType || null,
      entityId: best.ownerId || null,
      ambiguity: candidates.length > 1,
      candidates: candidates.slice(0, 5).map(x => ({ id: x.id, ts: x.ts, dir: x.direction }))
    };
  }

  App.svc.ActivityProvider = {
    getActivities,
    indexActivities,
    resolveForCall
  };

  log && log.info && log.info("✅ ActivityProvider carregado", { hasGetActivities: true });
})(window);