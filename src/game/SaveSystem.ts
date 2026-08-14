import type {
  Blueprint,
  CharacterKind,
  LevelResult,
  MaterialId,
  Quality,
  SaveData,
  SnapshotConnector,
  SnapshotEntity,
  Vec3,
  WorldSnapshot,
} from './types';

export const SAVE_VERSION = 1 as const;
export const SAVE_STORAGE_KEY = 'rattleworks.save';

type UnknownRecord = Record<string, unknown>;
type SaveListener = (data: SaveData) => void;

const MATERIALS = new Set<MaterialId>([
  'wood', 'metal', 'concrete', 'glass', 'rubber', 'plastic', 'dirt', 'toy',
]);
const CHARACTER_KINDS = new Set<CharacterKind>([
  'human', 'worker', 'knight', 'dummy', 'monster', 'heavy', 'armored', 'friendly',
]);
const CONNECTOR_TYPES = new Set<SnapshotConnector['type']>([
  'weld', 'rope', 'spring', 'hinge', 'motor',
]);
const QUALITY_LEVELS = new Set<Quality>(['low', 'medium', 'high']);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function integer(value: unknown, fallback = 0): number {
  return Math.floor(finiteNumber(value, fallback));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanString(value: unknown, fallback = '', maximumLength = 120): string {
  return typeof value === 'string' ? value.slice(0, maximumLength) : fallback;
}

function stringList(value: unknown, maximumItems = 256): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || seen.has(item)) continue;
    seen.add(item);
    result.push(item.slice(0, 120));
    if (result.length >= maximumItems) break;
  }
  return result;
}

function vec3(value: unknown, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (!isRecord(value)) return { ...fallback };
  return {
    x: finiteNumber(value.x, fallback.x),
    y: finiteNumber(value.y, fallback.y),
    z: finiteNumber(value.z, fallback.z),
  };
}

function levelResult(value: unknown): LevelResult {
  const source = isRecord(value) ? value : {};
  return {
    stars: clamp(integer(source.stars), 0, 3),
    time: nonNegative(source.time),
    itemsUsed: nonNegative(integer(source.itemsUsed)),
    destruction: nonNegative(source.destruction),
    bestScore: nonNegative(source.bestScore),
  };
}

function normalizedUnlockedLevel(
  completed: Readonly<Record<number, LevelResult>>,
): number {
  const earnedLevels = Object.entries(completed)
    .filter(([, result]) => result.stars > 0)
    .map(([id]) => Number(id));
  // Some early development saves persisted a high unlock marker without the
  // matching results. Derive progression from real completions so fresh saves
  // expose only Level 1 and earned saves retain their highest finished level.
  if (earnedLevels.length === 0) return 1;
  return Math.max(...earnedLevels) + 1;
}

function snapshotEntity(value: unknown): SnapshotEntity | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const rotation = isRecord(value.rotation) ? value.rotation : {};
  const material = MATERIALS.has(value.material as MaterialId)
    ? value.material as MaterialId
    : 'toy';
  const variant = CHARACTER_KINDS.has(value.variant as CharacterKind)
    ? value.variant as CharacterKind
    : undefined;
  const weapon = isRecord(value.weapon)
    ? {
        ammo: clamp(nonNegative(integer(value.weapon.ammo)), 0, 10000),
        reserveAmmo: clamp(nonNegative(integer(value.weapon.reserveAmmo)), 0, 10000),
      }
    : undefined;

  return {
    type: value.type.slice(0, 120),
    position: vec3(value.position),
    rotation: {
      x: finiteNumber(rotation.x),
      y: finiteNumber(rotation.y),
      z: finiteNumber(rotation.z),
      w: finiteNumber(rotation.w, 1),
    },
    scale: vec3(value.scale, { x: 1, y: 1, z: 1 }),
    material,
    ...(typeof value.color === 'number' && Number.isFinite(value.color)
      ? { color: Math.max(0, Math.floor(value.color)) }
      : {}),
    fixed: value.fixed === true,
    ...(variant ? { variant } : {}),
    ...(weapon ? { weapon } : {}),
  };
}

function snapshotConnector(value: unknown): SnapshotConnector | null {
  if (!isRecord(value) || !CONNECTOR_TYPES.has(value.type as SnapshotConnector['type'])) {
    return null;
  }
  return {
    type: value.type as SnapshotConnector['type'],
    a: Math.max(0, integer(value.a)),
    b: Math.max(0, integer(value.b)),
    restLength: nonNegative(value.restLength),
  };
}

