import classcat from 'classcat';
import update from 'immutability-helper';
import { JSX, createPortal, memo, useCallback, useMemo } from 'preact/compat';

import { KanbanView } from './KanbanView';
import { DraggableItem } from './components/Item/Item';
import { DraggableLane } from './components/Lane/Lane';
import { KanbanContext } from './components/context';
import { c, maybeCompleteForMove } from './components/helpers';
import { Board, DataTypes, Item, Lane } from './components/types';
import { DndContext } from './dnd/components/DndContext';
import { DragOverlay } from './dnd/components/DragOverlay';
import { Entity, Hitbox, Nestable } from './dnd/types';
import {
  getEntityFromPath,
  insertEntity,
  moveEntity,
  removeEntity,
  updateEntity,
} from './dnd/util/data';
import { getBoardModifiers } from './helpers/boardModifiers';
import KanbanPlugin from './main';
import { frontmatterKey } from './parsers/common';
import {
  getTaskStatusDone,
  getTaskStatusPreDone,
  toggleTask,
} from './parsers/helpers/inlineMetadata';

type StackDropPlacement = 'stack-before' | 'stack-after' | 'lane-before' | 'lane-after';

function getLaneStackId(lane: Lane) {
  return lane.data.stack || lane.id;
}

function normalizeLaneStacks(lanes: Lane[]) {
  const stackCounts = lanes.reduce((counts, lane) => {
    const stack = getLaneStackId(lane);
    counts.set(stack, (counts.get(stack) || 0) + 1);
    return counts;
  }, new Map<string, number>());

  return lanes.map((lane) => {
    const stack = getLaneStackId(lane);

    if (stackCounts.get(stack) > 1) {
      return update(lane, { data: { stack: { $set: stack } } });
    }

    if (lane.data.stack) {
      return update(lane, { data: { $unset: ['stack'] } });
    }

    return lane;
  });
}

function getStackDropPlacement(
  position: { x: number; y: number },
  hitbox: Hitbox
): StackDropPlacement {
  const width = hitbox[2] - hitbox[0];
  const height = hitbox[3] - hitbox[1];
  const x = width > 0 ? (position.x - hitbox[0]) / width : 0.5;
  const y = height > 0 ? (position.y - hitbox[1]) / height : 0.5;

  if (x < 0.25) return 'stack-before';
  if (x > 0.75) return 'stack-after';
  return y < 0.5 ? 'lane-before' : 'lane-after';
}

function getStackDropPlacementFromData(
  dropEntity: Entity,
  position?: { x: number; y: number },
  hitbox?: Hitbox
): StackDropPlacement | null {
  const data = dropEntity.getData();

  if (data.stackDropPlacement) {
    return data.stackDropPlacement;
  }

  if (position && hitbox) {
    return getStackDropPlacement(position, hitbox);
  }

  return null;
}

