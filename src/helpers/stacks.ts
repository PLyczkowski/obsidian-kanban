import update from 'immutability-helper';

import { generateInstanceId } from 'src/components/helpers';
import { Lane } from 'src/components/types';
import { logStackDebug, summarizeLaneStacks } from './stackDebug';

export type StackDropPlacement = 'stack-before' | 'stack-after' | 'lane-before' | 'lane-after';

export interface LaneStack {
  id: string;
  lanes: Array<{ lane: Lane; index: number }>;
}

export interface StackDropTarget {
  placement: StackDropPlacement;
  targetLaneIndex?: number;
  targetStackId?: string;
}

export function getLaneStackId(lane: Lane) {
  return lane.data.stack || lane.id;
}

function setLaneStack(lane: Lane, stack: string) {
  if (lane.data.stack === stack) return lane;

  return update(lane, { data: { stack: { $set: stack } } });
}

export function ensureExplicitLaneStacks(lanes: Lane[]) {
  return lanes.map((lane) => setLaneStack(lane, getLaneStackId(lane)));
}

export function getLaneStacks(lanes: Lane[]): LaneStack[] {
  const stacks: LaneStack[] = [];
  let currentStack: LaneStack | null = null;

  lanes.forEach((lane, index) => {
    const stackId = getLaneStackId(lane);

    if (!currentStack || currentStack.id !== stackId) {
      currentStack = { id: stackId, lanes: [] };
      stacks.push(currentStack);
    }

    currentStack.lanes.push({ lane, index });
  });

  logStackDebug('render:getLaneStacks', {
    lanes: summarizeLaneStacks(lanes),
    stacks: stacks.map((stack, index) => ({
      index,
      stack: stack.id,
      laneTitles: stack.lanes.map(({ lane }) => lane.data.title).join(' | '),
      laneIndexes: stack.lanes.map(({ index }) => index).join(', '),
    })),
  });

  return stacks;
}

function getUniqueStackId(lane: Lane, lanes: Lane[]) {
  const stackIds = new Set(lanes.map(getLaneStackId));
  let stackId = lane.id;

  while (stackIds.has(stackId)) {
    stackId = `${lane.id}-${generateInstanceId(4)}`;
  }

  return stackId;
}

function flattenStacks(stacks: LaneStack[]) {
  return stacks.reduce<Lane[]>((result, stack) => {
    stack.lanes.forEach(({ lane }) => result.push(lane));
    return result;
  }, []);
}

export function moveLaneInStacks(
  lanes: Lane[],
  dragIndex: number,
  target: StackDropTarget
) {
  const draggedLane = lanes[dragIndex];
  if (!draggedLane) {
    logStackDebug('moveLaneInStacks:missing-dragged-lane', {
      dragIndex,
      target,
      lanes: summarizeLaneStacks(lanes),
    });
    return lanes;
  }

  const originalDragStackId = getLaneStackId(draggedLane);
  const originalStackCount = lanes.filter((lane) => getLaneStackId(lane) === originalDragStackId)
    .length;
  const entries = ensureExplicitLaneStacks(lanes).map((lane, index) => ({ lane, index }));
  const [dragged] = entries.splice(dragIndex, 1);

  if (!dragged) {
    logStackDebug('moveLaneInStacks:missing-dragged-entry', {
      dragIndex,
      target,
      lanes: summarizeLaneStacks(lanes),
    });
    return lanes;
  }

  if (target.placement === 'lane-before' || target.placement === 'lane-after') {
    const targetLane = lanes[target.targetLaneIndex ?? -1];
    if (!targetLane || targetLane.id === dragged.lane.id) {
      const result = ensureExplicitLaneStacks(lanes);
      logStackDebug('moveLaneInStacks:lane-target-noop', {
        dragIndex,
        target,
        before: summarizeLaneStacks(lanes),
        after: summarizeLaneStacks(result),
      });
      return result;
    }

    const targetStackId = target.targetStackId || getLaneStackId(targetLane);
    const targetIndex = entries.findIndex((entry) => entry.lane.id === targetLane.id);
    if (targetIndex === -1) {
      const result = ensureExplicitLaneStacks(lanes);
      logStackDebug('moveLaneInStacks:missing-target-index', {
        dragIndex,
        target,
        before: summarizeLaneStacks(lanes),
        after: summarizeLaneStacks(result),
      });
      return result;
    }

    const insertIndex = target.placement === 'lane-before' ? targetIndex : targetIndex + 1;
    entries.splice(insertIndex, 0, {
      ...dragged,
      lane: setLaneStack(dragged.lane, targetStackId),
    });

    const result = ensureExplicitLaneStacks(entries.map(({ lane }) => lane));
    logStackDebug('moveLaneInStacks:lane-placement', {
      dragIndex,
      target,
      before: summarizeLaneStacks(lanes),
      after: summarizeLaneStacks(result),
    });
    return result;
  }

  const targetStackId =
    target.targetStackId ||
    (target.targetLaneIndex !== undefined && getLaneStackId(lanes[target.targetLaneIndex]));
  if (!targetStackId || (targetStackId === originalDragStackId && originalStackCount === 1)) {
    const result = ensureExplicitLaneStacks(lanes);
    logStackDebug('moveLaneInStacks:column-target-noop', {
      dragIndex,
      target,
      before: summarizeLaneStacks(lanes),
      after: summarizeLaneStacks(result),
    });
    return result;
  }

  const stacks = getLaneStacks(entries.map(({ lane }) => lane));
  const targetLane = target.targetLaneIndex !== undefined ? lanes[target.targetLaneIndex] : null;
  const targetStackIndex = stacks.findIndex((stack) => {
    if (targetLane) {
      return stack.lanes.some(({ lane }) => lane.id === targetLane.id);
    }

    return stack.id === targetStackId;
  });
  if (targetStackIndex === -1) {
    const result = ensureExplicitLaneStacks(lanes);
    logStackDebug('moveLaneInStacks:missing-target-stack', {
      dragIndex,
      target,
      before: summarizeLaneStacks(lanes),
      after: summarizeLaneStacks(result),
    });
    return result;
  }

  const nextStackId =
    originalStackCount === 1 ? getLaneStackId(dragged.lane) : getUniqueStackId(dragged.lane, lanes);
  const insertIndex = target.placement === 'stack-before' ? targetStackIndex : targetStackIndex + 1;

  stacks.splice(insertIndex, 0, {
    id: nextStackId,
    lanes: [{ lane: setLaneStack(dragged.lane, nextStackId), index: dragged.index }],
  });

  const result = ensureExplicitLaneStacks(flattenStacks(stacks));
  logStackDebug('moveLaneInStacks:column-placement', {
    dragIndex,
    target,
    nextStackId,
    before: summarizeLaneStacks(lanes),
    after: summarizeLaneStacks(result),
  });
  return result;
}
