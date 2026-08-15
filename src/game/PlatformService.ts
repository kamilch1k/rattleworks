export type PlatformKind = 'local' | 'crazygames' | 'yandex';

export interface PlatformPlayer {
  id: string;
  name: string;
  avatar?: string;
}

export interface PlatformService {
  readonly kind: PlatformKind;
  readonly name: string;
  readonly isAvailable: boolean;
  readonly isInitialized: boolean;

  /** Portal language detected during SDK initialization, when available. */
  getLanguage(): string | null;

  initialize(): Promise<boolean>;
  loadingComplete(): Promise<void>;
  gameplayStart(): Promise<void>;
  gameplayStop(): Promise<void>;
  happyTime(): Promise<void>;
  showInterstitial(): Promise<boolean>;
  showRewarded(): Promise<boolean>;

  saveData<T>(data: T): Promise<boolean>;
  saveData<T>(key: string, data: T): Promise<boolean>;
  loadData<T>(key?: string): Promise<T | null>;
  submitScore(leaderboard: string, score: number): Promise<boolean>;
  getPlayer(): Promise<PlatformPlayer | null>;
  bindLifecycle(target?: Document): () => void;
}

type AnyRecord = Record<string, any>;
type RemoteRead = { found: boolean; value: string | null };

const DEFAULT_DATA_KEY = 'save';
const LOCAL_PREFIX = 'rattleworks.platform.';

function asRecord(value: unknown): AnyRecord | null {
  return typeof value === 'object' && value !== null ? value as AnyRecord : null;
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function encode(value: unknown): string | null {
  try {
    return JSON.stringify({ version: 1, value });
  } catch {
    return null;
  }
}

function decode<T>(serialized: string): T | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (asRecord(parsed) && 'value' in (parsed as AnyRecord)) {
      return (parsed as AnyRecord).value as T;
    }
    return parsed as T;
  } catch {
    // Older portal implementations occasionally stored plain strings.
    return serialized as T;
  }
}

async function call(owner: unknown, method: string, ...args: unknown[]): Promise<unknown> {
  const record = asRecord(owner);
  const fn = record?.[method];
  if (typeof fn !== 'function') return undefined;
  return await Promise.resolve(fn.apply(owner, args));
}

function memberText(owner: unknown, property: string, getter?: string): string {
  const record = asRecord(owner);
  try {
    const value = getter && typeof record?.[getter] === 'function'
      ? record[getter].call(owner)
      : record?.[property];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  } catch {
    return '';
  }
}

/**
 * Shared safe base. Portal adapters only override remote hooks; every operation
 * still has local persistence and no-op lifecycle behavior as a fallback.
 */
export abstract class BasePlatform implements PlatformService {
  protected initialized = false;

  constructor(
    public readonly kind: PlatformKind,
    public readonly name: string,
    protected readonly storage: Storage | null = browserStorage(),
  ) {}

  get isAvailable(): boolean { return true; }
  get isInitialized(): boolean { return this.initialized; }
  getLanguage(): string | null { return null; }

  async initialize(): Promise<boolean> {
    this.initialized = true;
    return true;
  }

  async loadingComplete(): Promise<void> {}
  async gameplayStart(): Promise<void> {}
  async gameplayStop(): Promise<void> {}
  async happyTime(): Promise<void> {}
  async showInterstitial(): Promise<boolean> { return false; }
  async showRewarded(): Promise<boolean> { return false; }
  async submitScore(_leaderboard: string, _score: number): Promise<boolean> { return false; }
  async getPlayer(): Promise<PlatformPlayer | null> { return null; }

  saveData<T>(data: T): Promise<boolean>;
  saveData<T>(key: string, data: T): Promise<boolean>;
  async saveData<T>(keyOrData: string | T, optionalData?: T): Promise<boolean> {
    const hasKey = arguments.length > 1;
    const key = hasKey ? String(keyOrData) : DEFAULT_DATA_KEY;
    const data = hasKey ? optionalData as T : keyOrData as T;
    const serialized = encode(data);
    if (serialized === null) return false;

    let remoteResult: boolean | null = null;
    try {
      remoteResult = await this.writeRemote(key, serialized);
    } catch {
      remoteResult = false;
    }

    let localResult = false;
    try {
      this.storage?.setItem(LOCAL_PREFIX + key, serialized);
      localResult = this.storage !== null;
    } catch {
      localResult = false;
    }
    return remoteResult === true || localResult;
  }