function reorderLaneForStacks(
  lanes: Lane[],
  dragIndex: number,
  dropIndex: number,
  placement: StackDropPlacement,
  targetLaneIndex?: number,
  targetStackId?: string
) {
  const entries = lanes.map((lane, index) => ({
    lane,
    collapsed: false,
    originalIndex: index,
  }));
  const [dragged] = entries.splice(dragIndex, 1);
  const rawTargetIndex = targetLaneIndex ?? dropIndex;
  const targetIndex = dragIndex < rawTargetIndex ? rawTargetIndex - 1 : rawTargetIndex;
  const target =
    targetStackId && (placement === 'stack-before' || placement === 'stack-after')
      ? entries.find((entry) => getLaneStackId(entry.lane) === targetStackId)
      : entries[targetIndex];

  if (!dragged || !target) return lanes;

  if (placement === 'lane-before' || placement === 'lane-after') {
    const targetStack = getLaneStackId(target.lane);
    dragged.lane = update(dragged.lane, { data: { stack: { $set: targetStack } } });
    target.lane = update(target.lane, { data: { stack: { $set: targetStack } } });

    entries.splice(placement === 'lane-before' ? targetIndex : targetIndex + 1, 0, dragged);
    return normalizeLaneStacks(entries.map(({ lane }) => lane));
  }

  const targetStack = targetStackId || getLaneStackId(target.lane);
  const columns: Array<typeof entries> = [];
  const columnLookup = new Map<string, typeof entries>();

  entries.forEach((entry) => {
    const stack = getLaneStackId(entry.lane);
    let column = columnLookup.get(stack);

    if (!column) {
      column = [];
      columnLookup.set(stack, column);
      columns.push(column);
    }

    column.push(entry);
  });

  dragged.lane = update(dragged.lane, { data: { $unset: ['stack'] } });

  const targetColumnIndex = columns.findIndex((column) =>
    column.some((entry) => getLaneStackId(entry.lane) === targetStack)
  );
  const insertIndex = placement === 'stack-before' ? targetColumnIndex : targetColumnIndex + 1;
  columns.splice(insertIndex, 0, [dragged]);

  return normalizeLaneStacks(
    columns.reduce<Lane[]>((result, column) => {
      column.forEach(({ lane }) => result.push(lane));
      return result;
    }, [])
  );
}

export function createApp(win: Window, plugin: KanbanPlugin) {
  return <DragDropApp win={win} plugin={plugin} />;
}

const View = memo(function View({ view }: { view: KanbanView }) {
  return createPortal(view.getPortal(), view.contentEl);
});

