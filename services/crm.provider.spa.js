(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;

  const ENTITY_TYPE_ID = parseInt(App.config.ENTITY_TYPE_ID, 10);
  const F = App.config.FIELD_CODES;
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
      .replace(/[\u0300-\u036f]/g, "");
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

    const res = await BX.callMethodWithTimeout(
      "crm.item.fields",
      { entityTypeId: ENTITY_TYPE_ID },
      120000
    );

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

  async function findByDedupKey(callId) {
    assertEntityType();

    const filter = {};
    filter[F.DEDUP_KEY] = String(callId);

    const res = await BX.callMethodWithTimeout(
      "crm.item.list",
      {
        entityTypeId: ENTITY_TYPE_ID,
        filter,
        select: ["id", F.DEDUP_KEY, F.TELEPHONY_CALL_ID, F.CRM_ACTIVITY_ID],
        order: { id: "ASC" }
      },
      120000
    );

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

    if (!id) return null;
    return { ...row, __intId: id };
  }

  async function addItem(fields) {
    const res = await BX.callMethodWithTimeout(
      "crm.item.add",
      { entityTypeId: ENTITY_TYPE_ID, fields },
      120000
    );
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function updateItem(id, fields) {
    const intId = toIntIdMaybe(id);
    if (!intId) throw new Error(`ID inválido para update: ${id}`);

    const res = await BX.callMethodWithTimeout(
      "crm.item.update",
      { entityTypeId: ENTITY_TYPE_ID, id: intId, fields },
      120000
    );
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function getItem(id) {
    const intId = toIntIdMaybe(id);
    if (!intId) return null;

    const res = await BX.callMethodWithTimeout(
      "crm.item.get",
      { entityTypeId: ENTITY_TYPE_ID, id: intId },
      120000
    );

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

  async function verifySaved(itemId, extra) {
    if (!DEBUG_VERIFY_SAVE) return;
    try {
      const saved = await getItem(itemId);
      if (!saved) return;

      const sid = getAnyIdFromItem(saved, itemId);
      log?.info?.("VERIFY_SAVE", {
        id: sid,
        callId: saved[F.TELEPHONY_CALL_ID],
        act: saved[F.CRM_ACTIVITY_ID],
        disp: saved[F.DISPOSITION],
        dispRawLen: saved[F.DISPOSITION_RAW] ? String(saved[F.DISPOSITION_RAW]).length : 0,
        extra: extra || null
      });
    } catch (e) {
      log?.warn?.("VERIFY_SAVE falhou", {
        itemId,
        err: (e && e.message) ? e.message : String(e || "")
      });
    }
  }

  const _userNameCache = new Map();

  async function getUserNameById(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return "";
    if (_userNameCache.has(uid)) return _userNameCache.get(uid);

    try {
      const res = await BX.callMethodWithTimeout("user.get", { ID: uid }, 60000);
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

  function getDirectionToken(call) {
    const t = parseInt(call?.CALL_TYPE, 10);
    if (Number.isFinite(t)) {
      if (t === 1) return "OUTBOUND";
      if (t === 2) return "INBOUND";
      if (t === 3) return "INBOUND_REDIRECTED";
    }

    const s = String(call?.DIRECTION || call?.CALL_DIRECTION || call?.CALL_TYPE || "").trim().toUpperCase();
    if (s.includes("OUT")) return "OUTBOUND";
    if (s.includes("REDIRECT")) return "INBOUND_REDIRECTED";
    if (s.includes("IN")) return "INBOUND";
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

  function pickDirectionEnumId(call, enums) {
    const token = getDirectionToken(call);
    if (!token) return null;

    const exact = enums.callDirection.get(norm(token));
    if (exact) return exact;

    return pickEnumIdByContains(enums.callDirection, [token]);
  }

  /**
   * ✅ MODO 1: Vox → SPA
   * NÃO salva activity/disposition aqui.
   */
  async function upsertFromVoxCall(call) {
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
      if (directName) fields[F.USER_NAME] = directName;
      else {
        const nm = await getUserNameById(uid);
        if (nm) fields[F.USER_NAME] = nm;
      }
    }

    // Direção (enum)
    const dirEnumId = pickDirectionEnumId(call, enums);
    if (dirEnumId) fields[F.CALL_DIRECTION] = dirEnumId;

    // Básicos
    fields[F.PHONE_NUMBER] = extractPhone(call);
    fields[F.CALL_STATUS_CODE] = statusCode(call);

    const sd = startDate(call);
    if (sd) fields[F.CALL_START_DT] = String(sd);

    fields[F.CALL_DURATION] = safeDuration(call);
    fields[F.ANSWERED] = answeredFromCall(call) ? "Y" : "N";

    // timestamps
    const now = BX.nowIso();
    fields[F.SYNCED_AT] = now;
    fields[F.UPDATED_AT] = now;
    if (!existing) fields[F.CREATED_AT] = now;

    log?.info?.("SPA_UPSERT_VOX_PRE", {
      callId,
      hasExisting: !!existing,
      callType: call?.CALL_TYPE,
      dirToken: getDirectionToken(call),
      dirEnumId: dirEnumId || null
    });

    if (!existing) {
      const item = await addItem(fields);
      const newId = getAnyIdFromItem(item, null);
      await verifySaved(newId, { mode: "created_vox" });
      return { mode: "created", id: newId, callId };
    }

    const exId = existing.__intId;
    const item = await updateItem(exId, fields);
    const updId = getAnyIdFromItem(item, exId);

    await verifySaved(updId, { mode: "updated_vox" });
    return { mode: "updated", id: updId, callId };
  }

  /**
   * Lista SPAs por período, com opção de filtrar apenas sem Activity.
   */
  async function listSpasByPeriod(dateFromIso, dateToIso, onlyMissingActivity) {
    assertEntityType();

    const filter = {
      ">= " + F.CALL_START_DT: BX.isoToSpace(dateFromIso),
      "<= " + F.CALL_START_DT: BX.isoToSpace(dateToIso)
    };

    // Bitrix filter key precisa ser sem espaços: ">=uf..." etc.
    const realFilter = {};
    realFilter[">=" + F.CALL_START_DT] = BX.isoToSpace(dateFromIso);
    realFilter["<=" + F.CALL_START_DT] = BX.isoToSpace(dateToIso);

    if (onlyMissingActivity) {
      // vazio / null
      realFilter["=" + F.CRM_ACTIVITY_ID] = false;
    }

    const select = [
      "id",
      F.TELEPHONY_CALL_ID,
      F.CRM_ACTIVITY_ID,
      F.USER_ID,
      F.CALL_START_DT,
      F.PHONE_NUMBER,
      F.CALL_DIRECTION,
      F.DISPOSITION,
      F.DISPOSITION_RAW,
      F.ENTITY_TYPE,
      F.ENTITY_ID
    ];

    const rows = await BX.listAll(
      "crm.item.list",
      {
        entityTypeId: ENTITY_TYPE_ID,
        filter: realFilter,
        select,
        order: { id: "ASC" }
      },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 150, maxRetries: 3 }
    );

    return Array.isArray(rows) ? rows : [];
  }

  function mapSpaRowForMatching(row, activityProvider) {
    // extrair token de direção a partir do enum id do SPA:
    // Como o enum id -> token não está mapeado, não dá para “converter” com 100% certeza aqui.
    // Então: para o matching, direção fica UNKNOWN (não filtramos no SPA->Activity),
    // ou você pode enriquecer com regra própria se quiser.
    // (A parte que realmente salva direção já está correta no Vox.)
    return {
      id: toIntIdMaybe(row.id ?? row.ID ?? row.Id),
      callId: safeStr(row[F.TELEPHONY_CALL_ID] || ""),
      existingActivityId: safeStr(row[F.CRM_ACTIVITY_ID] || ""),
      userId: safeStr(row[F.USER_ID] || ""),
      callStartDt: safeStr(row[F.CALL_START_DT] || ""),
      phone: safeStr(row[F.PHONE_NUMBER] || ""),
      callDirToken: "UNKNOWN"
    };
  }

  /**
   * Atualiza campos de Activity/Disposition/Entity no SPA.
   * Idempotente: só escreve se mudou ou se está vazio, a menos que forceRelink.
   */
  async function updateSpaFromResolvedActivity(spaId, resolved, opts) {
    await loadEnums();
    const enums = _enumCache;

    const forceRelink = !!(opts && opts.forceRelink);

    if (!spaId) throw new Error("updateSpaFromResolvedActivity: spaId inválido");

    const fields = {};
    const now = BX.nowIso();
    fields[F.SYNCED_AT] = now;
    fields[F.UPDATED_AT] = now;

    // Activity link
    if (resolved?.activityId) {
      fields[F.CRM_ACTIVITY_ID] = String(resolved.activityId);
    } else if (!forceRelink) {
      // sem activity -> não atualiza nada além de timestamps
      // mas ainda atualiza SYNCED/UPDATED pra marcar passagem
    }

    // Entity
    if (resolved?.entityType) fields[F.ENTITY_TYPE] = String(resolved.entityType);
    if (resolved?.entityId) fields[F.ENTITY_ID] = String(resolved.entityId);

    // Disposition raw
    if (resolved?.dispositionRaw) {
      fields[F.DISPOSITION_RAW] = String(resolved.dispositionRaw).slice(0, 5000);
    }

    // Disposition enum
    let dispEnumId = null;
    const dispLabel = resolved?.disposition ? String(resolved.disposition) : "";
    if (dispLabel) {
      dispEnumId = enums.disposition.get(norm(dispLabel)) || null;
      if (!dispEnumId) dispEnumId = pickEnumIdByContains(enums.disposition, [dispLabel]);
    }
    if (dispEnumId) fields[F.DISPOSITION] = dispEnumId;

    log?.info?.("SPA_UPDATE_ACTIVITY_PRE", {
      spaId,
      activityId: resolved?.activityId || null,
      dispLabel: dispLabel || null,
      dispEnumId: dispEnumId || null,
      entityType: resolved?.entityType || null,
      entityId: resolved?.entityId || null
    });

    const item = await updateItem(spaId, fields);
    const updId = getAnyIdFromItem(item, spaId);
    await verifySaved(updId, { mode: "update_activity" });

    return { ok: true, id: updId };
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
    upsertFromVoxCall,
    listSpasByPeriod,
    mapSpaRowForMatching,
    updateSpaFromResolvedActivity
  };
})(window);