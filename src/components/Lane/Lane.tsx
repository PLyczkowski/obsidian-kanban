import animateScrollTo from 'animated-scroll-to';
import classcat from 'classcat';
import update from 'immutability-helper';
import {
  CSSProperties,
  Fragment,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'preact/compat';
import {
  DraggableProps,
  Droppable,
  StaticDroppable,
  useNestedEntityPath,
} from 'src/dnd/components/Droppable';
import { ScrollContainer } from 'src/dnd/components/ScrollContainer';
import { SortPlaceholder } from 'src/dnd/components/SortPlaceholder';
import { Sortable, StaticSortable } from 'src/dnd/components/Sortable';
import { useDragHandle } from 'src/dnd/managers/DragManager';
import { StackDropPlacement, getLaneStacks } from 'src/helpers/stacks';
import { frontmatterKey } from 'src/parsers/common';
import { getTaskStatusDone } from 'src/parsers/helpers/inlineMetadata';

import { Items } from '../Item/Item';
import { ItemForm } from '../Item/ItemForm';
import { KanbanContext, SearchContext, SortContext } from '../context';
import { c, generateInstanceId, getCanvasColorCss, getCanvasColorRgb } from '../helpers';
import { DataTypes, EditState, EditingState, Item, Lane } from '../types';
import { LaneHeader } from './LaneHeader';

const laneAccepts = [DataTypes.Item];
const stackAccepts = [DataTypes.Lane];

export interface DraggableLaneProps {
  lane: Lane;
  laneIndex: number;
  isStatic?: boolean;
  collapseDir: 'horizontal' | 'vertical';
  isCollapsed?: boolean;
}

function DraggableLaneRaw({
  isStatic,
  lane,
  laneIndex,
  collapseDir,
  isCollapsed = false,
}: DraggableLaneProps) {
  const [editState, setEditState] = useState<EditState>(EditingState.cancel);
  const [isSorting, setIsSorting] = useState(false);

  const { stateManager, boardModifiers, view } = useContext(KanbanContext);
  const search = useContext(SearchContext);

  const boardView = view.useViewState(frontmatterKey);
  const path = useNestedEntityPath(laneIndex);
  const laneWidth = stateManager.useSetting('lane-width');
  const fullWidth = boardView === 'list' && stateManager.useSetting('full-list-lane-width');
  const insertionMethod = stateManager.useSetting('new-card-insertion-method');
  const laneStyles = useMemo<CSSProperties>(() => {
    const styles: CSSProperties = {};

    if (!(isCollapsed && collapseDir === 'horizontal') && (fullWidth || laneWidth)) {
      styles.width = fullWidth ? '100%' : `${laneWidth}px`;
    }

    const color = getCanvasColorCss(lane.data.color);
    const rgb = getCanvasColorRgb(lane.data.color);
    if (color && rgb) {
      styles['--kanban-lane-color'] = color;
      styles['--kanban-lane-color-rgb'] = rgb;
    }

    return Object.keys(styles).length ? styles : undefined;
  }, [fullWidth, laneWidth, isCollapsed, collapseDir, lane.data.color]);

  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const bindHandle = useDragHandle(measureRef, dragHandleRef);

  const shouldMarkItemsComplete = !!lane.data.shouldMarkItemsComplete;
  const isCompactPrepend = insertionMethod === 'prepend-compact';
  const shouldPrepend = isCompactPrepend || insertionMethod === 'prepend';

  const toggleIsCollapsed = useCallback(() => {
    stateManager.setState((board) => {
      const collapseState = [...view.getViewState('list-collapse')];
      collapseState[laneIndex] = !collapseState[laneIndex];
      view.setViewState('list-collapse', collapseState);
      return update(board, {
        data: { settings: { 'list-collapse': { $set: collapseState } } },
      });
    });
  }, [stateManager, laneIndex]);

  const addItems = useCallback(
    (items: Item[]) => {
      boardModifiers[shouldPrepend ? 'prependItems' : 'appendItems'](
        [...path, lane.children.length - 1],
        items.map((item) =>
          update(item, {
            data: {
              checked: {
                // Mark the item complete if we're moving into a completed lane
                $set: shouldMarkItemsComplete,
              },
              checkChar: {
                $set: shouldMarkItemsComplete ? getTaskStatusDone() : ' ',
              },
            },
          })
        )
      );

      // TODO: can we find a less brute force way to do this?
      view.getWindow().setTimeout(() => {
        const laneItems = elementRef.current?.getElementsByClassName(c('lane-items'));

        if (laneItems.length) {
          animateScrollTo([0, shouldPrepend ? 0 : laneItems[0].scrollHeight], {
            elementToScroll: laneItems[0],
            speed: 200,
            minDuration: 150,
            easing: (x: number) => {
              return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
            },
          });
        }
      });
    },
    [boardModifiers, path, lane, shouldPrepend]
  );

  const DroppableComponent = isStatic ? StaticDroppable : Droppable;
  const SortableComponent = isStatic ? StaticSortable : Sortable;
  const CollapsedDropArea = !isCollapsed || isStatic ? Fragment : Droppable;
  const dropAreaProps: DraggableProps = useMemo(() => {
    if (!isCollapsed || isStatic) return {} as any;
    const data = {
      id: generateInstanceId(),
      type: 'lane',
      accepts: [DataTypes.Item],
      acceptsSort: [DataTypes.Lane],
    };
    return {
      elementRef: elementRef,
      measureRef: measureRef,
      id: data.id,
      index: laneIndex,
      data: data,
    };
  }, [isCollapsed, laneIndex, isStatic]);

  return (
    <SortContext.Provider value={lane.data.sorted ?? null}>
      <div
        ref={measureRef}
        className={classcat([
          c('lane-wrapper'),
          {
            'is-sorting': isSorting,
            'has-lane-color': !!lane.data.color,
            'collapse-horizontal': isCollapsed && collapseDir === 'horizontal',
            'collapse-vertical': isCollapsed && collapseDir === 'vertical',
          },
        ])}
        style={laneStyles}
      >
        <div
          data-count={lane.children.length}
          ref={elementRef}
          className={classcat([c('lane'), { 'will-prepend': shouldPrepend }])}
        >
          <CollapsedDropArea {...dropAreaProps}>
            <LaneHeader
              bindHandle={bindHandle}
              laneIndex={laneIndex}
              lane={lane}
              setIsItemInputVisible={isCompactPrepend ? setEditState : undefined}
              isCollapsed={isCollapsed}
              toggleIsCollapsed={toggleIsCollapsed}
            />

            {!search?.query && !isCollapsed && shouldPrepend && (
              <ItemForm
                addItems={addItems}
                hideButton={isCompactPrepend}
                editState={editState}
                setEditState={setEditState}
              />
            )}

            {!isCollapsed && (
              <DroppableComponent
                elementRef={elementRef}
                measureRef={measureRef}
                id={lane.id}
                index={laneIndex}
                data={lane}
              >
                <ScrollContainer
                  className={classcat([c('lane-items'), c('vertical')])}
                  id={lane.id}
                  index={laneIndex}
                  isStatic={isStatic}
                  triggerTypes={laneAccepts}
                >
                  <SortableComponent onSortChange={setIsSorting} axis="vertical">
                    <Items
                      items={lane.children}
                      isStatic={isStatic}
                      shouldMarkItemsComplete={shouldMarkItemsComplete}
                    />
                    <SortPlaceholder
                      accepts={laneAccepts}
                      index={lane.children.length}
                      isStatic={isStatic}
                    />
                  </SortableComponent>
                </ScrollContainer>
              </DroppableComponent>
            )}

            {!search?.query && !isCollapsed && !shouldPrepend && (
              <ItemForm addItems={addItems} editState={editState} setEditState={setEditState} />
            )}
          </CollapsedDropArea>
        </div>
      </div>
    </SortContext.Provider>
  );
}

export const DraggableLane = memo(DraggableLaneRaw);

export interface LanesProps {
  lanes: Lane[];
  collapseDir: 'horizontal' | 'vertical';
}

interface StackDropZoneProps {
  id: string;
  index: number;
  className: string;
  placement: StackDropPlacement;
  targetLaneIndex?: number;
  targetStackId?: string;
  isColumnEnd?: boolean;
}

function StackDropZone({
  id,
  index,
  className,
  placement,
  targetLaneIndex,
  targetStackId,
  isColumnEnd,
}: StackDropZoneProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const data = useMemo(
    () => ({
      id,
      type: 'stack-drop-zone',
      accepts: stackAccepts,
      acceptsSort: [],
      stackDropPlacement: placement,
      targetLaneIndex,
      targetStackId,
    }),
    [id, placement, targetLaneIndex, targetStackId]
  );

  return (
    <div
      ref={elementRef}
      className={`${c('stack-drop-zone')} ${className} ${isColumnEnd ? 'is-column-end' : ''}`}
    >
      <Droppable
        elementRef={elementRef}
        measureRef={elementRef}
        id={id}
        index={index}
        data={data}
      />
    </div>
  );
}

function LanesRaw({ lanes, collapseDir }: LanesProps) {
  const search = useContext(SearchContext);
  const { view } = useContext(KanbanContext);
  const boardView = view.useViewState(frontmatterKey) || 'board';
  const collapseState = view.useViewState('list-collapse') || [];

  if (boardView === 'stacks') {
    const stacks = getLaneStacks(lanes);

    return (
      <>
        {stacks.map((stack, stackIndex) => {
          const stackKey = `${stack.id}-${stack.lanes[0].index}`;

          return (
          <Fragment key={stackKey}>
            <StackDropZone
              id={`stack-before-${stackKey}`}
              index={stack.lanes[0].index}
              className={c('stack-drop-zone-column')}
              placement="stack-before"
              targetLaneIndex={stack.lanes[0].index}
              targetStackId={stack.id}
            />
            <div key={stackKey} className={c('lane-stack')}>
              <StackDropZone
                id={`stack-top-${stackKey}`}
                index={stack.lanes[0].index}
                className={c('stack-drop-zone-row')}
                placement="lane-before"
                targetLaneIndex={stack.lanes[0].index}
                targetStackId={stack.id}
              />
              {stack.lanes.map(({ lane, index }, laneStackIndex) => (
                <Fragment key={lane.id}>
                  <DraggableLane
                    collapseDir={collapseDir}
                    isCollapsed={
                      (search?.query && !search.lanes.has(lane)) || !!collapseState[index]
                    }
                    lane={lane}
                    laneIndex={index}
                  />
                  <StackDropZone
                    id={`lane-after-${lane.id}`}
                    index={index + 1}
                    className={c('stack-drop-zone-row')}
                    placement="lane-after"
                    targetLaneIndex={index}
                    targetStackId={stack.id}
                    isColumnEnd={laneStackIndex === stack.lanes.length - 1}
                  />
                </Fragment>
              ))}
            </div>
            {stackIndex === stacks.length - 1 && (
              <StackDropZone
                id={`stack-after-${stackKey}`}
                index={stack.lanes.last().index + 1}
                className={c('stack-drop-zone-column')}
                placement="stack-after"
                targetLaneIndex={stack.lanes[0].index}
                targetStackId={stack.id}
              />
            )}
          </Fragment>
          );
        })}
      </>
    );
  }

  return (
    <>
      {lanes.map((lane, i) => {
        return (
          <DraggableLane
            collapseDir={collapseDir}
            isCollapsed={(search?.query && !search.lanes.has(lane)) || !!collapseState[i]}
            key={boardView + lane.id}
            lane={lane}
            laneIndex={i}
          />
        );
      })}
    </>
  );
}

export const Lanes = memo(LanesRaw);
