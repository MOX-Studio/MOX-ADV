import { cleanText } from "./text.ts";

export const ACCESS_SCOPES = [
  {
    id: "DIRECT_READ",
    label: "Яндекс Директ",
    purpose: "Текущие кампании, настройки и доступная история рекламы — только чтение.",
  },
  {
    id: "METRIKA_READ",
    label: "Яндекс Метрика",
    purpose: "Счётчик, цели и доступная статистика результата — только чтение.",
  },
  {
    id: "WORDSTAT_READ",
    label: "Яндекс Wordstat",
    purpose: "Спрос и сезонность по разрешённым формулировкам — только чтение.",
  },
] as const;

export type AccessPath = "EXISTING_ADVERTISER" | "NEW_ADVERTISER";
export type AccessScopeId = typeof ACCESS_SCOPES[number]["id"];
export type EvidenceAvailability = "AVAILABLE" | "UNAVAILABLE";
export type AccessStatus =
  | "PATH_REQUIRED"
  | "CONSENT_REQUIRED"
  | "SELECTION_REQUIRED"
  | "READY"
  | "LIMITED"
  | "ACTIVE"
  | "ACTIVE_LIMITED"
  | "BLOCKED"
  | "REVOKED";

type DiscoveredChoice = {
  opaque_handle: string;
  provider_identity: string;
  label: string;
  detail: string;
};

export type AccessReadinessState = {
  revision: number;
  path: AccessPath | null;
  status: AccessStatus;
  requested_scopes: AccessScopeId[];
  consent: { recorded_at: string; revoked_at: string | null } | null;
  discovery: {
    accounts: DiscoveredChoice[];
    counters: DiscoveredChoice[];
  };
  binding: {
    account_identity: string;
    counter_identity: string;
    verified_at: string;
    direct_matched: boolean;
    metrika_matched: boolean;
  } | null;
  scope: {
    direct: EvidenceAvailability;
    metrika: EvidenceAvailability;
    wordstat: EvidenceAvailability;
  };
  limitations: string[];
  updated_at: string;
};

export type AccessStoredRow = {
  revision: number;
  updated_at: string;
  value_json: string;
};

export interface AccessReadinessStore {
  load(key: string): Promise<AccessStoredRow | null>;
  initialize(key: string, row: AccessStoredRow): Promise<boolean>;
  compareAndSwap(key: string, expectedRevision: number, row: AccessStoredRow): Promise<boolean>;
}

export type AccessDiscovery = {
  scopes: {
    direct: { granted: boolean };
    metrika: { granted: boolean };
    wordstat: { granted: boolean };
  };
  accounts: Array<{ provider_identity: string; label: string; detail?: string }>;
  counters: Array<{ provider_identity: string; label: string; detail?: string }>;
};

export type AccessBindingVerification = {
  direct: { matched: boolean; scope_granted: boolean };
  metrika: { matched: boolean; scope_granted: boolean };
  wordstat: { scope_granted: boolean };
};

export interface AccessReadinessAdapter {
  discover(): Promise<AccessDiscovery>;
  verifyBinding(input: { accountIdentity: string; counterIdentity: string }): Promise<AccessBindingVerification>;
}

export type AccessReadinessProjection = {
  path: "existing" | "new" | null;
  status: "choose-path" | "needs-consent" | "needs-selection" | "ready" | "limited" | "blocked" | "revoked";
  headline: string;
  summary: string;
  scopes: Array<{
    label: string;
    purpose: string;
    availability: "Нужно разрешение" | "Доступен" | "Недоступен";
  }>;
  accountChoices: Array<{ handle: string; label: string; detail: string }>;
  counterChoices: Array<{ handle: string; label: string; detail: string }>;
  history: { availability: "Доступна" | "Недоступна"; explanation: string };
  limitations: string[];
  canRevoke: boolean;
};

function emptyState(now: string): AccessReadinessState {
  return {
    revision: 0,
    path: null,
    status: "PATH_REQUIRED",
    requested_scopes: [],
    consent: null,
    discovery: { accounts: [], counters: [] },
    binding: null,
    scope: { direct: "UNAVAILABLE", metrika: "UNAVAILABLE", wordstat: "UNAVAILABLE" },
    limitations: [],
    updated_at: now,
  };
}

function choiceHandle() {
  return `choice_${crypto.randomUUID().replaceAll("-", "")}`;
}

function sanitizeChoice(choice: AccessDiscovery["accounts"][number]): DiscoveredChoice {
  return {
    opaque_handle: choiceHandle(),
    provider_identity: cleanText(choice.provider_identity, 255),
    label: cleanText(choice.label, 255),
    detail: cleanText(choice.detail ?? "Доступный бизнес-профиль", 500),
  };
}