function worldSnapshot(value: unknown, fallbackName = 'Sandbox World'): WorldSnapshot | null {
  if (!isRecord(value)) return null;
  const entities: SnapshotEntity[] = [];
  const connectors: SnapshotConnector[] = [];

  if (Array.isArray(value.entities)) {
    for (const item of value.entities.slice(0, 1000)) {
      const entity = snapshotEntity(item);
      if (entity) entities.push(entity);
    }
  }
  if (Array.isArray(value.connectors)) {
    for (const item of value.connectors.slice(0, 2000)) {
      const connector = snapshotConnector(item);
      if (connector) connectors.push(connector);
    }
  }

  return {
    version: 1,
    name: cleanString(value.name, fallbackName),
    createdAt: nonNegative(value.createdAt, Date.now()),
    entities,
    connectors,
  };
}

function blueprint(value: unknown): Blueprint | null {
  if (!isRecord(value)) return null;
  const world = worldSnapshot(value, 'Blueprint');
  if (!world) return null;
  const id = cleanString(value.id);
  if (!id) return null;
  return {
    ...world,
    id,
    icon: cleanString(value.icon, 'build', 80),
  };
}

/** Returns a new, mutable default save object. */
export function createDefaultSaveData(): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    completed: {},
    unlockedLevel: 1,
    unlockedItems: [],
    settings: {
      quality: 'medium',
      volume: 0.8,
      cameraShake: true,
    },
    favorites: [],
    recent: [],
    blueprints: [],
    sandboxWorlds: {},
  };
}

/**
 * Migrates old shapes one version at a time. Version zero represents saves made
 * before an explicit version field was introduced.
 */
function migrate(raw: unknown): UnknownRecord | null {
  if (!isRecord(raw)) return null;
  let source: UnknownRecord = { ...raw };
  let version = Math.max(0, integer(source.saveVersion ?? source.version, 0));
  if (version > SAVE_VERSION) return null;

  while (version < SAVE_VERSION) {
    if (version === 0) {
      const legacySettings = isRecord(source.settings) ? source.settings : {};
      source = {
        ...source,
        saveVersion: 1,
        completed: source.completed ?? source.completedLevels ?? source.progress ?? {},
        unlockedLevel: source.unlockedLevel ?? source.maxUnlockedLevel ?? 1,
        unlockedItems: source.unlockedItems ?? source.unlocked ?? [],
        settings: {
          ...legacySettings,
          volume: legacySettings.volume ?? source.audioVolume ?? 0.8,
        },
        sandboxWorlds: source.sandboxWorlds ?? source.worlds ?? {},
        blueprints: source.blueprints ?? source.savedBlueprints ?? [],
      };
      version = 1;
      continue;
    }
    return null;
  }
  return source;
}

