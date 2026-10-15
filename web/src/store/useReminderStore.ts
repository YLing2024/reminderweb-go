/**
 * 应用状态（zustand）：启动时载入数据，变更后持久化。
 *
 * 双驱动（需求 §7 / M10 §1）：
 * - 客户端模式（纯前端）：与历史行为一致，纯 IndexedDB（键 `reminderweb:data`），不发任何 /api 请求；
 * - 服务器模式：以服务器为准，IndexedDB 仅作只读缓存（键 `reminderweb:cache`），
 *   写操作走 `PUT /api/data`，成功后采纳服务器返回的权威数据。
 *
 * 判据：运行模式由 `lib/app-mode` 按 config.json > VITE_APP_MODE > 探测 `/api/health` 决定。
 */
import { create } from 'zustand';
import type { ReminderItem, TagItem } from '../types/reminder';
import {
  DEFAULT_SETTINGS,
  clearAllData,
  listImageNames,
  loadImageBlob,
  loadPersistedData,
  replaceImageBlobs,
  savePersistedData,
  type AppSettings,
} from '../lib/storage';
import {
  fetchData,
  fetchFullData,
  fetchVersion,
  isUnauthorized,
  login as apiLogin,
  logout as apiLogout,
  probeHealth,
  pushData,
  replaceData,
  ssoLoginUrl,
  uploadImage,
  type AuthMode,
  type PushPayload,
  type ReplacePayload,
  type ServerSnapshot,
  type SyncReminder,
  type SyncSettings,
  type SyncTag,
  type SyncTombstone,
} from '../lib/api';
import { detectAppMode, writeStoredAppMode } from '../lib/app-mode';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import {
  countsOf,
  toLocalReminders,
  toLocalTags,
  toServerReminders,
  toServerTags,
  verifyMigration,
  type MigrationCounts,
  type MigrationDirection,
  type MigrationVerification,
} from '../lib/mode-migration';
import {
  LOCAL_ONLY_SETTING_KEYS,
  loadServerCache,
  mergeServerSettings,
  normalizeFullSnapshot,
  normalizeSnapshot,
  saveServerCache,
  syncedSettings,
} from '../lib/server-storage';

const DEFAULT_TAG_COLORS = ['#2196F3', '#E91E63', '#4CAF50', '#FF9800', '#9C27B0', '#009688'];

export type StorageMode = 'unknown' | 'client' | 'server';

export interface ServerInfo {
  revision: number | null;
  version: string | null;
  schemaVersion: number | null;
  username: string | null;
  authMode: AuthMode | null;
}

/** 模式切换迁移结果（M11 §2）。 */
export interface MigrationOutcome {
  direction: MigrationDirection;
  counts: MigrationCounts;
  elapsedMs: number;
  revision?: number;
  verification: MigrationVerification;
}

interface ReminderStore {
  reminders: ReminderItem[];
  tags: TagItem[];
  settings: AppSettings;
  loaded: boolean;

  mode: StorageMode;
  authMode: AuthMode | null;
  serverUser: string | null;
  revision: number | null;
  serverVersion: string | null;
  /** 后端是否可达（用于设置页置灰服务器模式入口）。 */
  serverReachable: boolean;
  /** 服务器是否仍在使用默认 / 弱口令（M12 §3.2）；设置页据此显示可关闭提醒条。 */
  authWarning: boolean;
  /** 服务端当前持有的卡片背景图文件名。 */
  serverImageNames: string[];
  syncing: boolean;
  /** 有尚未成功推送到服务器的本机改动。 */
  dirty: boolean;
  syncError: string | null;
  /** builtin 模式下需要登录（会话失效或尚未登录）。 */
  authRequired: boolean;
  /** 首次连接：服务器为空而本机有旧数据，可一键上传。 */
  canUploadLocal: boolean;
  /** 一次性提示（如「已按服务器数据更新」）。 */
  serverNotice: string | null;
  dismissServerNotice: () => void;

  /** 内部：提醒与标签的墓碑，用于把删除同步给服务器。 */
  tombstones: SyncTombstone[];
  /** 内部：可同步设置的更新时间。 */
  settingsUpdatedAt: number;

  hydrate: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  uploadLocalData: () => Promise<void>;
  /** 服务器 → 客户端：后端全量覆盖本地后切到客户端模式（M11 §2）。 */
  migrateToClient: () => Promise<MigrationOutcome>;
  /** 客户端 → 服务器：本机全量覆盖后端后切到服务器模式（M11 §2）。 */
  migrateToServer: () => Promise<MigrationOutcome>;

