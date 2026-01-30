(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;

  const ENTITY_TYPE_ID = parseInt(App.config.ENTITY_TYPE_ID, 10);
  const F = App.config.FIELD_CODES; // ufCrm.. reais

  // ✅ Debug/validação pós-save
  const DEBUG_VERIFY_SAVE = !!App.config.DEBUG_VERIFY_SAVE;

  function assertEntityType() {
    if (!ENTITY_TYPE_ID || Number.isNaN(ENTITY_TYPE_ID)) {
      throw new Error("ENTITY_TYPE_ID inválido. Ajuste em core/config.js (ex.: 1068).");
    }
    if (!F || typeof F !== "object") {
      throw new Error("FIELD_CODES não definido em core/config.js");
    }
  }

  function stripDiacritics(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // remove acentos
  }

  // ✅ norm robusto: remove acentos, padroniza espaços e símbolos
  function norm(s) {
    return stripDiacritics(String(s || ""))
      .trim()
      .toUpperCase()
      .replace(/[\s\-]+/g, "_")          // espaços e hífen -> _
      .replace(/[^\w]/g, "_")           // outros símbolos -> _
      .replace(/_+/g, "_")              // colapsa ___
      .replace(/^_+|_+$/g, "");         // trim _
  }

  function extractItemsFromRes(res) {
    const data = (typeof res.data === "function") ? res.data() : res.data;
    return BX.extractItemsFromData(data);
  }

  // ===== Fields meta (somente para enums) =====
  let _fieldsMeta = null;
  let _enumCache = null; // { callDirection: Map(label->id), disposition: Map(label->id) }

  async function loadFieldsMeta() {
    assertEntityType();
    if (_fieldsMeta) return _fieldsMeta;

    const res = await BX.callMethodWithTimeout("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
    const data = (typeof res.data === "function") ? res.data() : res.data;

    if (!data || !data.fields) {
      throw new Error("crm.item.fields não retornou fields. Verifique permissões e o ENTITY_TYPE_ID.");
    }

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
      const items = f && Array.isArray(f.items) ? f.items : [];

      for (const it of items) {
        const rawValue = (it.value ?? it.VALUE ?? it.name ?? it.NAME ?? "");
        const rawId    = (it.id ?? it.ID ?? "");

        const k = norm(rawValue);
        const v = String(rawId);

        if (!k || !v || v === "undefined") continue;
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

  // ===== Dedup: por DEDUP_KEY =====
  function toIntIdMaybe(v) {
    const n = parseInt(String(v || ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  async function findByDedupKey(callId) {
    assertEntityType();

    const filter = {};
    filter[F.DEDUP_KEY] = String(callId);

    const res = await BX.callMethodWithTimeout("crm.item.list", {
      entityTypeId: ENTITY_TYPE_ID,
      filter,
      select: ["id", F.DEDUP_KEY, F.TELEPHONY_CALL_ID],
      order: { id: "ASC" }
    });

    const items = extractItemsFromRes(res);

    if (!items || !items.length) return null;

    if (items.length > 1) {
      log?.warn?.("⚠️ DEDUP_KEY duplicado no SPA (já existem múltiplos). Usando o primeiro.", {
        callId,
        count: items.length
      });
    }

    const row = items[0];

    const id =
      toIntIdMaybe(row.id) ??
      toIntIdMaybe(row.ID) ??
      toIntIdMaybe(row.Id) ??
      (row.item ? (toIntIdMaybe(row.item.id) ?? toIntIdMaybe(row.item.ID)) : null);

    if (!id) {
      log?.error?.("DEDUP retornou item sem id. Verifique o retorno do crm.item.list (select/format).", {
        keys: Object.keys(row || {}),
        row
      });
      return null; // força CREATE (evita update com id inválido)
    }

    return { ...row, __intId: id };
  }

  async function addItem(fields) {
    const res = await BX.callMethodWithTimeout("crm.item.add", {
      entityTypeId: ENTITY_TYPE_ID,
      fields
    });
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function updateItem(id, fields) {
    const intId = toIntIdMaybe(id);
    if (!intId) throw new Error(`ID inválido para update: ${id}`);

    const res = await BX.callMethodWithTimeout("crm.item.update", {
      entityTypeId: ENTITY_TYPE_ID,
      id: intId,
      fields
    });
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  // ✅ Verificação pós-gravação (prova do que persistiu)
  async function getItem(id) {
    const intId = toIntIdMaybe(id);
    if (!intId) return null;

    const res = await BX.callMethodWithTimeout("crm.item.get", {
      entityTypeId: ENTITY_TYPE_ID,
      id: intId
    });

    const d = (typeof res.data === "function") ? res.data() : res.data;
    if (d && d.item) return d.item;
    return d || null;
  }

  function getAnyIdFromItem(item, fallback) {
    return (
      toIntIdMaybe(item && (item.id ?? item.ID ?? item.Id)) ??
      toIntIdMaybe(fallback)
    );
  }

  async function verifySaved(itemId, callId) {
    if (!DEBUG_VERIFY_SAVE) return;

    try {
      const saved = await getItem(itemId);
      if (!saved) {
        log?.warn?.("VERIFY_SAVE: item.get não retornou item", { itemId, callId });
        return;
      }

      const sid = getAnyIdFromItem(saved, itemId);

      log?.info?.("VERIFY_SAVE", {
        id: sid,
        callId: String(callId || ""),
        dir: saved[F.CALL_DIRECTION],
        act: saved[F.CRM_ACTIVITY_ID],
        disp: saved[F.DISPOSITION],
        dispRawLen: saved[F.DISPOSITION_RAW] ? String(saved[F.DISPOSITION_RAW]).length : 0,
        answered: saved[F.ANSWERED],
        phone: saved[F.PHONE_NUMBER]
      });
    } catch (e) {
      log?.warn?.("VERIFY_SAVE falhou", {
        itemId,
        callId,
        err: (e && e.message) ? e.message : String(e || "")
      });
    }
  }

  // ===== user name (cache) =====
  const _userNameCache = new Map();

  async function getUserNameById(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return "";
    if (_userNameCache.has(uid)) return _userNameCache.get(uid);

    try {
      const res = await BX.callMethodWithTimeout("user.get", { ID: uid });
      const d = (typeof res.data === "function") ? res.data() : res.data;
      const u = Array.isArray(d) ? d[0] : null;
      const name = u ? ((u.NAME || "") + " " + (u.LAST_NAME || "")).trim() : "";
      _userNameCache.set(uid, name);
      return name;
    } catch (e) {
      _userNameCache.set(uid, "");
      return "";
    }
  }

  // ===== Mapeamentos =====
  function answeredFromCall(call) {
    const dur = parseInt(call?.CALL_DURATION, 10);
    return Number.isFinite(dur) && dur > 0;
  }

  function safeDuration(call) {
    const dur = parseInt(call?.CALL_DURATION, 10);
    return Number.isFinite(dur) ? dur : 0;
  }

  function extractPhone(call) {
    const raw =
      call?.PHONE_NUMBER ||
      call?.CALL_PHONE_NUMBER ||
      call?.PHONE ||
      call?.CALL_FROM ||
      call?.CALL_TO ||
      "";
    return BX.normalizePhone(raw);
  }

  function statusCode(call) {
    return String(call?.CALL_STATUS_CODE || call?.CALL_FAILED_CODE || "");
  }

  function startDate(call) {
    return call?.CALL_START_DATE || call?.CALL_START_DATE_FORMATTED || call?.CALL_START_DATE_SHORT || null;
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

  // ✅ Direção resiliente: tenta CALL_TYPE e variações
  function getDirectionToken(call) {
    // 1) padrão voximplant
    const t = parseInt(call?.CALL_TYPE, 10);
    if (Number.isFinite(t)) {
      if (t === 1) return "OUTBOUND";
      if (t === 2) return "INBOUND";
      if (t === 3) return "INBOUND_REDIRECTED";
    }

    // 2) alguns retornos/integrações podem ter string
    const s =
      String(call?.DIRECTION || call?.CALL_DIRECTION || call?.CALL_TYPE || "").trim().toUpperCase();

    if (s.includes("OUT")) return "OUTBOUND";
    if (s.includes("REDIRECT")) return "INBOUND_REDIRECTED";
    if (s.includes("IN")) return "INBOUND";

    return null;
  }

  function pickDirectionEnumId(call, enums) {
    const token = getDirectionToken(call);
    if (!token) return null;

    // bate por igualdade exata primeiro
    const exact = enums.callDirection.get(norm(token));
    if (exact) return exact;

    // fallback por contains
    return pickEnumIdByContains(enums.callDirection, [token]);
  }

  async function upsertFromCall(call, resolved) {
    await loadEnums();
    const enums = _enumCache;

    const callId = String(call?.CALL_ID || call?.ID || "");
    if (!callId) throw new Error("CALL sem CALL_ID/ID");

    const existing = await findByDedupKey(callId);

    const fields = {};

    // IDs/dedup
    fields[F.TELEPHONY_CALL_ID] = callId;
    fields[F.DEDUP_KEY] = callId;

    // Usuário
    const uid = call?.PORTAL_USER_ID ? String(call.PORTAL_USER_ID) : "";
    if (uid) {
      fields[F.USER_ID] = uid;

      const directName = String(call?.PORTAL_USER_NAME || "").trim();
      if (directName) {
        fields[F.USER_NAME] = directName;
      } else {
        const nm = await getUserNameById(uid);
        if (nm) fields[F.USER_NAME] = nm;
      }
    }

    // Direção (lista)
    const dirEnumId = pickDirectionEnumId(call, enums);
    if (dirEnumId) fields[F.CALL_DIRECTION] = dirEnumId;

    // Básicos
    fields[F.PHONE_NUMBER] = extractPhone(call);
    fields[F.CALL_STATUS_CODE] = statusCode(call);

    const sd = startDate(call);
    if (sd) fields[F.CALL_START_DT] = String(sd);

    fields[F.CALL_DURATION] = safeDuration(call);
    fields[F.ANSWERED] = answeredFromCall(call) ? "Y" : "N";

    // Activity + Disposition
    if (resolved?.activityId) {
      fields[F.CRM_ACTIVITY_ID] = String(resolved.activityId);
    }

    if (resolved?.dispositionRaw) {
      fields[F.DISPOSITION_RAW] = String(resolved.dispositionRaw).slice(0, 5000);
    }

    // DISPOSITION (lista)
    let dispEnumId = null;
    const dispLabel = resolved?.disposition ? String(resolved.disposition) : "";
    if (dispLabel) {
      dispEnumId = enums.disposition.get(norm(dispLabel)) || null;
      if (!dispEnumId) dispEnumId = pickEnumIdByContains(enums.disposition, [dispLabel]);
    }
    if (dispEnumId) fields[F.DISPOSITION] = dispEnumId;

    // Entity link
    if (resolved?.entityType) fields[F.ENTITY_TYPE] = String(resolved.entityType);
    if (resolved?.entityId) fields[F.ENTITY_ID] = String(resolved.entityId);

    // timestamps
    const now = BX.nowIso();
    fields[F.SYNCED_AT] = now;
    fields[F.UPDATED_AT] = now;
    if (!existing) fields[F.CREATED_AT] = now;

    // 🔎 LOG “prova” antes de salvar (mostra se você está mandando valor ou não)
    log?.info?.("SPA_UPSERT_PRE", {
      callId,
      hasExisting: !!existing,
      callType: call?.CALL_TYPE,
      dirToken: getDirectionToken(call),
      dirEnumId: dirEnumId || null,
      dispLabel: dispLabel || null,
      dispEnumId: dispEnumId || null,
      activityId: resolved?.activityId || null
    });

    if (!existing) {
      const item = await addItem(fields);
      const newId = getAnyIdFromItem(item, null);

      await verifySaved(newId, callId);

      return { mode: "created", id: newId };
    }

    // Update conservador
    const updateFields = { ...fields };
    if (!dispEnumId) delete updateFields[F.DISPOSITION];
    if (!resolved?.activityId) delete updateFields[F.CRM_ACTIVITY_ID];

    const exId = existing.__intId;
    const item = await updateItem(exId, updateFields);
    const updId = getAnyIdFromItem(item, exId);

    await verifySaved(updId, callId);

    return { mode: "updated", id: updId };
  }

  async function sanityCheck() {
    await loadFieldsMeta();
    await loadEnums();
    log?.info?.("✅ SPA sanity check OK", { ENTITY_TYPE_ID, DEBUG_VERIFY_SAVE });
    return true;
  }

  App.svc.SpaProvider = {
    sanityCheck,
    loadEnums,
    upsertFromCall
  };
})(window);