  async loadData<T>(key = DEFAULT_DATA_KEY): Promise<T | null> {
    try {
      const remote = await this.readRemote(key);
      if (remote?.found && remote.value !== null) {
        try { this.storage?.setItem(LOCAL_PREFIX + key, remote.value); } catch { /* mirror is optional */ }
        return decode<T>(remote.value);
      }
    } catch {
      // Fall through to the local mirror.
    }

    try {
      const local = this.storage?.getItem(LOCAL_PREFIX + key) ?? null;
      return local === null ? null : decode<T>(local);
    } catch {
      return null;
    }
  }

  /** Mirrors browser visibility to portal gameplay lifecycle calls. */
  bindLifecycle(target?: Document): () => void {
    const documentTarget = target ?? (typeof document !== 'undefined' ? document : null);
    if (!documentTarget) return () => undefined;

    const visibility = (): void => {
      if (documentTarget.visibilityState === 'hidden') void this.gameplayStop();
      else void this.gameplayStart();
    };
    const pageHide = (): void => { void this.gameplayStop(); };
    const pageShow = (): void => { void this.gameplayStart(); };
    documentTarget.addEventListener('visibilitychange', visibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', pageHide);
      window.addEventListener('pageshow', pageShow);
    }
    return () => {
      documentTarget.removeEventListener('visibilitychange', visibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', pageHide);
        window.removeEventListener('pageshow', pageShow);
      }
    };
  }

  protected async writeRemote(_key: string, _value: string): Promise<boolean | null> {
    return null;
  }

  protected async readRemote(_key: string): Promise<RemoteRead | null> {
    return null;
  }
}

export class LocalPlatform extends BasePlatform {
  constructor(storage: Storage | null = browserStorage()) {
    super('local', 'Local', storage);
  }
}

function crazySdk(): AnyRecord | null {
  const global = globalThis as typeof globalThis & { CrazyGames?: unknown };
  const crazy = asRecord(global.CrazyGames);
  return asRecord(crazy?.SDK ?? crazy?.sdk);
}

export class CrazyGamesPlatform extends BasePlatform {
  private ready = false;
  private initializing: Promise<boolean> | null = null;

  constructor(storage: Storage | null = browserStorage()) {
    super('crazygames', 'CrazyGames', storage);
  }

  override get isAvailable(): boolean {
    return crazySdk() !== null;
  }