/** Sanitizes data as well as cloning it, so callers never retain internal state. */
export function normalizeSaveData(value: unknown): SaveData {
  const migrated = migrate(value);
  if (!migrated) return createDefaultSaveData();
  const defaults = createDefaultSaveData();

  const completed: Record<number, LevelResult> = {};
  if (isRecord(migrated.completed)) {
    for (const [key, result] of Object.entries(migrated.completed)) {
      const level = Number(key);
      if (Number.isInteger(level) && level > 0 && level <= 10000) {
        completed[level] = levelResult(result);
      }
    }
  }

  const settings = isRecord(migrated.settings) ? migrated.settings : {};
  const quality = QUALITY_LEVELS.has(settings.quality as Quality)
    ? settings.quality as Quality
    : defaults.settings.quality;

  const sandboxWorlds: Record<string, WorldSnapshot> = {};
  if (isRecord(migrated.sandboxWorlds)) {
    for (const [rawId, rawWorld] of Object.entries(migrated.sandboxWorlds).slice(0, 100)) {
      const id = rawId.slice(0, 120);
      const world = worldSnapshot(rawWorld, id);
      if (id && world) sandboxWorlds[id] = world;
    }
  }

  const blueprints: Blueprint[] = [];
  const seenBlueprints = new Set<string>();
  if (Array.isArray(migrated.blueprints)) {
    for (const item of migrated.blueprints.slice(0, 200)) {
      const clean = blueprint(item);
      if (clean && !seenBlueprints.has(clean.id)) {
        seenBlueprints.add(clean.id);
        blueprints.push(clean);
      }
    }
  }

  return {
    saveVersion: SAVE_VERSION,
    completed,
    unlockedLevel: normalizedUnlockedLevel(completed),
    unlockedItems: stringList(migrated.unlockedItems),
    settings: {
      quality,
      volume: clamp(finiteNumber(settings.volume, defaults.settings.volume), 0, 1),
      cameraShake: typeof settings.cameraShake === 'boolean'
        ? settings.cameraShake
        : defaults.settings.cameraShake,
    },
    favorites: stringList(migrated.favorites, 100),
    recent: stringList(migrated.recent, 30),
    blueprints,
    sandboxWorlds,
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Versioned, local-first persistence with an in-memory fallback. */
export class SaveSystem {
  private state: SaveData = createDefaultSaveData();
  private readonly listeners = new Set<SaveListener>();
  private loaded = false;

  constructor(
    readonly storageKey = SAVE_STORAGE_KEY,
    private readonly storage: Storage | null = browserStorage(),
  ) {}

  get data(): SaveData {
    return normalizeSaveData(this.state);
  }

  getData(): SaveData {
    return this.data;
  }

  load(): SaveData {
    let serialized: string | null = null;
    try {
      serialized = this.storage?.getItem(this.storageKey) ?? null;
    } catch {
      // Privacy modes and full storage can throw. The memory copy remains usable.
    }

    if (serialized !== null) {
      try {
        this.state = normalizeSaveData(JSON.parse(serialized) as unknown);
      } catch {
        this.state = createDefaultSaveData();
      }
    } else if (!this.loaded) {
      this.state = createDefaultSaveData();
    }
    this.loaded = true;
    return this.data;
  }

  /** Saves immediately. Returns false only when durable browser storage failed. */
  save(data: SaveData = this.state): boolean {
    this.state = normalizeSaveData(data);
    this.loaded = true;
    let stored = this.storage !== null;
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      stored = false;
    }
    this.notify();
    return stored;
  }

  update(mutator: (draft: SaveData) => void): SaveData {
    const draft = this.data;
    try {
      mutator(draft);
      this.save(draft);
    } catch {
      // A bad UI callback must not corrupt the last known-good save.
    }
    return this.data;
  }

  reset(): SaveData {
    try {
      this.storage?.removeItem(this.storageKey);
    } catch {
      // Continue with an in-memory reset.
    }
    this.state = createDefaultSaveData();
    this.loaded = true;
    this.notify();
    return this.data;
  }

  clear(): SaveData {
    return this.reset();
  }

  subscribe(listener: SaveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordLevelResult(levelId: number, result: LevelResult): SaveData {
    if (!Number.isInteger(levelId) || levelId < 1) return this.data;
    return this.update((draft) => {
      const next = levelResult(result);
      const old = draft.completed[levelId];
      draft.completed[levelId] = old ? {
        stars: Math.max(old.stars, next.stars),
        time: old.time > 0 && next.time > 0 ? Math.min(old.time, next.time) : Math.max(old.time, next.time),
        itemsUsed: Math.min(old.itemsUsed, next.itemsUsed),
        destruction: Math.max(old.destruction, next.destruction),
        bestScore: Math.max(old.bestScore, next.bestScore),
      } : next;
      if (next.stars > 0) draft.unlockedLevel = Math.max(draft.unlockedLevel, levelId + 1);
    });
  }

  unlockItem(itemId: string): SaveData {
    return this.unlockItems([itemId]);
  }

  unlockItems(itemIds: Iterable<string>): SaveData {
    const additions = [...itemIds].filter(Boolean);
    return this.update((draft) => {
      for (const itemId of additions) {
        if (!draft.unlockedItems.includes(itemId)) draft.unlockedItems.push(itemId);
      }
    });
  }

  setSettings(settings: Partial<SaveData['settings']>): SaveData {
    return this.update((draft) => {
      draft.settings = { ...draft.settings, ...settings };
    });
  }

  setFavorite(itemId: string, favorite = true): SaveData {
    return this.update((draft) => {
      draft.favorites = draft.favorites.filter((id) => id !== itemId);
      if (favorite && itemId) draft.favorites.unshift(itemId);
    });
  }

  rememberRecent(itemId: string): SaveData {
    return this.update((draft) => {
      draft.recent = [itemId, ...draft.recent.filter((id) => id !== itemId)].filter(Boolean).slice(0, 30);
    });
  }

  saveWorld(id: string, snapshot: WorldSnapshot): SaveData {
    if (!id) return this.data;
    return this.update((draft) => {
      const world = worldSnapshot(snapshot, id);
      if (world) draft.sandboxWorlds[id.slice(0, 120)] = world;
    });
  }

  loadWorld(id: string): WorldSnapshot | null {
    const world = this.state.sandboxWorlds[id];
    return world ? worldSnapshot(world, id) : null;
  }

  deleteWorld(id: string): SaveData {
    return this.update((draft) => {
      delete draft.sandboxWorlds[id];
    });
  }

  saveBlueprint(value: Blueprint): SaveData {
    return this.update((draft) => {
      const clean = blueprint(value);
      if (!clean) return;
      const index = draft.blueprints.findIndex((item) => item.id === clean.id);
      if (index >= 0) draft.blueprints[index] = clean;
      else draft.blueprints.push(clean);
    });
  }

  deleteBlueprint(id: string): SaveData {
    return this.update((draft) => {
      draft.blueprints = draft.blueprints.filter((item) => item.id !== id);
    });
  }

  private notify(): void {
    const snapshot = this.data;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Save listeners are optional observers; one cannot stop persistence.
      }
    }
  }
}

export const saveSystem = new SaveSystem();
export default saveSystem;
