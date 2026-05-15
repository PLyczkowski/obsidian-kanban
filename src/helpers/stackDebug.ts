import { App } from 'obsidian';
import { Board, Lane } from 'src/components/types';

const debugKey = 'kanban-stack-debug';

export function isStackDebugEnabled() {
  try {
    return activeWindow?.localStorage?.getItem(debugKey) === '1';
  } catch {
    return false;
  }
}

export function summarizeLaneStacks(lanes: Lane[]) {
  return lanes.map((lane, index) => ({
    index,
    title: lane.data.title,
    id: lane.id,
    stack: lane.data.stack || '(implicit)',
    color: lane.data.color || '',
    cards: lane.children.length,
  }));
}

export function logStackDebug(label: string, data: Record<string, any> = {}) {
  if (!isStackDebugEnabled()) return;

  console.groupCollapsed(`[kanban-stack-debug] ${label}`);
  Object.entries(data).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      console.log(key);
      console.table(value);
    } else {
      console.log(key, value);
    }
  });
  console.groupEnd();
}

export function logBoardStacks(label: string, board: Board, data: Record<string, any> = {}) {
  logStackDebug(label, {
    file: board.id,
    lanes: summarizeLaneStacks(board.children),
    ...data,
  });
}

export function writeStackDebugToVault(
  app: App,
  label: string,
  board: Board,
  data: Record<string, any> = {}
) {
  if (!isStackDebugEnabled()) return;

  const entry = {
    time: new Date().toISOString(),
    label,
    file: board.id,
    lanes: summarizeLaneStacks(board.children),
    ...data,
  };

  try {
    const adapter = app.vault.adapter as any;
    const line = JSON.stringify(entry) + '\n';

    if (typeof adapter.append === 'function') {
      adapter.append('.kanban-stack-debug.log', line).catch(console.error);
    } else if (typeof adapter.read === 'function' && typeof adapter.write === 'function') {
      adapter
        .read('.kanban-stack-debug.log')
        .catch(() => '')
        .then((existing: string) => adapter.write('.kanban-stack-debug.log', existing + line))
        .catch(console.error);
    }
  } catch (e) {
    console.error(e);
  }
}