export function DragDropApp({ win, plugin }: { win: Window; plugin: KanbanPlugin }) {
  const views = plugin.useKanbanViews(win);
  const portals: JSX.Element[] = views.map((view) => <View key={view.id} view={view} />);

  const handleDrop = useCallback(
    (
      dragEntity: Entity,
      dropEntity: Entity,
      dropContext?: { dragPosition?: { x: number; y: number }; dropHitbox?: Hitbox }
    ) => {
      if (!dragEntity || !dropEntity) {
        return;
      }

      if (dragEntity.scopeId === 'htmldnd') {
        const data = dragEntity.getData();
        const stateManager = plugin.getStateManagerFromViewID(data.viewId, data.win);
        const dropPath = dropEntity.getPath();
        const destinationParent = getEntityFromPath(stateManager.state, dropPath.slice(0, -1));

        try {
          const items: Item[] = data.content.map((title: string) => {
            let item = stateManager.getNewItem(title, ' ');
            const isComplete = !!destinationParent?.data?.shouldMarkItemsComplete;

            if (isComplete) {
              item = update(item, { data: { checkChar: { $set: getTaskStatusPreDone() } } });
              const updates = toggleTask(item, stateManager.file);
              if (updates) {
                const [itemStrings, checkChars, thisIndex] = updates;
                const nextItem = itemStrings[thisIndex];
                const checkChar = checkChars[thisIndex];
                return stateManager.getNewItem(nextItem, checkChar);
              }
            }

            return update(item, {
              data: {
                checked: {
                  $set: !!destinationParent?.data?.shouldMarkItemsComplete,
                },
                checkChar: {
                  $set: destinationParent?.data?.shouldMarkItemsComplete
                    ? getTaskStatusDone()
                    : ' ',
                },
              },
            });
          });

          return stateManager.setState((board) => insertEntity(board, dropPath, items));
        } catch (e) {
          stateManager.setError(e);
          console.error(e);
        }

        return;
      }

      const dragPath = dragEntity.getPath();
      const dropPath = dropEntity.getPath();
      const dragEntityData = dragEntity.getData();
      const dropEntityData = dropEntity.getData();
      const [, sourceFile] = dragEntity.scopeId.split(':::');
      const [, destinationFile] = dropEntity.scopeId.split(':::');

      const inDropArea =
        dropEntityData.acceptsSort && !dropEntityData.acceptsSort.includes(dragEntityData.type);

      // Same board
      if (sourceFile === destinationFile) {
        const view = plugin.getKanbanView(dragEntity.scopeId, dragEntityData.win);
        const stateManager = plugin.stateManagers.get(view.file);
        const boardView =
          view.viewSettings[frontmatterKey] || stateManager.getSetting(frontmatterKey);

        if (
          boardView === 'stacks' &&
          dragEntityData.type === DataTypes.Lane &&
          (dropEntityData.type === DataTypes.Lane || dropEntityData.stackDropPlacement)
        ) {
          return stateManager.setState((board) => {
            const from = dragPath.last();
            const to = dropPath.last();
            const placement = getStackDropPlacementFromData(
              dropEntity,
              dropContext?.dragPosition,
              dropContext?.dropHitbox
            );
            if (!placement) return board;
            const nextChildren = reorderLaneForStacks(
              board.children,
              from,
              to,
              placement,
              dropEntityData.targetLaneIndex,
              dropEntityData.targetStackId
            );
            const collapsedState = view.getViewState('list-collapse') || [];
            const collapsedByLane = new Map(
              board.children.map((lane, index) => [lane.id, collapsedState[index]])
            );
            const nextCollapsedState = nextChildren.map((lane) => !!collapsedByLane.get(lane.id));

            view.setViewState('list-collapse', nextCollapsedState);

            return update<Board>(board, {
              children: { $set: nextChildren },
              data: { settings: { 'list-collapse': { $set: nextCollapsedState } } },
            });
          });
        }

        if (inDropArea) {
          dropPath.push(0);
        }

        return stateManager.setState((board) => {
          const entity = getEntityFromPath(board, dragPath);
          const newBoard: Board = moveEntity(
            board,
            dragPath,
            dropPath,
            (entity) => {
              if (entity.type === DataTypes.Item) {
                const { next } = maybeCompleteForMove(
                  stateManager,
                  board,
                  dragPath,
                  stateManager,
                  board,
                  dropPath,
                  entity
                );
                return next;
              }
              return entity;
            },
            (entity) => {
              if (entity.type === DataTypes.Item) {
                const { replacement } = maybeCompleteForMove(
                  stateManager,
                  board,
                  dragPath,
                  stateManager,
                  board,
                  dropPath,
                  entity
                );
                return replacement;
              }
            }
          );

          if (entity.type === DataTypes.Lane) {
            const from = dragPath.last();
            let to = dropPath.last();

            if (from < to) to -= 1;

            const collapsedState = view.getViewState('list-collapse');
            const op = (collapsedState: boolean[]) => {
              const newState = [...collapsedState];
              newState.splice(to, 0, newState.splice(from, 1)[0]);
              return newState;
            };

            view.setViewState('list-collapse', undefined, op);

            return update<Board>(newBoard, {
              data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
            });
          }

          // Remove sorting in the destination lane
          const destinationParentPath = dropPath.slice(0, -1);
          const destinationParent = getEntityFromPath(board, destinationParentPath);

          if (destinationParent?.data?.sorted !== undefined) {
            return updateEntity(newBoard, destinationParentPath, {
              data: {
                $unset: ['sorted'],
              },
            });
          }

          return newBoard;
        });
      }

      const sourceView = plugin.getKanbanView(dragEntity.scopeId, dragEntityData.win);
      const sourceStateManager = plugin.stateManagers.get(sourceView.file);
      const destinationView = plugin.getKanbanView(dropEntity.scopeId, dropEntityData.win);
      const destinationStateManager = plugin.stateManagers.get(destinationView.file);

      sourceStateManager.setState((sourceBoard) => {
        const entity = getEntityFromPath(sourceBoard, dragPath);
        let replacementEntity: Nestable;

        destinationStateManager.setState((destinationBoard) => {
          if (inDropArea) {
            const parent = getEntityFromPath(destinationStateManager.state, dropPath);
            const shouldAppend =
              (destinationStateManager.getSetting('new-card-insertion-method') || 'append') ===
              'append';

            if (shouldAppend) dropPath.push(parent.children.length);
            else dropPath.push(0);
          }

          const toInsert: Nestable[] = [];

          if (entity.type === DataTypes.Item) {
            const { next, replacement } = maybeCompleteForMove(
              sourceStateManager,
              sourceBoard,
              dragPath,
              destinationStateManager,
              destinationBoard,
              dropPath,
              entity
            );
            replacementEntity = replacement;
            toInsert.push(next);
          } else {
            toInsert.push(entity);
          }

          if (entity.type === DataTypes.Lane) {
            const collapsedState = destinationView.getViewState('list-collapse');
            const val = sourceView.getViewState('list-collapse')[dragPath.last()];
            const op = (collapsedState: boolean[]) => {
              const newState = [...collapsedState];
              newState.splice(dropPath.last(), 0, val);
              return newState;
            };

            destinationView.setViewState('list-collapse', undefined, op);

            return update<Board>(insertEntity(destinationBoard, dropPath, toInsert), {
              data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
            });
          } else {
            return insertEntity(destinationBoard, dropPath, toInsert);
          }
        });

        if (entity.type === DataTypes.Lane) {
          const collapsedState = sourceView.getViewState('list-collapse');
          const op = (collapsedState: boolean[]) => {
            const newState = [...collapsedState];
            newState.splice(dragPath.last(), 1);
            return newState;
          };
          sourceView.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(sourceBoard, dragPath), {
            data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
          });
        } else {
          return removeEntity(sourceBoard, dragPath, replacementEntity);
        }
      });
    },
    [views]
  );

  if (portals.length)
    return (
      <DndContext win={win} onDrop={handleDrop}>
        {...portals}
        <DragOverlay>
          {(entity, styles) => {
            const [data, context] = useMemo(() => {
              if (entity.scopeId === 'htmldnd') {
                return [null, null];
              }

              const overlayData = entity.getData();

              const view = plugin.getKanbanView(entity.scopeId, overlayData.win);
              const stateManager = plugin.stateManagers.get(view.file);
              const data = getEntityFromPath(stateManager.state, entity.getPath());
              const boardModifiers = getBoardModifiers(view, stateManager);
              const filePath = view.file.path;

              return [
                data,
                {
                  view,
                  stateManager,
                  boardModifiers,
                  filePath,
                },
              ];
            }, [entity]);

            if (data?.type === DataTypes.Lane) {
              const boardView =
                context?.view.viewSettings[frontmatterKey] ||
                context?.stateManager.getSetting(frontmatterKey);
              const collapseState =
                context?.view.viewSettings['list-collapse'] ||
                context?.stateManager.getSetting('list-collapse');
              const laneIndex = entity.getPath().last();

              return (
                <KanbanContext.Provider value={context}>
                  <div
                    className={classcat([
                      c('drag-container'),
                      {
                        [c('horizontal')]: boardView !== 'list',
                        [c('vertical')]: boardView === 'list',
                        [c('stacks')]: boardView === 'stacks',
                      },
                    ])}
                    style={styles}
                  >
                    <DraggableLane
                      lane={data as Lane}
                      laneIndex={laneIndex}
                      isStatic={true}
                      isCollapsed={!!collapseState[laneIndex]}
                      collapseDir={boardView === 'list' ? 'vertical' : 'horizontal'}
                    />
                  </div>
                </KanbanContext.Provider>
              );
            }

            if (data?.type === DataTypes.Item) {
              return (
                <KanbanContext.Provider value={context}>
                  <div className={c('drag-container')} style={styles}>
                    <DraggableItem item={data as Item} itemIndex={0} isStatic={true} />
                  </div>
                </KanbanContext.Provider>
              );
            }

            return <div />;
          }}
        </DragOverlay>
      </DndContext>
    );
}