function parse(row: AccessStoredRow): AccessReadinessState {
  const state = JSON.parse(row.value_json) as AccessReadinessState;
  if (state.revision !== row.revision) throw new Error("Access Readiness durable revision mismatch.");
  return state;
}

function availability(value: EvidenceAvailability, consentRequired: boolean) {
  if (consentRequired) return "Нужно разрешение" as const;
  return value === "AVAILABLE" ? "Доступен" as const : "Недоступен" as const;
}

function projectionStatus(status: AccessStatus): AccessReadinessProjection["status"] {
  if (status === "PATH_REQUIRED") return "choose-path";
  if (status === "CONSENT_REQUIRED") return "needs-consent";
  if (status === "SELECTION_REQUIRED") return "needs-selection";
  if (status === "READY" || status === "ACTIVE") return "ready";
  if (status === "LIMITED" || status === "ACTIVE_LIMITED") return "limited";
  if (status === "REVOKED") return "revoked";
  return "blocked";
}

function headline(state: AccessReadinessState) {
  if (state.status === "PATH_REQUIRED") return "Выберите исходную ситуацию";
  if (state.path === "NEW_ADVERTISER") return "Новый рекламодатель: начинаем без истории аккаунта";
  if (state.status === "CONSENT_REQUIRED") return "Нужно разрешение на чтение данных";
  if (state.status === "SELECTION_REQUIRED") return "Выберите понятный бизнес-аккаунт и счётчик";
  if (state.status === "READY" || state.status === "ACTIVE") return "Доступ подтверждён";
  if (state.status === "LIMITED" || state.status === "ACTIVE_LIMITED") return "Доступ подтверждён с ограничениями";
  if (state.status === "REVOKED") return "Доступ отозван";
  return "Доступ не прошёл безопасную проверку";
}

function summary(state: AccessReadinessState) {
  if (state.status === "PATH_REQUIRED") return "Это определит, какие данные действительно существуют и могут использоваться.";
  if (state.path === "NEW_ADVERTISER") return "Агент использует публичные и подтверждённые бизнес-факты; отсутствующая история не заменяется нулями или выдуманными данными.";
  if (state.status === "CONSENT_REQUIRED") return "Разрешение остаётся решением владельца. Доступ только на чтение и может быть отозван.";
  if (state.status === "SELECTION_REQUIRED") return "Внутренние идентификаторы уже найдены официальными API и не требуют ручного ввода.";
  if (["READY", "ACTIVE", "LIMITED", "ACTIVE_LIMITED"].includes(state.status)) return "Агент использует только фактически подтверждённый объём данных.";
  return "Частные данные и инструменты недоступны, пока владелец заново не подтвердит доступ.";
}

export function accessProfileForOwner(state: AccessReadinessState) {
  const existingActive = state.path === "EXISTING_ADVERTISER" && ["READY", "LIMITED", "ACTIVE", "ACTIVE_LIMITED"].includes(state.status);
  return {
    path: state.path,
    evidence_scope: {
      direct: existingActive ? state.scope.direct : "UNAVAILABLE" as const,
      metrika: existingActive ? state.scope.metrika : "UNAVAILABLE" as const,
      wordstat: existingActive ? state.scope.wordstat : "UNAVAILABLE" as const,
      account_history: existingActive && state.scope.direct === "AVAILABLE" ? "AVAILABLE" as const : "UNAVAILABLE" as const,
    },
    limitations: [...state.limitations],
  };
}

export class AccessReadinessService {
  private readonly store: AccessReadinessStore;
  private readonly adapter: AccessReadinessAdapter;
  private readonly now: () => string;

  constructor(input: { store: AccessReadinessStore; adapter: AccessReadinessAdapter; now: () => string }) {
    this.store = input.store;
    this.adapter = input.adapter;
    this.now = input.now;
  }

  async get(key: string, refresh = false) {
    let row = await this.store.load(key);
    if (!row) {
      const state = emptyState(this.now());
      const initial = { revision: 0, updated_at: state.updated_at, value_json: JSON.stringify(state) };
      if (await this.store.initialize(key, initial)) return state;
      row = await this.store.load(key);
    }
    if (!row) throw new Error("Access Readiness state initialization failed.");
    const state = parse(row);
    if (refresh && state.path === "EXISTING_ADVERTISER" && ["READY", "LIMITED", "ACTIVE", "ACTIVE_LIMITED"].includes(state.status)) {
      return this.refreshBinding(key, state);
    }
    return state;
  }

