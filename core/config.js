(function (global) {
  const App = global.App = global.App || {};

  App.config.ENTITY_TYPE_ID = 1068;

  App.config.FIELD_CODES = {
    TELEPHONY_CALL_ID: "ufCrm12_1769103594",
    CRM_ACTIVITY_ID:   "ufCrm12_1769103691",
    DEDUP_KEY:         "ufCrm12_1769103795",
    USER_ID:           "ufCrm12_1769103861",
    USER_NAME:         "ufCrm12_1769103932",
    CALL_DIRECTION:    "ufCrm12_1769103994",
    PHONE_NUMBER:      "ufCrm12_1769104069",
    CALL_STATUS_CODE:  "ufCrm12_1769104141",
    CALL_START_DT:     "ufCrm12_1769104245",
    CALL_DURATION:     "ufCrm12_1769104293",
    ANSWERED:          "ufCrm12_1769104391",
    DISPOSITION:       "ufCrm12_1769104508",
    DISPOSITION_RAW:   "ufCrm12_1769104556",
    ENTITY_TYPE:       "ufCrm12_1769104880",
    ENTITY_ID:         "ufCrm12_1769104915",
    CREATED_AT:        "ufCrm12_1769104953",
    UPDATED_AT:        "ufCrm12_1769104996",
    SYNCED_AT:         "ufCrm12_1769105024"
  };

  // Debug
  App.config.DEBUG_VERIFY_SAVE = true;

  // ✅ JANELA FIXA (não é input do usuário)
  App.config.MATCH_WINDOW_MIN_FIXED = 3;   // <<<<<<<<<<<<<<<< ajuste aqui se precisar
  App.config.MATCH_MAX_CANDIDATES_LOG = 5;

  // Chunk defaults (UI inicia com 7, mas você pode forçar aqui se quiser)
  App.config.DEFAULT_CHUNK_DAYS = 7;

  // Disposition parsing
  App.config.ACTIVITY_RESULT_PREFIX = "[DISPOSITION]";
  App.config.DISPOSITIONS = [
    "REUNIÃO AGENDADA",
    "FALEI COM SECRETÁRIA",
    "FOLLOW-UP",
    "RETORNO POR E-MAIL",
    "NÃO TEM INTERESSE",
    "NÃO FAZ LOCAÇÃO",
    "CAIXA POSTAL",
    "CHAMADA OCUPADA",
    "DESLIGOU",
    "CHAMADA PERDIDA",
    "NÚMERO INCORRETO"
  ];

  // Se um dia vocês quiserem voltar a “carimbar” disposition na Activity:
  App.config.WRITE_DISPOSITION_TO_ACTIVITY = false;
  App.config.ACTIVITY_PREPEND_TO_DESCRIPTION = false;
})(window);