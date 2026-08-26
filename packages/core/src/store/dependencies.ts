/**
 * DependencyRepository — 启动顺序 DAG 边
 *
 * 表 startup_dependency (item_id, depends_on)
 * 用法：
 *   const deps = new DependencyRepository(db)
 *   deps.add(itemId, dependsOnId)   // item 必须在 dependsOn 之后启动
 *   deps.remove(itemId, dependsOnId)
 *   deps.listFor(itemId)             // { outgoing: [id], incoming: [id] }
 *   deps.detectCycle(startId)        // 返回循环路径或 null
 */

import type { Database } from 'better-sqlite3';

export interface DependencyInfo {
  outgoing: string[]; // 这个 item 依赖谁（这些必须先启动）
  incoming: string[]; // 谁依赖这个 item
}

export class DependencyRepository {
  constructor(private readonly db: Database) {}

  add(itemId: string, dependsOn: string): { ok: true } | { ok: false; reason: string } {
    if (itemId === dependsOn) return { ok: false, reason: 'self_dependency' };
    // 检查 cycle：dependsOn 不能再依赖 itemId（直接或间接）
    if (this.wouldCreateCycle(itemId, dependsOn)) {
      return { ok: false, reason: 'cycle_detected' };
    }
    try {
      this.db
        .prepare('INSERT INTO startup_dependency (item_id, depends_on) VALUES (?, ?)')
        .run(itemId, dependsOn);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) {
        return { ok: false, reason: 'duplicate' };
      }
      throw e;
    }
  }

  remove(itemId: string, dependsOn: string): boolean {
    const r = this.db
      .prepare('DELETE FROM startup_dependency WHERE item_id = ? AND depends_on = ?')
      .run(itemId, dependsOn);
    return r.changes > 0;
  }

  listFor(itemId: string): DependencyInfo {
    const outgoing = this.db
      .prepare('SELECT depends_on FROM startup_dependency WHERE item_id = ?')
      .all(itemId) as Array<{ depends_on: string }>;
    const incoming = this.db
      .prepare('SELECT item_id FROM startup_dependency WHERE depends_on = ?')
      .all(itemId) as Array<{ item_id: string }>;
    return {
      outgoing: outgoing.map((r) => r.depends_on),
      incoming: incoming.map((r) => r.item_id),
    };
  }

  /**
   * 添加 itemId -> dependsOn 边是否会产生循环？
   * 走 dependsOn 的所有祖先（能到达的 depends_on 链），
   * 如果其中有 itemId，则会产生循环。
   */
  private wouldCreateCycle(itemId: string, dependsOn: string): boolean {
    const visited = new Set<string>();
    const stack = [dependsOn];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === itemId) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const rows = this.db
        .prepare('SELECT depends_on FROM startup_dependency WHERE item_id = ?')
        .all(cur) as Array<{ depends_on: string }>;
      for (const r of rows) stack.push(r.depends_on);
    }
    return false;
  }
}
