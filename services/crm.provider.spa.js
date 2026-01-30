(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;

  const ENTITY_TYPE_ID = parseInt(App.config.ENTITY_TYPE_ID, 10);
  const F = App.config.FIELD_CODES;
  const DEBUG_VERIFY_SAVE = !!App.config.DEBUG_VERIFY_SAVE;

  function assertEntityType() {
    if (!ENTITY_TYPE_ID || Number.isNaN(ENTITY_TYPE_ID)) throw new Error("ENTITY_TYPE_ID inválido.");
    if (!F || typeof F !== "object") throw new Error("FIELD_CODES não definido.");
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

  function extractItemsFromRes(res) {
    const data = (typeof res.data === "function") ? res.data() : res.data;
    return BX.extractItemsFromData(data);
  }

  let _fieldsMeta = null;
  let _enumCache = null;

  async function loadFieldsMeta() {
    assertEntityType();
    if (_fieldsMeta) return _fieldsMeta;

    const res = await BX.callMethodWithTimeout("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID }, 120000);
    const data = (typeof res.data === "function") ? res.data() : res.data;

    if (!data || !data.fields) throw new Error("crm.item.fields não retornou fields.");
    _fieldsMeta = data;
    return _fieldsMeta;
  }

  async function loadEnums() {
    await loadFieldsMeta();
    if (_enumCache) return _enumCache;

    const meta = _fieldsMeta;

    function buildEnumMap(realFieldKey) {
      const m = new Map();
      const f = meta.fields ? meta.fields[realFieldKey] : null;
      const items = (f && Array.isArray(f.items)) ? f.items : [];

      for (const it of items) {
        const rawValue = (it.value ?? it.VALUE ?? it.name ?? it.NAME ?? "");
        const rawId    = (it.id ?? it.ID ?? "");
        const k = norm(rawValue);
        const v = String(rawId);
        if (!k) continue;
        if (!v || v === "undefined" || v === "null") continue;
        m.set(k, v);
      }
      return m;
    }

    _enumCache = {
      callDirection: buildEnumMap(F.CALL_DIRECTION),
      disposition: buildEnumMap(F.DISPOSITION)
    };

    log?.info?.("Enums carregados (CALL_DIRECTION / DISPOSITION).", {
      dirCount: _enumCache.callDirection.size,
      dispCount: _enumCache.disposition.size,
      dirKeysSample: Array.from(_enumCache.callDirection.keys()).slice(0, 10),
      dispKeysSample: Array.from(_enumCache.disposition.keys()).slice(0, 10)
    });

    return _enumCache;
  }

  function toIntIdMaybe(v) {
    const n = parseInt(String(v || ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function getAnyIdFromItem(item, fallback) {
    return toIntIdMaybe(item && (item.id ?? item.ID ?? item.Id)) ?? toIntIdMaybe(fallback);
  }

  async function findByDedupKey(callId) {
    assertEntityType();

    const filter = {};
    filter[F.DEDUP_KEY] = String(callId);

    const res = await BX.callMethodWithTimeout("crm.item.list", {
      entityTypeId: ENTITY_TYPE_ID,
      filter,
      select: ["id", F.DEDUP_KEY, F.TELEPHONY_CALL_ID, F.CRM_ACTIVITY_ID],
      order: { id: "ASC" }
    }, 120000);

    const items = extractItemsFromRes(res);
    if (!items || !items.length) return null;

    if (items.length > 1) log?.warn?.("⚠️ DEDUP_KEY duplicado no SPA. Usando o primeiro.", { callId, count: items.length });

    const row = items[0];
    const id =
      toIntIdMaybe(row.id) ??
      toIntIdMaybe(row.ID) ??
      toIntIdMaybe(row.Id) ??
      (row.item ? (toIntIdMaybe(row.item.id) ?? toIntIdMaybe(row.item.ID)) : null);

    if (!id) return null;
    return { ...row, __intId: id };
  }

  async function addItem(fields) {
    const res = await BX.callMethodWithTimeout("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields }, 120000);
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function updateItem(id, fields) {
    const intId = toIntIdMaybe(id);
    if (!intId) throw new Error(`ID inválido para update: ${id}`);
    const res = await BX.callMethodWithTimeout("crm.item.update", { entityTypeId: ENTITY_TYPE_ID, id: intId, fields }, 120000);
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function getItem(id) {
    const intId = toIntIdMaybe(id);
    if (!intId) return null;
    const res = await BX.callMethodWithTimeout("crm.item.get", { entityTypeId: ENTITY_TYPE_ID, id: intId }, 120000);
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : (d || null);
  }

  async function verifySaved(itemId, callId) {
    if (!DEBUG_VERIFY_SAVE) return;
    try {
      const saved = await getItem(itemId);
      if (!saved) return log?.warn?.("VERIFY_SAVE: item.get não retornou item", { itemId, callId });

      const sid = getAnyIdFromItem(saved, itemId);
      log?.info?.("VERIFY_SAVE", {
        id: sid,
        callId: String(callId || ""),
        act: saved[F.CRM_ACTIVITY_ID] ?? null,
        disp: saved[F.DISPOSITION] ?? null,
        answered: saved[F.ANSWERED],
        phone: saved[F.PHONE_NUMBER]
      });
    } catch (e) {
      log?.warn?.("VERIFY_SAVE falhou", { itemId, callId, err: e?.message || String(e) });
    }
  }

  // ====== LISTAR SPAs por período (para Aba 2) ======
  async function listSpasByPeriod(dateFromIso, dateToIso, onlyMissingActivity) {
    assertEntityType();

    // ✅ Aqui está a correção do seu print:
    // Nada de `">=" + F.CALL_START_DT: ...` (isso é sintaxe inválida)
    // Usar objeto + atribuição:
    const filter = {};
    filter[">=" + F.CALL_START_DT] = BX.isoToSpace(dateFromIso);
    filter["<=" + F.CALL_START_DT] = BX.isoToSpace(dateToIso);

    if (onlyMissingActivity) {
      // vazio/nulo
      filter["=" + F.CRM_ACTIVITY_ID] = false;
    }

    const select = [
      "id",
      F.TELEPHONY_CALL_ID,
      F.CRM_ACTIVITY_ID,
      F.USER_ID,
      F.PHONE_NUMBER,
      F.CALL_START_DT,
      F.DISPOSITION_RAW,
      F.ENTITY_TYPE,
      F.ENTITY_ID
    ];

    const rows = await BX.listAll(
      "crm.item.list",
      { entityTypeId: ENTITY_TYPE_ID, filter, select, order: { id: "ASC" } },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 200, maxRetries: 3 }
    );

    return Array.isArray(rows) ? rows : [];
  }

  async function updateSpaActivity(spaId, patchFields) {
    const item = await updateItem(spaId, patchFields);
    const updId = getAnyIdFromItem(item, spaId);
    return updId;
  }

  // ===== UPSERT Vox → SPA (aba 1) =====
  async function upsertFromVoxCall(call) {
    await loadEnums();
    const enums = _enumCache;

    const callId = String(call?.CALL_ID || call?.ID || "");
    if (!callId) throw new Error("CALL sem CALL_ID/ID");

    const existing = await findByDedupKey(callId);

    function answeredFromCall(c) {
      const dur = parseInt(c?.CALL_DURATION, 10);
      return Number.isFinite(dur) && dur > 0;
    }
    function safeDuration(c) {
      const dur = parseInt(c?.CALL_DURATION, 10);
      return Number.isFinite(dur) ? dur : 0;
    }
    function extractPhone(c) {
      const raw = c?.PHONE_NUMBER || c?.CALL_PHONE_NUMBER || c?.PHONE || c?.CALL_FROM || c?.CALL_TO || "";
      return BX.normalizePhone(raw);
    }
    function statusCode(c) {
      return String(c?.CALL_STATUS_CODE || c?.CALL_FAILED_CODE || "");
    }
    function startDate(c) {
      return c?.CALL_START_DATE || c?.CALL_START_DATE_FORMATTED || c?.CALL_START_DATE_SHORT || null;
    }
    function getDirectionToken(c) {
      const t = parseInt(c?.CALL_TYPE, 10);
      if (Number.isFinite(t)) {
        if (t === 1) return "OUTBOUND";
        if (t === 2) return "INBOUND";
        if (t === 3) return "INBOUND_REDIRECTED";
      }
      return null;
    }
    function pickEnumIdByContains(enumMap, preferredTokens) {
      const keys = Array.from(enumMap.keys());
      for (const token of preferredTokens) {
        const t = norm(token);
        const foundKey = keys.find(k => k.includes(t));
        if (foundKey) return enumMap.get(foundKey);
      }
      return null;
    }
    function pickDirectionEnumId(c, e) {
      const token = getDirectionToken(c);
      if (!token) return null;
      const exact = e.callDirection.get(norm(token));
      if (exact) return exact;
      return pickEnumIdByContains(e.callDirection, [token]);
    }

    const fields = {};
    fields[F.TELEPHONY_CALL_ID] = callId;
    fields[F.DEDUP_KEY] = callId;

    const uid = call?.PORTAL_USER_ID ? String(call.PORTAL_USER_ID) : "";
    if (uid) fields[F.USER_ID] = uid;
    const directName = String(call?.PORTAL_USER_NAME || "").trim();
    if (directName) fields[F.USER_NAME] = directName;

    const dirEnumId = pickDirectionEnumId(call, enums);
    if (dirEnumId) fields[F.CALL_DIRECTION] = dirEnumId;

    fields[F.PHONE_NUMBER] = extractPhone(call);
    fields[F.CALL_STATUS_CODE] = statusCode(call);

    const sd = startDate(call);
    if (sd) fields[F.CALL_START_DT] = String(sd);

    fields[F.CALL_DURATION] = safeDuration(call);
    fields[F.ANSWERED] = answeredFromCall(call) ? "Y" : "N";

    const now = BX.nowIso();
    fields[F.SYNCED_AT] = now;
    fields[F.UPDATED_AT] = now;
    if (!existing) fields[F.CREATED_AT] = now;

    if (!existing) {
      const item = await addItem(fields);
      const newId = getAnyIdFromItem(item, null);
      await verifySaved(newId, callId);
      return { mode: "created", id: newId, callId };
    } else {
      const exId = existing.__intId;
      const item = await updateItem(exId, fields);
      const updId = getAnyIdFromItem(item, exId);
      await verifySaved(updId, callId);
      return { mode: "updated", id: updId, callId };
    }
  }

  App.svc.SpaProvider = {
    loadEnums,
    listSpasByPeriod,
    updateSpaActivity,
    upsertFromVoxCall
  };
})(window);