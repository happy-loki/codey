import { writable, get } from 'svelte/store';
import { canonicalPathKey } from '../utils/pathNormalize';

export type NodeStatus = 'normal' | 'deleting';

export type FsEntry = {
  name: string;
  isDirectory: boolean;
  fingerprint?: string | null;
};

export type NodeMeta = {
  id: number;
  name: string;
  path: string;
  isDirectory: boolean;
  isLoaded: boolean;
  hasChildren: boolean;
  fingerprint: string | null;
  status: NodeStatus;
};

export type VisibleRow = {
  id: number;
  name: string;
  path: string;
  depth: number;
  isDirectory: boolean;
  isLoaded: boolean;
  hasChildren: boolean;
  expanded?: boolean;
  fingerprint: string | null;
  status: NodeStatus;
};

// Internal state (immutable updates via helpers)
let nextId = 1;

const _nodesById = writable(new Map<number, NodeMeta>());
const _pathToId = writable(new Map<string, number>());
const _childrenByPath = writable(new Map<string, number[]>());
const _expanded = writable(new Set<number>());
const _rootPath = writable<string>('');
const _rootId = writable<number>(0);
const _childrenEpoch = new Map<string, number>();

export const visibleRows = writable<VisibleRow[]>([]);
export const selectedPath = writable<string | null>(null);
export const revealTargetPath = writable<string | null>(null);
let _lastSelected: string | null = null;
export const rootPath = {
  subscribe: _rootPath.subscribe,
};


function bumpChildrenEpoch(path: string) {
  const next = (_childrenEpoch.get(path) ?? 0) + 1;
  _childrenEpoch.set(path, next);
}

export function getChildrenEpoch(path: string): number {
  return _childrenEpoch.get(path) ?? 0;
}

export function getRootPath(): string {
  try {
    return get(_rootPath);
  } catch {
    return '';
  }
}

export function setSelectedPath(p: string | null) {
  const v = p ?? null;
  if (v === _lastSelected) return;
  _lastSelected = v;
  selectedPath.set(v);
}

export function requestReveal(path: string | null) {
  revealTargetPath.set(path ?? null);
}

function cloneMap<K, V>(m: Map<K, V>): Map<K, V> {
  return new Map(m);
}

function cloneSet<T>(s: Set<T>): Set<T> {
  return new Set(s);
}

export function resetAll() {
  nextId = 1;
  _nodesById.set(new Map());
  _pathToId.set(new Map());
  _childrenByPath.set(new Map());
  _expanded.set(new Set());
  _rootPath.set('');
  _rootId.set(0);
  visibleRows.set([]);
  _lastSelected = null;
  selectedPath.set(null);
  revealTargetPath.set(null);
  _childrenEpoch.clear();
}

// 合并重算：同一帧内的多次变更只触发一次可见行重算
let recomputeScheduled = false;
function scheduleRecompute() {
  if (recomputeScheduled) return;
  recomputeScheduled = true;
  const raf = (globalThis as any).requestAnimationFrame as ((cb: () => void) => number) | undefined;
  const run = () => { recomputeScheduled = false; doRecomputeVisible(); };
  if (typeof raf === 'function') raf(run); else Promise.resolve().then(run);
}

export function initRoot(name: string, path: string) {
  resetAll();
  const id = nextId++;
  const root: NodeMeta = {
    id,
    name,
    path,
    isDirectory: true,
    isLoaded: true,
    hasChildren: false,
    fingerprint: null,
    status: 'normal',
  };
  const nodes = new Map<number, NodeMeta>();
  nodes.set(id, root);
  const p2i = new Map<string, number>();
  p2i.set(path, id);
  _nodesById.set(nodes);
  _pathToId.set(p2i);
  _childrenByPath.set(new Map([[path, []]]));
  _rootPath.set(path);
  _rootId.set(id);
  _childrenEpoch.set(path, 0);
  // 默认展开根
  _expanded.set(new Set([id]));
  scheduleRecompute();
}