  project(state: AccessReadinessState): AccessReadinessProjection {
    const consentRequired = state.status === "CONSENT_REQUIRED";
    const profile = accessProfileForOwner(state);
    return {
      path: state.path === "EXISTING_ADVERTISER" ? "existing" : state.path === "NEW_ADVERTISER" ? "new" : null,
      status: projectionStatus(state.status),
      headline: headline(state),
      summary: summary(state),
      scopes: ACCESS_SCOPES.map((scope) => {
        const key = scope.id === "DIRECT_READ" ? "direct" : scope.id === "METRIKA_READ" ? "metrika" : "wordstat";
        return { label: scope.label, purpose: scope.purpose, availability: availability(state.scope[key], consentRequired) };
      }),
      accountChoices: state.discovery.accounts.map((choice) => ({ handle: choice.opaque_handle, label: choice.label, detail: choice.detail })),
      counterChoices: state.discovery.counters.map((choice) => ({ handle: choice.opaque_handle, label: choice.label, detail: choice.detail })),
      history: {
        availability: profile.evidence_scope.account_history === "AVAILABLE" ? "Доступна" : "Недоступна",
        explanation: profile.evidence_scope.account_history === "AVAILABLE"
          ? "Используется только история выбранного и проверенного рекламодателя."
          : "История аккаунта отсутствует или доступ к ней не подтверждён; это не нулевой результат.",
      },
      limitations: [...state.limitations],
      canRevoke: state.path === "EXISTING_ADVERTISER" && state.consent !== null && state.consent.revoked_at === null,
    };
  }

  async choosePath(key: string, path: AccessPath) {
    const state = await this.get(key);
    const timestamp = this.now();
    const next = path === "NEW_ADVERTISER"
      ? {
          ...emptyState(timestamp),
          revision: state.revision + 1,
          path,
          status: "ACTIVE" as const,
          limitations: ["История рекламного аккаунта недоступна для нового рекламодателя и не заменяется нулём или выдуманным значением."],
        }
      : {
          ...emptyState(timestamp),
          revision: state.revision + 1,
          path,
          status: "CONSENT_REQUIRED" as const,
          requested_scopes: ACCESS_SCOPES.map((scope) => scope.id),
        };
    return this.save(key, state.revision, next);
  }

  async grantConsent(key: string, expectedRevision: number) {
    const state = await this.expect(key, expectedRevision, ["CONSENT_REQUIRED", "BLOCKED", "REVOKED"]);
    const discovered = await this.adapter.discover();
    const limitations = [
      ...(!discovered.scopes.direct.granted ? ["Данные Директа недоступны в подтверждённом scope."] : []),
      ...(!discovered.scopes.metrika.granted ? ["Данные Метрики недоступны в подтверждённом scope."] : []),
      ...(!discovered.scopes.wordstat.granted ? ["Данные Wordstat недоступны в подтверждённом scope."] : []),
    ];
    const timestamp = this.now();
    const accounts = discovered.accounts.map(sanitizeChoice);
    const counters = discovered.counters.map(sanitizeChoice);
    const selectable = discovered.scopes.direct.granted && discovered.scopes.metrika.granted && accounts.length > 0 && counters.length > 0;
    return this.save(key, state.revision, {
      ...state,
      revision: state.revision + 1,
      status: selectable ? "SELECTION_REQUIRED" : "BLOCKED",
      consent: { recorded_at: timestamp, revoked_at: null },
      discovery: { accounts, counters },
      binding: null,
      scope: {
        direct: discovered.scopes.direct.granted ? "AVAILABLE" : "UNAVAILABLE",
        metrika: discovered.scopes.metrika.granted ? "AVAILABLE" : "UNAVAILABLE",
        wordstat: discovered.scopes.wordstat.granted ? "AVAILABLE" : "UNAVAILABLE",
      },
      limitations,
      updated_at: timestamp,
    });
  }

  async selectBinding(key: string, expectedRevision: number, accountHandle: string, counterHandle: string) {
    const state = await this.expect(key, expectedRevision, ["SELECTION_REQUIRED"]);
    const account = state.discovery.accounts.find((choice) => choice.opaque_handle === accountHandle);
    const counter = state.discovery.counters.find((choice) => choice.opaque_handle === counterHandle);
    if (!account || !counter) throw new Error("Выбранный бизнес-профиль больше недоступен.");
    const verified = await this.adapter.verifyBinding({ accountIdentity: account.provider_identity, counterIdentity: counter.provider_identity });
    return this.applyVerification(key, state, account.provider_identity, counter.provider_identity, verified);
  }

  async activate(key: string, expectedRevision: number) {
    const state = await this.expect(key, expectedRevision, ["READY", "LIMITED"]);
    return this.save(key, state.revision, {
      ...state,
      revision: state.revision + 1,
      status: state.status === "LIMITED" ? "ACTIVE_LIMITED" : "ACTIVE",
      updated_at: this.now(),
    });
  }

