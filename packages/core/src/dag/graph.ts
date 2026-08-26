/**
 * DAG — 启动项依赖图 + 拓扑排序
 *
 * 用邻接表表示 item → [depends on]
 * 节点状态：'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped'
 */

import type { StartupItemRow } from '../store/index.js';

export type NodeStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped';

export interface DagNode {
  item: StartupItemRow;
  depends_on: string[]; // ids
  status: NodeStatus;
}

export class Dag {
  private nodes: Map<string, DagNode>;

  constructor(items: StartupItemRow[], deps: Map<string, string[]>) {
    this.nodes = new Map();
    for (const it of items) {
      this.nodes.set(it.id, { item: it, depends_on: deps.get(it.id) ?? [], status: 'pending' });
    }
  }

  size(): number {
    return this.nodes.size;
  }

  get(id: string): DagNode | undefined {
    return this.nodes.get(id);
  }

  setStatus(id: string, status: NodeStatus): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.status = status;
  }

  /**
   * 返回当前 status='pending' 且所有依赖都 status='done' 的节点
   * （不做 enabled/disabled 过滤，由调用方在传入前 filter）
   */
  readyNodes(now: number): DagNode[] {
    const out: DagNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.status !== 'pending') continue;
      // 延迟：now < scheduled_at 视为未到期
      if (now < n.item.delay_ms) continue;
      let allReady = true;
      for (const dep of n.depends_on) {
        const d = this.nodes.get(dep);
        if (!d) {
          allReady = false;
          break;
        } // 依赖不存在视为阻塞
        if (d.status !== 'done') {
          allReady = false;
          break;
        }
      }
      if (allReady) out.push(n);
    }
    return out;
  }

  /** 是否所有节点都终止 */
  allTerminal(): boolean {
    for (const n of this.nodes.values()) {
      if (n.status === 'pending' || n.status === 'ready' || n.status === 'running') return false;
    }
    return true;
  }

  /** 验证图无环（仅走 depends_on 边） */
  static validate(
    items: StartupItemRow[],
    deps: Map<string, string[]>,
  ): { ok: true } | { ok: false; cycle: string[] } {
    const adj = new Map<string, string[]>();
    for (const it of items) adj.set(it.id, deps.get(it.id) ?? []);
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    for (const id of adj.keys()) color.set(id, WHITE);

    const _path: string[] = [];
    function dfs(u: string): string[] | null {
      color.set(u, GRAY);
      for (const v of adj.get(u) ?? []) {
        if (color.get(v) === GRAY) {
          // 回边 → 环。重建环路径
          const cycle: string[] = [v, u];
          let cur: string | null = parent.get(u) ?? null;
          while (cur && cur !== v) {
            cycle.push(cur);
            cur = parent.get(cur) ?? null;
          }
          cycle.reverse();
          return cycle;
        }
        if (color.get(v) === WHITE) {
          parent.set(v, u);
          const c = dfs(v);
          if (c) return c;
        }
      }
      color.set(u, BLACK);
      return null;
    }

    for (const id of adj.keys()) {
      if (color.get(id) === WHITE) {
        parent.set(id, null);
        const cycle = dfs(id);
        if (cycle) return { ok: false, cycle };
      }
    }
    return { ok: true };
  }
}