export function applyChildren(parentPath: string, entries: FsEntry[]) {
  const nodes = cloneMap(get(_nodesById));
  const p2i = cloneMap(get(_pathToId));
  const children = [] as number[];

  for (const e of entries) {
    // 前端环境没有 Node 的 process 对象，不能用 process.platform。
    // 根据父路径推断分隔符：包含 '\\' 则用 Windows 分隔符，否则用 '/'
    const sep = parentPath.includes('\\') ? '\\' : '/';
    const needsSep = !(parentPath.endsWith('/') || parentPath.endsWith('\\'));
    const childPath = `${parentPath}${needsSep ? sep : ''}${e.name}`;
    let id = p2i.get(childPath);
    if (!id) {
      id = nextId++;
      p2i.set(childPath, id);
    }
    const prev = nodes.get(id);
    const incomingFingerprint = e.fingerprint ?? null;
    const resolvedFingerprint = incomingFingerprint ?? prev?.fingerprint ?? null;
    const sameFingerprint =
      !!prev && prev.fingerprint !== null && resolvedFingerprint !== null && prev.fingerprint === resolvedFingerprint;
    const status: NodeStatus = sameFingerprint ? prev?.status ?? 'normal' : 'normal';
    const meta: NodeMeta = {
      id,
      name: e.name,
      path: childPath,
      isDirectory: !!e.isDirectory,
      isLoaded: !e.isDirectory, // 文件视为已加载
      hasChildren: !!e.isDirectory,
      fingerprint: resolvedFingerprint,
      status,
    };
    nodes.set(id, meta);
    children.push(id);
    // 初始化空 children 列表，避免访问空指针
    if (e.isDirectory && !get(_childrenByPath).has(childPath)) {
      _childrenByPath.update((m) => {
        const mm = cloneMap(m);
        mm.set(childPath, []);
        return mm;
      });
    }
  }

  // 覆盖父目录的 children 顺序（目录优先 + 名称自然序）
  const sortedChildren = children.sort((a, b) => {
    const A = nodes.get(a)!;
    const B = nodes.get(b)!;
    if (A.isDirectory !== B.isDirectory) return A.isDirectory ? -1 : 1;
    return A.name.localeCompare(B.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  _nodesById.set(nodes);
  _pathToId.set(p2i);
  _childrenByPath.update((m) => {
    const mm = cloneMap(m);
    mm.set(parentPath, sortedChildren);
    return mm;
  });
  // 标记父目录已加载且有无子项
  const pid = p2i.get(parentPath);
  if (pid) {
    const parentNode = nodes.get(pid)!;
    nodes.set(pid, {
      ...parentNode,
      isLoaded: true,
      hasChildren: sortedChildren.length > 0,
    });
    _nodesById.set(nodes);
  }
  bumpChildrenEpoch(parentPath);
  scheduleRecompute(); // 始终触发重算，确保新增的文件/文件夹能被显示
}

export function setExpandedByPath(parentPath: string, expanded: boolean) {
  const p2i = get(_pathToId);
  const id = p2i.get(parentPath);
  if (!id) return;
  setExpandedById(id, expanded);
}

export function setExpandedById(id: number, expanded: boolean) {
  const exp = cloneSet(get(_expanded));
  if (expanded) exp.add(id); else exp.delete(id);
  _expanded.set(exp);
  scheduleRecompute();
}

export function toggleExpandedById(id: number) {
  const exp = cloneSet(get(_expanded));
  if (exp.has(id)) exp.delete(id); else exp.add(id);
  _expanded.set(exp);
  scheduleRecompute();
}

export function applyRemove(path: string) {
  const p2i = cloneMap(get(_pathToId));
  const nodes = cloneMap(get(_nodesById));
  const chMap = cloneMap(get(_childrenByPath));
  const id = p2i.get(path);
  if (!id) return;
  // 从父 children 中移除
  let affectedParent: string | null = null;
  for (const [pp, ids] of chMap.entries()) {
    const idx = ids.indexOf(id);
    if (idx >= 0) {
      const n = ids.slice(); n.splice(idx, 1); chMap.set(pp, n);
      affectedParent = pp;
      break;
    }
  }
  // 清理本节点
  chMap.delete(path);
  nodes.delete(id);
  p2i.delete(path);
  _childrenByPath.set(chMap);
  _nodesById.set(nodes);
  _pathToId.set(p2i);
  if (affectedParent) {
    bumpChildrenEpoch(affectedParent);
    if (isPathVisible(affectedParent)) scheduleRecompute();
  }
}

export function applyRename(oldPath: string, newPath: string, newName: string) {
  const p2i = cloneMap(get(_pathToId));
  const nodes = cloneMap(get(_nodesById));
  const chMap = cloneMap(get(_childrenByPath));
  const id = p2i.get(oldPath);
  if (!id) return;
  p2i.delete(oldPath);
  p2i.set(newPath, id);
  const meta = nodes.get(id)!;
  nodes.set(id, { ...meta, name: newName, path: newPath });
  // children 键迁移
  const children = chMap.get(oldPath);
  if (children) {
    chMap.delete(oldPath);
    chMap.set(newPath, children);
  }
  _childrenByPath.set(chMap);
  _nodesById.set(nodes);
  _pathToId.set(p2i);
  const oldParent = parentOf(oldPath);
  const newParent = parentOf(newPath);
  if (oldParent) bumpChildrenEpoch(oldParent);
  if (newParent && newParent !== oldParent) bumpChildrenEpoch(newParent);
  if ((oldParent && isPathVisible(oldParent)) || (newParent && isPathVisible(newParent))) scheduleRecompute();
}

export function getNodeByPath(path: string): NodeMeta | undefined {
  const nodes = get(_nodesById);
  const exactId = get(_pathToId).get(path);
  if (exactId) return nodes.get(exactId);

  // The editor and the file tree can use different Windows separators/casing.
  // Keep the tree's original path as the canonical value for subsequent updates.
  const key = canonicalPathKey(path);
  if (!key) return undefined;
  for (const node of nodes.values()) {
    if (canonicalPathKey(node.path) === key) return node;
  }
  return undefined;
}

export function setNodeStatus(path: string, status: NodeStatus | null) {
  const p2i = get(_pathToId);
  const id = p2i.get(path);
  if (!id) return;
  const nodes = cloneMap(get(_nodesById));
  const node = nodes.get(id);
  if (!node) return;
  const nextStatus = status ?? 'normal';
  if (node.status === nextStatus && status !== null) return;
  nodes.set(id, { ...node, status: nextStatus });
  _nodesById.set(nodes);
  if (isPathVisible(path)) scheduleRecompute();
}

function recomputeVisibleFromId(_id: number) { scheduleRecompute(); }
function recomputeVisibleFrom(_parentPath: string) { scheduleRecompute(); }

function doRecomputeVisible() {
  const rows: VisibleRow[] = [];
  const nodes = get(_nodesById);
  const chMap = get(_childrenByPath);
  const exp = get(_expanded);
  const rootPath = get(_rootPath);
  const rootId = get(_rootId);
  const root = nodes.get(rootId);
  if (!root) { visibleRows.set([]); return; }

  const pushRow = (id: number, depth: number) => {
    const n = nodes.get(id)!;
    rows.push({
      id: n.id,
      name: n.name,
      path: n.path,
      depth,
      isDirectory: n.isDirectory,
      isLoaded: n.isLoaded,
      hasChildren: n.hasChildren,
      expanded: exp.has(id),
      fingerprint: n.fingerprint ?? null,
      status: n.status ?? 'normal',
    });
  };

  const stack: Array<{ path: string; id: number; depth: number; idx: number }>=[];
  pushRow(rootId, 0);
  if (!exp.has(rootId)) { visibleRows.set(rows); return; }
  stack.push({ path: rootPath, id: rootId, depth: 0, idx: 0 });

  while (stack.length) {
    const top = stack[stack.length - 1];
    const children = chMap.get(top.path) || [];
    if (top.idx >= children.length) { stack.pop(); continue; }
    const cid = children[top.idx++];
    pushRow(cid, top.depth + 1);
    const childNode = nodes.get(cid)!;
    if (childNode.isDirectory && exp.has(cid)) {
      stack.push({ path: childNode.path, id: cid, depth: top.depth + 1, idx: 0 });
    }
  }

  visibleRows.set(rows);
}

// 对外保持同名 API，但内部是合并调度
export function recomputeVisible() { scheduleRecompute(); }

export function collapseAllFolders() {
  // 保留根节点的展开状态，折叠其他所有节点
  const rootId = get(_rootId);
  _expanded.set(new Set([rootId]));
  scheduleRecompute();
}

function isPathVisible(p: string): boolean {
  const root = get(_rootPath);
  if (p === root) return true;
  const p2i = get(_pathToId);
  const id = p2i.get(p);
  if (!id) return false;
  const exp = get(_expanded);
  return exp.has(id);
}

function parentOf(p: string | undefined): string | null {
  if (!p) return null;
  const hasBack = p.includes('\\');
  const sep = hasBack ? '\\' : '/';
  const idx = p.lastIndexOf(sep);
  if (idx <= 0) return null;
  return p.slice(0, idx);
}