  async revoke(key: string, expectedRevision: number) {
    const state = await this.expect(key, expectedRevision, ["READY", "LIMITED", "ACTIVE", "ACTIVE_LIMITED"]);
    const timestamp = this.now();
    return this.save(key, state.revision, {
      ...state,
      revision: state.revision + 1,
      status: "REVOKED",
      consent: state.consent ? { ...state.consent, revoked_at: timestamp } : null,
      binding: null,
      discovery: { accounts: [], counters: [] },
      scope: { direct: "UNAVAILABLE", metrika: "UNAVAILABLE", wordstat: "UNAVAILABLE" },
      limitations: ["Доступ отозван владельцем; частные данные и связанные инструменты недоступны."],
      updated_at: timestamp,
    });
  }

  private async refreshBinding(key: string, state: AccessReadinessState) {
    if (!state.binding) return state;
    const verified = await this.adapter.verifyBinding({
      accountIdentity: state.binding.account_identity,
      counterIdentity: state.binding.counter_identity,
    });
    const nextStatus = this.verificationStatus(verified);
    const expectedScope = {
      direct: verified.direct.scope_granted && verified.direct.matched ? "AVAILABLE" : "UNAVAILABLE",
      metrika: verified.metrika.scope_granted && verified.metrika.matched ? "AVAILABLE" : "UNAVAILABLE",
      wordstat: verified.wordstat.scope_granted ? "AVAILABLE" : "UNAVAILABLE",
    };
    const sameScope = JSON.stringify(expectedScope) === JSON.stringify(state.scope);
    if (sameScope && (nextStatus === state.status
      || (state.status === "ACTIVE" && nextStatus === "READY")
      || (state.status === "ACTIVE_LIMITED" && nextStatus === "LIMITED"))) return state;
    return this.applyVerification(key, state, state.binding.account_identity, state.binding.counter_identity, verified);
  }

  private verificationStatus(verified: AccessBindingVerification): "READY" | "LIMITED" | "BLOCKED" {
    if (!verified.direct.scope_granted || !verified.metrika.scope_granted || !verified.direct.matched || !verified.metrika.matched) return "BLOCKED";
    return verified.wordstat.scope_granted ? "READY" : "LIMITED";
  }

  private async applyVerification(
    key: string,
    state: AccessReadinessState,
    accountIdentity: string,
    counterIdentity: string,
    verified: AccessBindingVerification,
  ) {
    const status = this.verificationStatus(verified);
    const timestamp = this.now();
    const limitations = [
      ...(!verified.direct.scope_granted ? ["Разрешение на чтение Директа отсутствует или было отозвано."] : []),
      ...(!verified.metrika.scope_granted ? ["Разрешение на чтение Метрики отсутствует или было отозвано."] : []),
      ...(!verified.wordstat.scope_granted ? ["Данные Wordstat недоступны; выводы о спросе будут ограничены."] : []),
      ...(!verified.direct.matched ? ["Выбранный рекламодатель не совпал с аккаунтом, подтверждённым официальным API."] : []),
      ...(!verified.metrika.matched ? ["Выбранный счётчик не совпал с объектом, подтверждённым официальным API."] : []),
    ];
    return this.save(key, state.revision, {
      ...state,
      revision: state.revision + 1,
      status,
      binding: status === "BLOCKED" ? null : {
        account_identity: accountIdentity,
        counter_identity: counterIdentity,
        verified_at: timestamp,
        direct_matched: verified.direct.matched,
        metrika_matched: verified.metrika.matched,
      },
      scope: {
        direct: verified.direct.scope_granted && verified.direct.matched ? "AVAILABLE" : "UNAVAILABLE",
        metrika: verified.metrika.scope_granted && verified.metrika.matched ? "AVAILABLE" : "UNAVAILABLE",
        wordstat: verified.wordstat.scope_granted ? "AVAILABLE" : "UNAVAILABLE",
      },
      limitations,
      updated_at: timestamp,
    });
  }

  private async expect(key: string, expectedRevision: number, statuses: AccessStatus[]) {
    const state = await this.get(key);
    if (state.revision !== expectedRevision) throw new Error("Access Readiness action is stale.");
    if (!statuses.includes(state.status)) throw new Error("Access Readiness transition is not allowed.");
    return state;
  }

  private async save(key: string, expectedRevision: number, state: AccessReadinessState) {
    const row = { revision: state.revision, updated_at: state.updated_at, value_json: JSON.stringify(state) };
    if (!await this.store.compareAndSwap(key, expectedRevision, row)) throw new Error("Access Readiness revision conflict.");
    return state;
  }
}
