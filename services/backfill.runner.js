(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;
  const refs = App.ui.refs;

  const Telephony = App.svc.TelephonyProvider;
  const Activity = App.svc.ActivityProvider;
  const SPA = App.svc.SpaProvider;

  if (!Telephony || typeof Telephony.getCalls !== "function") {
    throw new Error("TelephonyProvider não carregou (App.svc.TelephonyProvider.getCalls ausente).");
  }
  if (!Activity || typeof Activity.getActivities !== "function") {
    throw new Error("ActivityProvider não carregou (App.svc.ActivityProvider.getActivities ausente).");
  }
  if (!SPA || typeof SPA.upsertFromVoxCall !== "function") {
    throw new Error("SpaProvider não carregou (App.svc.SpaProvider.upsertFromVoxCall ausente).");
  }

  App.state = App.state || {};
  App.state.backfill = App.state.backfill || { running: false, canceled: false };

  function setButtons(running) {
    refs.btnStart.disabled = !!running;
    refs.btnStop.disabled = !running;
  }

  function setStat(kEl, vEl, label, val) {
    if (kEl) kEl.textContent = label;
    if (vEl) vEl.textContent = String(val);
  }

  function setProgress(pct, meta) {
    if (refs.progressBar) refs.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (refs.progressMeta) refs.progressMeta.textContent = meta || "";
  }

  function computeRangeFromUi() {
    const preset = refs.presetSel.value;
    const now = new Date();

    function ymd(d) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    if (preset === "custom") {
      const df = refs.dateFrom.value;
      const dt = refs.dateTo.value;
      if (!df || !dt) return { error: "Selecione data inicial e final." };
      const { dateFromIso, dateToIso } = BX.isoLocalStartEndFromDates(df, dt);
      if (new Date(dateFromIso) > new Date(dateToIso)) return { error: "Data inicial maior que final." };
      return { dateFromIso, dateToIso };
    }

    const days = parseInt(preset.replace("d", ""), 10) || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - (days - 1));
    const df = ymd(start);
    const dt = ymd(now);
    return BX.isoLocalStartEndFromDates(df, dt);
  }

  function configureUiForMode(mode) {
    // Reset labels/values
    setProgress(0, "Aguardando...");

    if (mode === "VOX_TO_SPA") {
      setStat(refs.stK1, refs.stV1, "Chamadas", 0);
      setStat(refs.stK2, refs.stV2, "Criados", 0);
      setStat(refs.stK3, refs.stV3, "Atualizados", 0);
      setStat(refs.stK4, refs.stV4, "—", 0);
      setStat(refs.stK5, refs.stV5, "—", 0);
      setStat(refs.stK6, refs.stV6, "Erros", 0);
      return;
    }

    // ACTIVITY_TO_SPA
    setStat(refs.stK1, refs.stV1, "SPAs", 0);
    setStat(refs.stK2, refs.stV2, "Vinculados", 0);
    setStat(refs.stK3, refs.stV3, "Já tinham vínculo", 0);
    setStat(refs.stK4, refs.stV4, "Sem match", 0);
    setStat(refs.stK5, refs.stV5, "Ambíguos", 0);
    setStat(refs.stK6, refs.stV6, "Erros", 0);
  }

  async function runVoxToSpa(range, chunkDays) {
    const counters = { total: 0, done: 0, created: 0, updated: 0, errors: 0 };

    const chunks = BX.splitIntoChunks(range.dateFromIso, range.dateToIso, chunkDays);
    log.info(`(Modo 1) Vox → SPA | chunks=${chunks.length} chunkDays=${chunkDays}`);

    for (let ci = 0; ci < chunks.length; ci++) {
      if (App.state.backfill.canceled) throw new Error("CANCELED");

      const ch = chunks[ci];
      setProgress(
        Math.round((ci / Math.max(1, chunks.length)) * 100),
        `Chunk ${ci + 1}/${chunks.length} | carregando Vox...`
      );

      const calls = await Telephony.getCalls(ch.dateFrom, ch.dateTo);
      counters.total += calls.length;

      setStat(refs.stK1, refs.stV1, "Chamadas", counters.total);
      setStat(refs.stK2, refs.stV2, "Criados", counters.created);
      setStat(refs.stK3, refs.stV3, "Atualizados", counters.updated);
      setStat(refs.stK6, refs.stV6, "Erros", counters.errors);

      if (!calls.length) {
        log.info(`Chunk ${ci + 1}/${chunks.length}: calls=0`);
        continue;
      }

      for (let i = 0; i < calls.length; i++) {
        if (App.state.backfill.canceled) throw new Error("CANCELED");

        const c = calls[i];
        const callId = String(c.CALL_ID || c.ID || "");

        try {
          const r = await SPA.upsertFromVoxCall(c);
          if (r.mode === "created") counters.created++;
          else if (r.mode === "updated") counters.updated++;
        } catch (e) {
          counters.errors++;
          log.error(`Falha Vox→SPA call=${callId}`, {
            msg: (e && e.message) ? e.message : String(e),
            stack: e && e.stack ? String(e.stack).slice(0, 1200) : null
          });
        }

        counters.done++;
        if (i % 10 === 0 || i === calls.length - 1) {
          setStat(refs.stK2, refs.stV2, "Criados", counters.created);
          setStat(refs.stK3, refs.stV3, "Atualizados", counters.updated);
          setStat(refs.stK6, refs.stV6, "Erros", counters.errors);

          const pct = Math.round((counters.done / Math.max(1, counters.total)) * 100);
          setProgress(pct, `Processando ${counters.done}/${counters.total} (chunk ${ci + 1}/${chunks.length})`);
        }

        if (i % 25 === 0) await new Promise(r => setTimeout(r, 30));
      }

      log.info(`Chunk ${ci + 1} concluído.`);
    }

    return counters;
  }

  async function runActivityToSpa(range, chunkDays, opts) {
    const counters = { total: 0, linked: 0, already: 0, nomatch: 0, amb: 0, errors: 0 };

    const chunks = BX.splitIntoChunks(range.dateFromIso, range.dateToIso, chunkDays);
    const windowMin = parseInt(App.config.MATCH_WINDOW_MIN_FIXED, 10) || 3;
    const windowMs = Math.max(60_000, windowMin * 60_000);

    log.info(`(Modo 2) Activity → SPA | chunks=${chunks.length} chunkDays=${chunkDays} windowMin(fixo)=${windowMin}`);

    for (let ci = 0; ci < chunks.length; ci++) {
      if (App.state.backfill.canceled) throw new Error("CANCELED");

      const ch = chunks[ci];

      setProgress(
        Math.round((ci / Math.max(1, chunks.length)) * 100),
        `Chunk ${ci + 1}/${chunks.length} | carregando SPAs...`
      );

      const spaRowsRaw = await SPA.listSpasByPeriod(
        ch.dateFrom,
        ch.dateTo,
        !!opts.onlyMissingActivity && !opts.forceRelink
      );

      const spaRows = spaRowsRaw
        .map(r => SPA.mapSpaRowForMatching(r, Activity))
        .filter(x => x && x.id);

      counters.total += spaRows.length;
      setStat(refs.stK1, refs.stV1, "SPAs", counters.total);

      if (!spaRows.length) {
        log.info(`Chunk ${ci + 1}/${chunks.length}: spas=0`);
        continue;
      }

      // quais responsáveis existem nessas SPAs?
      const respIds = Array.from(new Set(spaRows.map(s => String(s.userId || "").trim()).filter(Boolean)));

      // janela do chunk com padding
      function shiftIso(iso, minutes) {
        const d = new Date(iso);
        d.setMinutes(d.getMinutes() + minutes);
        return BX.nowIsoFromDate(d);
      }

      const pad = Math.max(2, windowMin);
      const actFrom = shiftIso(ch.dateFrom, -pad);
      const actTo   = shiftIso(ch.dateTo, +pad);

      setProgress(
        Math.round((ci / Math.max(1, chunks.length)) * 100),
        `Chunk ${ci + 1}/${chunks.length} | carregando Activities...`
      );

      const acts = await Activity.getActivities(actFrom, actTo, respIds);
      const actByResp = Activity.indexActivitiesByResponsible(acts);

      log.info(`Chunk ${ci + 1}/${chunks.length}: spas=${spaRows.length}, activities=${acts.length}`);

      for (let i = 0; i < spaRows.length; i++) {
        if (App.state.backfill.canceled) throw new Error("CANCELED");

        const s = spaRows[i];

        const hasAct = !!String(s.existingActivityId || "").trim();

        // se não for force relink e já tem vínculo -> contabiliza e pula
        if (hasAct && !opts.forceRelink) {
          counters.already++;
          continue;
        }

        const resolved = Activity.resolveForSpaRow(s, actByResp, windowMs);

        if (resolved.ambiguity) {
          counters.amb++;
          log.warn(`AMBIGUOUS spa=${s.id}`, { candidates: resolved.candidates || [] });
        }

        if (!resolved.activityId) {
          counters.nomatch++;
          continue;
        }

        try {
          await SPA.updateSpaFromResolvedActivity(s.id, resolved, { forceRelink: opts.forceRelink });
          counters.linked++;
        } catch (e) {
          counters.errors++;
          log.error(`Falha Activity→SPA spa=${s.id}`, {
            msg: (e && e.message) ? e.message : String(e),
            stack: e && e.stack ? String(e.stack).slice(0, 1200) : null
          });
        }

        if (i % 10 === 0 || i === spaRows.length - 1) {
          setStat(refs.stK2, refs.stV2, "Vinculados", counters.linked);
          setStat(refs.stK3, refs.stV3, "Já tinham vínculo", counters.already);
          setStat(refs.stK4, refs.stV4, "Sem match", counters.nomatch);
          setStat(refs.stK5, refs.stV5, "Ambíguos", counters.amb);
          setStat(refs.stK6, refs.stV6, "Erros", counters.errors);

          const processed = (counters.linked + counters.already + counters.nomatch + counters.errors);
          const pct = Math.round((processed / Math.max(1, counters.total)) * 100);
          setProgress(pct, `Processando ${processed}/${counters.total} (chunk ${ci + 1}/${chunks.length})`);
        }

        if (i % 25 === 0) await new Promise(r => setTimeout(r, 30));
      }

      log.info(`Chunk ${ci + 1} concluído.`);
    }

    return counters;
  }

  async function start() {
    App.state.backfill.running = true;
    App.state.backfill.canceled = false;
    setButtons(true);

    try {
      const mode = App.state.mode || "VOX_TO_SPA";

      configureUiForMode(mode);
      setProgress(0, "Preparando...");

      await SPA.loadEnums();

      const range = computeRangeFromUi();
      if (range.error) {
        log.warn("Filtro inválido: " + range.error);
        setProgress(0, "Filtro inválido.");
        return;
      }

      const chunkDays = parseInt(refs.chunkDays.value, 10) || (App.config.DEFAULT_CHUNK_DAYS || 7);

      log.info("Iniciando execução", { mode, range, chunkDays });

      let counters = null;

      if (mode === "VOX_TO_SPA") {
        counters = await runVoxToSpa(range, chunkDays);
        setProgress(100, "✅ Concluído (Vox → SPA).");
        log.info("✅ TAREFA CONCLUÍDA (Modo 1)", counters);
        alert(`✅ Concluído (Vox → SPA)\n\nChamadas: ${counters.total}\nCriados: ${counters.created}\nAtualizados: ${counters.updated}\nErros: ${counters.errors}`);
        return;
      }

      const opts = {
        onlyMissingActivity: !!refs.actOnlyMissing?.checked,
        forceRelink: !!refs.actForceRelink?.checked
      };

      counters = await runActivityToSpa(range, chunkDays, opts);
      setProgress(100, "✅ Concluído (Activity → SPA).");
      log.info("✅ TAREFA CONCLUÍDA (Modo 2)", counters);
      alert(
        `✅ Concluído (Activity → SPA)\n\nSPAs: ${counters.total}\nVinculados: ${counters.linked}\nJá tinham vínculo: ${counters.already}\nSem match: ${counters.nomatch}\nAmbíguos: ${counters.amb}\nErros: ${counters.errors}`
      );

    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg === "CANCELED") {
        log.warn("⛔ Backfill interrompido pelo usuário.");
        setProgress(0, "Interrompido.");
      } else {
        log.error("Erro fatal no backfill", msg);
        setProgress(0, "Erro fatal.");
        alert("Erro fatal no backfill: " + msg);
      }
    } finally {
      App.state.backfill.running = false;
      App.state.backfill.canceled = false;
      setButtons(false);
    }
  }

  function stop() {
    if (!App.state.backfill.running) return;
    App.state.backfill.canceled = true;
    log.warn("Solicitação de parada enviada...");
  }

  function startFromUi() {
    if (App.state.backfill.running) return;
    start();
  }

  App.svc.BackfillRunner = { startFromUi, stop, configureUiForMode };
})(window);