  override async initialize(): Promise<boolean> {
    if (this.ready) return true;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const sdk = crazySdk();
      if (!sdk) return false;
      try {
        if (typeof sdk.init === 'function') await Promise.resolve(sdk.init.call(sdk));
        this.ready = true;
        this.initialized = true;
        return true;
      } catch {
        return false;
      }
    })();
    const result = await this.initializing;
    if (!result) this.initializing = null;
    return result;
  }

  override async loadingComplete(): Promise<void> {
    try {
      if (await this.initialize()) await call(crazySdk()?.game, 'loadingStop');
    } catch { /* SDK lifecycle events are advisory. */ }
  }

  override async gameplayStart(): Promise<void> {
    try {
      if (await this.initialize()) await call(crazySdk()?.game, 'gameplayStart');
    } catch { /* no-op fallback */ }
  }

  override async gameplayStop(): Promise<void> {
    try {
      if (await this.initialize()) await call(crazySdk()?.game, 'gameplayStop');
    } catch { /* no-op fallback */ }
  }

  override async happyTime(): Promise<void> {
    try {
      if (await this.initialize()) await call(crazySdk()?.game, 'happytime');
    } catch { /* optional celebration signal */ }
  }

  override showInterstitial(): Promise<boolean> {
    return this.requestAd('midgame');
  }

  override showRewarded(): Promise<boolean> {
    return this.requestAd('rewarded');
  }

  override async submitScore(leaderboard: string, score: number): Promise<boolean> {
    if (!Number.isFinite(score) || !(await this.initialize())) return false;
    const sdk = crazySdk();
    const service = asRecord(sdk?.leaderboard ?? sdk?.leaderboards);
    try {
      if (typeof service?.setScore !== 'function') return false;
      await Promise.resolve(service.setScore.call(service, leaderboard, Math.round(score)));
      return true;
    } catch {
      return false;
    }
  }

  override async getPlayer(): Promise<PlatformPlayer | null> {
    if (!(await this.initialize())) return null;
    try {
      const user = await call(crazySdk()?.user, 'getUser');
      if (!user) return null;
      const id = memberText(user, 'id', 'getUserId') || memberText(user, 'userId');
      const name = memberText(user, 'username', 'getUsername') || memberText(user, 'name') || 'Player';
      const avatar = memberText(user, 'profilePictureUrl', 'getProfilePictureUrl') || memberText(user, 'avatar');
      return id ? { id, name, ...(avatar ? { avatar } : {}) } : null;
    } catch {
      return null;
    }
  }

  protected override async writeRemote(key: string, value: string): Promise<boolean | null> {
    if (!(await this.initialize())) return null;
    const data = asRecord(crazySdk()?.data);
    if (typeof data?.setItem !== 'function') return null;
    try {
      await Promise.resolve(data.setItem.call(data, key, value));
      return true;
    } catch {
      return false;
    }
  }

  protected override async readRemote(key: string): Promise<RemoteRead | null> {
    if (!(await this.initialize())) return null;
    const data = asRecord(crazySdk()?.data);
    if (typeof data?.getItem !== 'function') return null;
    try {
      const value = await Promise.resolve(data.getItem.call(data, key));
      return value === null || value === undefined
        ? { found: false, value: null }
        : { found: true, value: typeof value === 'string' ? value : encode(value) };
    } catch {
      return null;
    }
  }

  private async requestAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    if (!(await this.initialize())) return false;
    const ad = asRecord(crazySdk()?.ad);
    if (typeof ad?.requestAd !== 'function') return false;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (success: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(success);
      };
      const timeout = globalThis.setTimeout(() => finish(false), 30000);
      try {
        ad.requestAd.call(ad, type, {
          adStarted: () => undefined,
          adFinished: () => finish(true),
          adError: () => finish(false),
        });
      } catch {
        finish(false);
      }
    });
  }
}

function yandexFactory(): AnyRecord | null {
  const global = globalThis as typeof globalThis & { YaGames?: unknown };
  return asRecord(global.YaGames);
}

export class YandexGamesPlatform extends BasePlatform {
  private sdk: AnyRecord | null = null;
  private player: AnyRecord | null = null;
  private initializing: Promise<boolean> | null = null;

  constructor(storage: Storage | null = browserStorage()) {
    super('yandex', 'Yandex Games', storage);
  }

  override get isAvailable(): boolean {
    return this.sdk !== null || yandexFactory() !== null;
  }

  override getLanguage(): string | null {
    const environment = asRecord(this.sdk?.environment);
    const i18n = asRecord(environment?.i18n);
    return typeof i18n?.lang === 'string' ? i18n.lang : null;
  }