  addReminder: (item: ReminderItem) => Promise<number>;
  updateReminder: (item: ReminderItem) => Promise<void>;
  deleteReminder: (id: number) => Promise<void>;
  togglePin: (id: number) => Promise<void>;
  findTag: (name: string) => TagItem | undefined;
  addTag: (name: string, color?: string) => Promise<TagItem | undefined>;
  updateTag: (id: number, name: string, color: string) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  moveTag: (id: number, direction: 'up' | 'down') => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  importData: (data: { reminders: ReminderItem[]; tags: TagItem[]; settings?: Partial<AppSettings> }) => Promise<void>;
  resetAll: () => Promise<void>;
}

function nextNumericId(items: Array<{ id: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function withUpdatedAt<T extends { updatedAt?: number }>(item: T, at: number): T {
  return { ...item, updatedAt: at };
}

function toSyncReminder(item: ReminderItem): SyncReminder {
  const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : 0;
  return { ...item, updatedAt };
}

function toSyncTag(item: TagItem): SyncTag {
  const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : 0;
  return { ...item, updatedAt };
}

function reminderSampleKey(item: ReminderItem): string {
  return `${item.id}|${item.title}|${item.date}`;
}

function tagSampleKey(tag: TagItem | undefined): string {
  return tag === undefined ? '' : tag.name;
}

/** 抽样比对：数量 + 首条（按 id 排序）提醒的 id/title/date + 首个标签名。 */
function samplesMatch(a: ReminderItem[], b: ReminderItem[], ta: TagItem[], tb: TagItem[]): boolean {
  const ar = [...a].sort((x, y) => x.id - y.id);
  const br = [...b].sort((x, y) => x.id - y.id);
  if (ar.length !== br.length) return false;
  if (ar.length > 0 && br.length > 0 && reminderSampleKey(ar[0]!) !== reminderSampleKey(br[0]!)) return false;
  const at = [...ta].sort((x, y) => x.id - y.id);
  const bt = [...tb].sort((x, y) => x.id - y.id);
  if (at.length !== bt.length) return false;
  if (at.length > 0 && bt.length > 0 && tagSampleKey(at[0]) !== tagSampleKey(bt[0])) return false;
  return true;
}

function isLocalMode(mode: StorageMode): boolean {
  return mode !== 'server';
}

export const useReminderStore = create<ReminderStore>((set, get) => {
  let pushing = false;
  let pushAgain = false;

  function localSnapshot(): void {
    void savePersistedData({ reminders: get().reminders, tags: get().tags, settings: get().settings });
  }

  function handleUnauthorized(): void {
    const authMode = get().authMode;
    if (authMode === 'sso') {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(ssoLoginUrl(next));
      return;
    }
    set({ authRequired: true });
  }

  function adoptSnapshot(snapshot: ServerSnapshot, extra: Partial<ReminderStore> = {}): void {
    set({
      reminders: snapshot.reminders,
      tags: snapshot.tags,
      settings: mergeServerSettings(get().settings, snapshot.settings.value),
      revision: snapshot.revision,
      settingsUpdatedAt: snapshot.settings.updatedAt,
      tombstones: snapshot.tombstones,
      serverImageNames: snapshot.imageNames,
      serverReachable: true,
      dirty: false,
      syncError: null,
      ...extra,
    });
    void saveServerCache(snapshot);
    localSnapshot();
  }

  /** 把本机引用的图片里服务端还没有的那部分上传（只增不删，避免误删他设备图片）。 */
  async function syncImagesToServer(): Promise<void> {
    const serverNames = new Set(get().serverImageNames);
    const localNames = await listImageNames();
    const missing = localNames.filter((name) => !serverNames.has(name));
    for (const name of missing) {
      const blob = await loadImageBlob(name);
      if (blob === undefined) continue;
      await uploadImage(name, new Uint8Array(await blob.arrayBuffer()));
    }
    if (missing.length > 0) set({ serverImageNames: [...new Set([...serverNames, ...missing])] });
  }

  function buildPayload(): PushPayload {
    const { reminders, tags, settings, revision, tombstones, settingsUpdatedAt } = get();
    const settingsEnvelope: SyncSettings = { value: syncedSettings(settings), updatedAt: settingsUpdatedAt };
    return {
      baseRevision: revision ?? 0,
      reminders: reminders.map(toSyncReminder),
      tags: tags.map(toSyncTag),
      settings: settingsEnvelope,
      tombstones,
    };
  }

  async function doPush(): Promise<void> {
    set({ syncing: true });
    try {
      const result = await pushData(buildPayload());
      const snapshot = normalizeSnapshot(result);
      adoptSnapshot(snapshot, { canUploadLocal: false });
      await syncImagesToServer();
    } catch (error) {
      if (isUnauthorized(error)) {
        set({ dirty: true, syncError: '登录状态已过期' });
        handleUnauthorized();
      } else {
        set({ dirty: true, syncError: error instanceof Error ? error.message : '同步失败，请稍后重试' });
      }
    } finally {
      set({ syncing: false });
    }
  }

  async function pushToServer(): Promise<void> {
    if (pushing) {
      pushAgain = true;
      return;
    }
    pushing = true;
    try {
      do {
        pushAgain = false;
        await doPush();
      } while (pushAgain);
    } finally {
      pushing = false;
    }
  }

  /** 数据写入统一出口：本地模式写 IndexedDB，服务器模式推送到服务器。 */
  async function persist(options: { synced: boolean }): Promise<void> {
    const mode = get().mode;
    if (isLocalMode(mode)) {
      localSnapshot();
      return;
    }
    localSnapshot();
    if (options.synced) await pushToServer();
  }

  function isSyncedSettingsChange(partial: Partial<AppSettings>): boolean {
    for (const key of Object.keys(partial)) {
      if (!LOCAL_ONLY_SETTING_KEYS.has(key as keyof AppSettings)) return true;
    }
    return false;
  }

  return {
    reminders: [],
    tags: [],
    settings: { ...DEFAULT_SETTINGS },
    loaded: false,

    mode: 'unknown',
    authMode: null,
    serverUser: null,
    revision: null,
    serverVersion: null,
    serverReachable: false,
    authWarning: false,
    serverImageNames: [],
    syncing: false,
    dirty: false,
    syncError: null,
    authRequired: false,
    canUploadLocal: false,
    serverNotice: null,
    dismissServerNotice: () => set({ serverNotice: null }),

    tombstones: [],
    settingsUpdatedAt: 0,

    hydrate: async () => {
      const local = await loadPersistedData();
      set({
        reminders: local.reminders,
        tags: local.tags,
        settings: local.settings,
        loaded: true,
      });

      const detection = await detectAppMode();
      if (detection.mode === 'client') {
        // 客户端模式：数据存 IndexedDB。纯静态部署不发任何 /api 请求；
        // 本机选择（local）时探测一次后端可达性，供设置页置灰 / WebDAV 自动选路。
        set({ mode: 'client', authRequired: false });
        if (detection.source === 'local' && !detection.staticOnly) {
          const health = await probeHealth();
          if (health !== null) {
            set({
              serverReachable: true,
              authMode: health.authMode,
              revision: health.revision,
              authWarning: health.authWarning,
            });
          } else {
            set({ serverReachable: false, authWarning: false });
          }
        } else {
          set({ serverReachable: false, authWarning: false });
        }
        return;
      }
      set({ mode: 'server' });

      const health = detection.health ?? (await probeHealth());
      if (health === null) {
        // 显式服务器模式但后端不可达：保留服务器模式与本地数据，提示错误。
        set({ syncError: '连不上服务器，请检查网络或后端地址', serverReachable: false });
        const fallback = await loadServerCache().catch(() => null);
        if (fallback !== null) {
          set({
            reminders: fallback.reminders,
            tags: fallback.tags,
            settings: mergeServerSettings(local.settings, fallback.settings.value),
            revision: fallback.revision,
            settingsUpdatedAt: fallback.settings.updatedAt,
            tombstones: fallback.tombstones,
          });
        }
        return;
      }
      set({
        authMode: health.authMode,
        revision: health.revision,
        serverReachable: true,
        authWarning: health.authWarning,
      });

      const cache = await loadServerCache().catch(() => null);
      try {
        const full = normalizeFullSnapshot(await fetchFullData());
        const snapshot = full;
        // 服务器图片字节落到本机 IndexedDB，卡片在新设备上也能显示。
        if (full.images.length > 0) {
          const blobs: Record<string, Blob> = {};
          for (const image of full.images) blobs[image.name] = new Blob([base64ToBytes(image.data) as BlobPart]);
          await replaceImageBlobs(blobs);
        }
        const localHasData = local.reminders.length > 0 || local.tags.length > 0;
        const serverEmpty =
          snapshot.revision === 0 &&
          snapshot.reminders.length === 0 &&
          snapshot.tags.length === 0 &&
          Object.keys(snapshot.settings.value).length === 0;
        if (serverEmpty && localHasData) {
          // 服务器为空而本机有旧数据：保留本机显示，提示一键上传。
          set({
            settings: mergeServerSettings(local.settings, snapshot.settings.value),
            canUploadLocal: true,
            revision: snapshot.revision,
            settingsUpdatedAt: snapshot.settings.updatedAt,
            tombstones: snapshot.tombstones,
            serverImageNames: snapshot.imageNames,
          });
        } else {
          const staleCache = cache !== null && cache.revision !== snapshot.revision;
          adoptSnapshot(snapshot, {
            canUploadLocal: false,
            ...(staleCache ? { serverNotice: '已按服务器数据更新' } : {}),
          });
        }
        void refreshVersion();
      } catch (error) {
        if (isUnauthorized(error)) {
          handleUnauthorized();
        } else {
          set({ syncError: error instanceof Error ? error.message : '读取服务器数据失败' });
        }
        if (cache !== null) {
          set({
            reminders: cache.reminders,
            tags: cache.tags,
            settings: mergeServerSettings(local.settings, cache.settings.value),
            revision: cache.revision,
            settingsUpdatedAt: cache.settings.updatedAt,
            tombstones: cache.tombstones,
          });
        }
      }
    },

    refresh: async (force = false) => {
      if (get().mode !== 'server') return;
      // 本机有未同步改动时不动，避免覆盖用户编辑。
      if (get().dirty && !force) return;
      try {
        const snapshot = normalizeSnapshot(await fetchData());
        if (!force && get().revision === snapshot.revision) return;
        adoptSnapshot(snapshot);
        void refreshVersion();
      } catch (error) {
        if (isUnauthorized(error)) {
          handleUnauthorized();
          return;
        }
        set({ syncError: error instanceof Error ? error.message : '同步失败，请稍后重试' });
      }
    },

    syncNow: async () => {
      if (get().mode !== 'server') return;
      if (get().canUploadLocal) {
        await get().uploadLocalData();
        return;
      }
      await pushToServer();
    },

    login: async (username, password) => {
      await apiLogin(username, password);
      set({ authRequired: false, serverUser: username, syncError: null });
      await get().refresh(true);
    },

    logout: async () => {
      try {
        await apiLogout();
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
      }
      set({ authRequired: true, serverUser: null });
    },

    uploadLocalData: async () => {
      const now = Date.now();
      set({
        reminders: get().reminders.map((item) => withUpdatedAt(item, now)),
        tags: get().tags.map((item) => withUpdatedAt(item, now)),
        settingsUpdatedAt: now,
        canUploadLocal: false,
      });
      await pushToServer();
    },

    migrateToClient: async () => {
      const startedAt = Date.now();
      // 后端全量（含图片字节）→ 整体覆盖本机 IndexedDB。
      const full = normalizeFullSnapshot(await fetchFullData());
      const localReminders = toLocalReminders(full.reminders);
      const localTags = toLocalTags(full.tags);
      const mergedSettings = mergeServerSettings(get().settings, full.settings.value);
      const blobs: Record<string, Blob> = {};
      for (const image of full.images) blobs[image.name] = new Blob([base64ToBytes(image.data) as BlobPart]);
      await replaceImageBlobs(blobs);
      await savePersistedData({ reminders: localReminders, tags: localTags, settings: mergedSettings });
      set({
        mode: 'client',
        reminders: localReminders,
        tags: localTags,
        settings: mergedSettings,
        revision: full.revision,
        settingsUpdatedAt: full.settings.updatedAt,
        tombstones: [],
        serverImageNames: full.imageNames,
        serverReachable: true,
        dirty: false,
        syncError: null,
        authRequired: false,
        canUploadLocal: false,
      });
      writeStoredAppMode('client');
      const actualImageNames = await listImageNames();
      const expected = countsOf(full.reminders, full.tags, full.imageNames);
      const actual = countsOf(localReminders, localTags, actualImageNames);
      const verification = verifyMigration({
        expected,
        actual,
        sampleOk: samplesMatch(full.reminders, localReminders, full.tags, localTags),
        actualImageNames,
      });
      return {
        direction: 'server-to-client',
        counts: actual,
        elapsedMs: Date.now() - startedAt,
        revision: full.revision,
        verification,
      };
    },

    migrateToServer: async () => {
      const startedAt = Date.now();
      const { reminders, tags, settings } = get();
      const at = Date.now();
      // 本机全量（含图片字节）→ 整体覆盖服务器。
      const localImageNames = await listImageNames();
      const wireImages = [];
      for (const name of localImageNames) {
        const blob = await loadImageBlob(name);
        if (blob === undefined) continue;
        wireImages.push({ name, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
      }
      const payload: ReplacePayload = {
        reminders: toServerReminders(reminders, at).map(toSyncReminder),
        tags: toServerTags(tags, at).map(toSyncTag),
        settings: { value: syncedSettings(settings), updatedAt: at },
        images: wireImages,
      };
      const result = await replaceData(payload);
      const snapshot = normalizeSnapshot(result);
      adoptSnapshot(snapshot, { mode: 'server', serverReachable: true });
      writeStoredAppMode('server');
      const expected = countsOf(reminders, tags, wireImages.map((image) => image.name));
      const actual = countsOf(snapshot.reminders, snapshot.tags, snapshot.imageNames);
      const verification = verifyMigration({
        expected,
        actual,
        sampleOk: samplesMatch(reminders, snapshot.reminders, tags, snapshot.tags),
        actualImageNames: snapshot.imageNames,
      });
      return {
        direction: 'client-to-server',
        counts: actual,
        elapsedMs: Date.now() - startedAt,
        revision: snapshot.revision,
        verification,
      };
    },

    addReminder: async (item) => {
      const mode = get().mode;
      const id = item.id > 0 ? item.id : nextNumericId(get().reminders);
      const created: ReminderItem = mode === 'server'
        ? withUpdatedAt({ ...item, id }, Date.now())
        : { ...item, id };
      set({ reminders: [...get().reminders, created] });
      await persist({ synced: true });
      return id;
    },

    updateReminder: async (item) => {
      const next = get().mode === 'server' ? withUpdatedAt(item, Date.now()) : item;
      set({ reminders: get().reminders.map((existing) => (existing.id === item.id ? next : existing)) });
      await persist({ synced: true });
    },

    deleteReminder: async (id) => {
      if (get().mode === 'server') {
        const tombstone: SyncTombstone = { id, updatedAt: Date.now(), kind: 'reminder' };
        set({
          reminders: get().reminders.filter((item) => item.id !== id),
          tombstones: [...get().tombstones.filter((t) => !(t.kind === 'reminder' && t.id === id)), tombstone],
        });
      } else {
        set({ reminders: get().reminders.filter((item) => item.id !== id) });
      }
      await persist({ synced: true });
    },

    togglePin: async (id) => {
      const at = Date.now();
      set({
        reminders: get().reminders.map((item) =>
          item.id === id
            ? get().mode === 'server'
              ? withUpdatedAt({ ...item, isPinned: !item.isPinned }, at)
              : { ...item, isPinned: !item.isPinned }
            : item,
        ),
      });
      await persist({ synced: true });
    },

    findTag: (name) => {
      const key = name.trim().toLowerCase();
      return get().tags.find((tag) => tag.name.trim().toLowerCase() === key);
    },

    addTag: async (name, color) => {
      const trimmed = name.trim();
      if (trimmed === '') return undefined;
      const existing = get().findTag(trimmed);
      if (existing !== undefined) return existing;
      const tags = get().tags;
      const sortOrder = tags.reduce((max, tag) => Math.max(max, tag.sortOrder), 0) + 1;
      const chosenColor = color ?? DEFAULT_TAG_COLORS[tags.length % DEFAULT_TAG_COLORS.length] ?? '#2196F3';
      const base: TagItem = { id: nextNumericId(tags), name: trimmed, color: chosenColor, sortOrder };
      const created: TagItem = get().mode === 'server' ? withUpdatedAt(base, Date.now()) : base;
      set({ tags: [...tags, created] });
      await persist({ synced: true });
      return created;
    },

    updateTag: async (id, name, color) => {
      const trimmed = name.trim();
      if (trimmed === '') return;
      const current = get().tags.find((tag) => tag.id === id);
      if (current === undefined) return;
      const oldKey = current.name.trim().toLowerCase();
      const at = Date.now();
      const server = get().mode === 'server';
      const tags = get()
        .tags.map((tag) => (tag.id === id ? (server ? withUpdatedAt({ ...tag, name: trimmed, color }, at) : { ...tag, name: trimmed, color }) : tag))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const reminders = get().reminders.map((item) =>
        item.tag.trim().toLowerCase() === oldKey
          ? server
            ? withUpdatedAt({ ...item, tag: trimmed }, at)
            : { ...item, tag: trimmed }
          : item,
      );
      set({ tags, reminders });
      await persist({ synced: true });
    },

    deleteTag: async (id) => {
      const current = get().tags.find((tag) => tag.id === id);
      if (current === undefined) return;
      const key = current.name.trim().toLowerCase();
      const at = Date.now();
      const server = get().mode === 'server';
      const reminders = get().reminders.map((item) =>
        item.tag.trim().toLowerCase() === key
          ? server
            ? withUpdatedAt({ ...item, tag: '' }, at)
            : { ...item, tag: '' }
          : item,
      );
      if (server) {
        const tombstone: SyncTombstone = { id, updatedAt: at, kind: 'tag' };
        set({
          tags: get().tags.filter((tag) => tag.id !== id),
          reminders,
          tombstones: [...get().tombstones.filter((t) => !(t.kind === 'tag' && t.id === id)), tombstone],
        });
      } else {
        set({ tags: get().tags.filter((tag) => tag.id !== id), reminders });
      }
      await persist({ synced: true });
    },

    moveTag: async (id, direction) => {
      const ordered = [...get().tags].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.findIndex((tag) => tag.id === id);
      if (index < 0) return;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= ordered.length) return;
      const reordered = [...ordered];
      const [moved] = reordered.splice(index, 1);
      if (moved === undefined) return;
      reordered.splice(target, 0, moved);
      const at = Date.now();
      const server = get().mode === 'server';
      const tags = reordered.map((tag, position) =>
        server ? withUpdatedAt({ ...tag, sortOrder: position + 1 }, at) : { ...tag, sortOrder: position + 1 },
      );
      set({ tags });
      await persist({ synced: true });
    },

    updateSettings: async (partial) => {
      const synced = isSyncedSettingsChange(partial);
      set({
        settings: { ...get().settings, ...partial },
        ...(synced && get().mode === 'server' ? { settingsUpdatedAt: Date.now() } : {}),
      });
      await persist({ synced });
    },

    importData: async (data) => {
      const server = get().mode === 'server';
      const at = Date.now();
      const previousReminderIds = new Set(get().reminders.map((item) => item.id));
      const previousTagIds = new Set(get().tags.map((item) => item.id));
      const reminders = server
        ? data.reminders.map((item) => withUpdatedAt(item, at))
        : data.reminders;
      const tags = server ? data.tags.map((item) => withUpdatedAt(item, at)) : data.tags;
      const tombstones = server
        ? [
            ...get().tombstones.filter(
              (t) =>
                !(t.kind === 'reminder' && reminders.some((item) => item.id === t.id)) &&
                !(t.kind === 'tag' && tags.some((item) => item.id === t.id)),
            ),
            ...[...previousReminderIds]
              .filter((id) => !reminders.some((item) => item.id === id))
              .map((id) => ({ id, updatedAt: at, kind: 'reminder' as const })),
            ...[...previousTagIds]
              .filter((id) => !tags.some((item) => item.id === id))
              .map((id) => ({ id, updatedAt: at, kind: 'tag' as const })),
          ]
        : get().tombstones;
      set({
        reminders,
        tags,
        settings: { ...get().settings, ...(data.settings ?? {}) },
        tombstones,
        ...(server ? { settingsUpdatedAt: at } : {}),
      });
      await persist({ synced: true });
    },

    resetAll: async () => {
      if (get().mode === 'server') {
        const at = Date.now();
        const tombstones: SyncTombstone[] = [
          ...get().reminders.map((item) => ({ id: item.id, updatedAt: at, kind: 'reminder' as const })),
          ...get().tags.map((item) => ({ id: item.id, updatedAt: at, kind: 'tag' as const })),
        ];
        await clearAllData();
        set({
          reminders: [],
          tags: [],
          settings: { ...DEFAULT_SETTINGS },
          tombstones,
          settingsUpdatedAt: at,
          canUploadLocal: false,
        });
        await persist({ synced: true });
        return;
      }
      await clearAllData();
      set({ reminders: [], tags: [], settings: { ...DEFAULT_SETTINGS } });
      await persist({ synced: false });
    },
  };
});

/** 服务器模式下刷新版本信息（best-effort，失败忽略）。 */
async function refreshVersion(): Promise<void> {
  try {
    const info = await fetchVersion();
    useReminderStore.setState({ serverVersion: info.version ?? info.server ?? null });
  } catch {
    // 忽略：版本信息仅用于展示。
  }
}
