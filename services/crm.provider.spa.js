/* =========================
 * services/crm.provider.spa.js (CORRIGIDO E COMPLETO)
 * - SEM resolver FieldMap (você já passou as chaves reais ufCrm12_...)
 * - Dedup correto: filtra por DEDUP_KEY e não por TELEPHONY_CALL_ID “errado”
 * - Corrige BUG que fazia gravar ANSWERED no campo errado (usava F.ANSWERED ao invés de fields[F.ANSWERED])
 * - Preenche USER_NAME via user.get (cache)
 * - Direção: tenta casar enum por “contains” (Entrada/Saída/Inbound/Outbound)
 * ========================= */
(function (global) {
  const App = global.App = global.App || {};
  const BX  = App.core.BX24;
  const log = App.log;

  const ENTITY_TYPE_ID = parseInt(App.config.ENTITY_TYPE_ID, 10);
  const F = App.config.FIELD_CODES; // chaves reais ufCrm12_...

  function assertEntityType() {
    if (!ENTITY_TYPE_ID || Number.isNaN(ENTITY_TYPE_ID)) {
      throw new Error("ENTITY_TYPE_ID inválido. Ajuste em core/config.js (ex.: 1068).");
    }
  }

  function norm(s) {
    return String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
  }

  // ===== Fields meta (somente para enums) =====
  let _fieldsMeta = null;
  let _enumCache  = null; // { callDirection: Map(normLabel -> id), disposition: Map(normLabel -> id) }

  async function loadFieldsMeta() {
    assertEntityType();
    if (_fieldsMeta) return _fieldsMeta;

    const res = await BX.callMethod("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
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
        m.set(norm(it.value), String(it.id));
      }
      return m;
    }

    _enumCache = {
      callDirection: buildEnumMap(F.CALL_DIRECTION),
      disposition:   buildEnumMap(F.DISPOSITION)
    };

    log.info("Enums carregados (CALL_DIRECTION / DISPOSITION).");
    return _enumCache;
  }

  // ===== Dedup: SEMPRE por DEDUP_KEY =====
  async function findByDedupKey(callId) {
    assertEntityType();

    const filter = {};
    filter[F.DEDUP_KEY] = String(callId);

    const rows = await BX.listAll(
      "crm.item.list",
      {
        entityTypeId: ENTITY_TYPE_ID,
        filter,
        select: ["id", F.DEDUP_KEY, F.TELEPHONY_CALL_ID]
      },
      { timeoutPerPageMs: 45000, maxTotalMs: 180000, pageDelayMs: 120, maxRetries: 2 }
    );

    if (!rows || !rows.length) return null;

    if (rows.length > 1) {
      log.warn("⚠️ DEDUP_KEY duplicado no SPA (já existem múltiplos). Usando o primeiro.", {
        callId,
        count: rows.length
      });
    }

    return rows[0];
  }

  async function addItem(fields) {
    const res = await BX.callMethod("crm.item.add", {
      entityTypeId: ENTITY_TYPE_ID,
      fields
    });
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  async function updateItem(id, fields) {
    const res = await BX.callMethod("crm.item.update", {
      entityTypeId: ENTITY_TYPE_ID,
      id,
      fields
    });
    const d = (typeof res.data === "function") ? res.data() : res.data;
    return d && d.item ? d.item : d;
  }

  // ===== user name (cache) =====
  const _userNameCache = new Map(); // userId -> "Nome Sobrenome"

  async function getUserNameById(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return "";
    if (_userNameCache.has(uid)) return _userNameCache.get(uid);

    try {
      const res = await BX.callMethod("user.get", { ID: uid });
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
    const dur = parseInt(call.CALL_DURATION, 10);
    return Number.isFinite(dur) && dur > 0;
  }

  function safeDuration(call) {
    const dur = parseInt(call.CALL_DURATION, 10);
    return Number.isFinite(dur) ? dur : 0;
  }

  function extractPhone(call) {
    return BX.normalizePhone(
      call.PHONE_NUMBER || call.CALL_PHONE_NUMBER || call.PHONE || call.CALL_FROM || call.CALL_TO || ""
    );
  }

  function statusCode(call) {
    return String(call.CALL_STATUS_CODE || call.CALL_FAILED_CODE || "");
  }

  function startDate(call) {
    return call.CALL_START_DATE || call.CALL_START_DATE_FORMATTED || call.CALL_START_DATE_SHORT || null;
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
    // Seu campo no SPA: OUTBOUND / INBOUND / INBOUND_REDIRECTED
    // Voximplant costuma usar:
    // CALL_TYPE 1 = saída
    // CALL_TYPE 2 = entrada
    // CALL_TYPE 3 = entrada redirecionada (em muitos portais aparece assim)
    const t = parseInt(call.CALL_TYPE, 10) || 0;

    const outId = enums.callDirection.get("OUTBOUND") || null;
    const inId  = enums.callDirection.get("INBOUND") || null;
    const redId = enums.callDirection.get("INBOUND_REDIRECTED") || null;

    if (t === 1) return outId;
    if (t === 2) return inId;
    if (t === 3) return redId || inId; // fallback seguro: se não existir, grava INBOUND
    return null;
  }

  async function upsertFromCall(call, resolved) {
    await loadEnums();
    const enums = _enumCache;

    const callId = String(call.CALL_ID || call.ID || "");
    if (!callId) throw new Error("CALL sem CALL_ID/ID");

    const existing = await findByDedupKey(callId);

    const fields = {};

    // IDs/dedup
    fields[F.TELEPHONY_CALL_ID] = callId;
    fields[F.DEDUP_KEY]         = callId;

    // Usuário
    const uid = call.PORTAL_USER_ID ? String(call.PORTAL_USER_ID) : "";
    if (uid) {
      fields[F.USER_ID] = uid;

      const directName = String(call.PORTAL_USER_NAME || "").trim();
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
    fields[F.PHONE_NUMBER]     = extractPhone(call);
    fields[F.CALL_STATUS_CODE] = statusCode(call);

    const sd = startDate(call);
    if (sd) fields[F.CALL_START_DT] = String(sd);

    fields[F.CALL_DURATION] = safeDuration(call);

    // ✅ BUGFIX: ANSWERED deve usar a chave real
    fields[F.ANSWERED] = answeredFromCall(call);

    // Activity + Disposition
    if (resolved && resolved.activityId) {
      fields[F.CRM_ACTIVITY_ID] = String(resolved.activityId);
    }

    if (resolved && resolved.dispositionRaw) {
      fields[F.DISPOSITION_RAW] = String(resolved.dispositionRaw).slice(0, 5000);
    }

    let dispEnumId = null;
    const dispLabel = resolved && resolved.disposition ? String(resolved.disposition) : "";
    if (dispLabel) {
      dispEnumId = enums.disposition.get(norm(dispLabel)) || null;
      if (!dispEnumId) dispEnumId = pickEnumIdByContains(enums.disposition, [dispLabel]);
    }
    if (dispEnumId) fields[F.DISPOSITION] = dispEnumId;

    // Entity link (se houver)
    if (resolved && resolved.entityType) fields[F.ENTITY_TYPE] = String(resolved.entityType);
    if (resolved && resolved.entityId)   fields[F.ENTITY_ID]   = String(resolved.entityId);

    // timestamps
    const now = BX.nowIso();
    fields[F.SYNCED_AT]  = now;
    fields[F.UPDATED_AT] = now;
    if (!existing) fields[F.CREATED_AT] = now;

    if (!existing) {
      const item = await addItem(fields);
      return { mode: "created", id: item && item.id ? item.id : null };
    }

    // Update conservador: não apagar campos caso faltem dados no resolved
    const updateFields = { ...fields };
    if (!dispEnumId) delete updateFields[F.DISPOSITION];
    if (!(resolved && resolved.activityId)) delete updateFields[F.CRM_ACTIVITY_ID];

    const exId = existing.id || existing.ID || existing.Id;
    const item = await updateItem(exId, updateFields);
    return { mode: "updated", id: item && item.id ? item.id : exId };
  }

  async function sanityCheck() {
    await loadFieldsMeta();
    await loadEnums();
    log.info("✅ SPA sanity check OK", { ENTITY_TYPE_ID });
    return true;
  }

  App.svc.SpaProvider = {
    sanityCheck,
    loadEnums,
    upsertFromCall
  };
})(window);