  override async initialize(): Promise<boolean> {
    if (this.sdk) return true;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const factory = yandexFactory();
      if (typeof factory?.init !== 'function') return false;
      try {
        this.sdk = asRecord(await Promise.resolve(factory.init.call(factory)));
        this.initialized = this.sdk !== null;
        return this.initialized;
      } catch {
        this.sdk = null;
        return false;
      }
    })();
    const result = await this.initializing;
    if (!result) this.initializing = null;
    return result;
  }

  override async loadingComplete(): Promise<void> {
    try {
      if (await this.initialize()) await call(asRecord(this.sdk?.features)?.LoadingAPI, 'ready');
    } catch { /* optional loading signal */ }
  }

  override async gameplayStart(): Promise<void> {
    try {
      if (!(await this.initialize())) return;
      const features = asRecord(this.sdk?.features);
      const api = features?.GameplayAPI ?? this.sdk?.gameplayAPI;
      await call(api, 'start');
    } catch { /* no-op fallback */ }
  }

  override async gameplayStop(): Promise<void> {
    try {
      if (!(await this.initialize())) return;
      const features = asRecord(this.sdk?.features);
      const api = features?.GameplayAPI ?? this.sdk?.gameplayAPI;
      await call(api, 'stop');
    } catch { /* no-op fallback */ }
  }

  override async happyTime(): Promise<void> {
    // Yandex currently has no matching hook; deliberately a safe no-op.
  }

  override async showInterstitial(): Promise<boolean> {
    if (!(await this.initialize())) return false;
    const adv = asRecord(this.sdk?.adv);
    if (typeof adv?.showFullscreenAdv !== 'function') return false;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (success: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(success);
      };
      const timeout = globalThis.setTimeout(() => finish(false), 30000);
      try {
        adv.showFullscreenAdv.call(adv, {
          callbacks: {
            onOpen: () => undefined,
            onClose: (shown?: boolean) => finish(shown !== false),
            onError: () => finish(false),
            onOffline: () => finish(false),
          },
        });
      } catch {
        finish(false);
      }
    });
  }

  override async showRewarded(): Promise<boolean> {
    if (!(await this.initialize())) return false;
    const adv = asRecord(this.sdk?.adv);
    if (typeof adv?.showRewardedVideo !== 'function') return false;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let rewarded = false;
      const finish = (success: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(success);
      };
      const timeout = globalThis.setTimeout(() => finish(false), 45000);
      try {
        adv.showRewardedVideo.call(adv, {
          callbacks: {
            onOpen: () => undefined,
            onRewarded: () => { rewarded = true; },
            onClose: () => finish(rewarded),
            onError: () => finish(false),
          },
        });
      } catch {
        finish(false);
      }
    });
  }

  override async submitScore(leaderboard: string, score: number): Promise<boolean> {
    if (!Number.isFinite(score) || !(await this.initialize())) return false;
    const leaderboards = asRecord(this.sdk?.leaderboards);
    if (typeof leaderboards?.setLeaderboardScore !== 'function') return false;
    try {
      await Promise.resolve(leaderboards.setLeaderboardScore.call(leaderboards, leaderboard, Math.round(score)));
      return true;
    } catch {
      return false;
    }
  }

  override async getPlayer(): Promise<PlatformPlayer | null> {
    const player = await this.ensurePlayer();
    if (!player) return null;
    const id = memberText(player, 'id', 'getUniqueID') || memberText(player, 'uniqueID');
    const name = memberText(player, 'name', 'getName') || 'Player';
    const avatar = memberText(player, 'photo', 'getPhoto');
    return id ? { id, name, ...(avatar ? { avatar } : {}) } : null;
  }

  protected override async writeRemote(key: string, value: string): Promise<boolean | null> {
    const player = await this.ensurePlayer();
    if (!player || typeof player.setData !== 'function') return null;
    try {
      await Promise.resolve(player.setData.call(player, { [key]: value }, true));
      return true;
    } catch {
      return false;
    }
  }

  protected override async readRemote(key: string): Promise<RemoteRead | null> {
    const player = await this.ensurePlayer();
    if (!player || typeof player.getData !== 'function') return null;
    try {
      const result = asRecord(await Promise.resolve(player.getData.call(player, [key])));
      const value = result?.[key];
      return value === null || value === undefined
        ? { found: false, value: null }
        : { found: true, value: typeof value === 'string' ? value : encode(value) };
    } catch {
      return null;
    }
  }

  private async ensurePlayer(): Promise<AnyRecord | null> {
    if (this.player) return this.player;
    if (!(await this.initialize()) || typeof this.sdk?.getPlayer !== 'function') return null;
    try {
      this.player = asRecord(await Promise.resolve(this.sdk.getPlayer.call(this.sdk, { scopes: false })));
      return this.player;
    } catch {
      return null;
    }
  }
}

function detectionHint(): string {
  try {
    if (typeof location === 'undefined') return '';
    const query = new URLSearchParams(location.search);
    return `${query.get('platform') ?? query.get('portal') ?? ''} ${location.hostname}`.toLowerCase();
  } catch {
    return '';
  }
}

/** Chooses a portal adapter without assuming its global SDK is present. */
export function createPlatformService(preferred?: PlatformKind | string): PlatformService {
  const hint = `${preferred ?? ''} ${detectionHint()}`.toLowerCase();
  if (hint.includes('crazy') || crazySdk()) return new CrazyGamesPlatform();
  if (hint.includes('yandex') || hint.includes('yagames') || yandexFactory()) return new YandexGamesPlatform();
  return new LocalPlatform();
}

export const platformService = createPlatformService();
export const platform = platformService;
export default platformService;
