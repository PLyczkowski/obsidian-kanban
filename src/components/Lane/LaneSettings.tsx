import update from 'immutability-helper';
import { CSSProperties } from 'preact/compat';
import { useContext, useEffect, useState } from 'preact/compat';
import { updateEntity } from 'src/dnd/util/data';
import { Path } from 'src/dnd/types';
import { logStackDebug, summarizeLaneStacks } from 'src/helpers/stackDebug';
import { t } from 'src/lang/helpers';

import { KanbanContext } from '../context';
import { c, getCanvasColorCss, getCanvasColorRgb } from '../helpers';
import { CanvasColor, EditState, Lane, isEditing } from '../types';

export interface LaneSettingsProps {
  lane: Lane;
  lanePath: Path;
  editState: EditState;
}

const canvasColorOptions: CanvasColor[] = ['1', '2', '3', '4', '5', '6'];

export function LaneSettings({ lane, lanePath, editState }: LaneSettingsProps) {
  const { stateManager, boardModifiers } = useContext(KanbanContext);
  const savedCustomColor = /^#[0-9a-fA-F]{6}$/.test(lane.data.color || '')
    ? lane.data.color
    : '#808080';
  const [customColor, setCustomColor] = useState(savedCustomColor);

  useEffect(() => {
    setCustomColor(savedCustomColor);
  }, [savedCustomColor]);

  const setLaneColor = (color?: CanvasColor) => {
    stateManager.setState((board) => {
      const nextBoard = updateEntity(
        board,
        lanePath,
        color
          ? {
              data: {
                color: {
                  $set: color,
                },
              },
            }
          : {
              data: {
                $unset: ['color'],
              },
            }
      );
      logStackDebug('lane-color:set', {
        lanePath,
        laneTitle: lane.data.title,
        color: color || '(none)',
        before: summarizeLaneStacks(board.children),
        after: summarizeLaneStacks(nextBoard.children),
      });

      return nextBoard;
    });
  };
  const setCustomLaneColor = (value: string) => {
    const color = (value || '').toUpperCase();

    if (!/^#[0-9A-F]{6}$/.test(color)) return;

    setCustomColor(color as CanvasColor);
    setLaneColor(color as CanvasColor);
  };
  const setCustomLaneColorPreview = (value: string) => {
    const color = (value || '').toUpperCase();

    if (!/^#[0-9A-F]{6}$/.test(color)) return;

    setCustomColor(color as CanvasColor);
  };

  if (!isEditing(editState)) return null;

  return (
    <div className={c('lane-setting-wrapper')}>
      <div className={c('lane-color-setting')}>
        <div className={c('setting-item-label')}>{t('List header color')}</div>
        <div className={c('lane-color-options')}>
          <button
            className={`${c('lane-color-option')} ${!lane.data.color ? 'is-selected' : ''}`}
            onClick={() => setLaneColor()}
          >
            {t('None')}
          </button>

          {canvasColorOptions.map((color) => (
            <button
              key={color}
              aria-label={`${t('Canvas color')} ${color}`}
              className={`${c('lane-color-option')} ${c('lane-color-swatch')} ${
                lane.data.color === color ? 'is-selected' : ''
              }`}
              data-lane-color={color}
              style={{
                '--kanban-lane-color': getCanvasColorCss(color),
                '--kanban-lane-color-rgb': getCanvasColorRgb(color),
                backgroundColor: getCanvasColorCss(color),
                borderColor: getCanvasColorCss(color),
              } as CSSProperties}
              onClick={() => setLaneColor(color)}
            />
          ))}

          <label className={c('lane-custom-color-wrapper')}>
            <span className={c('lane-custom-color-label')}>{t('Custom')}</span>
            <input
              type="color"
              value={customColor}
              onInput={(e) => setCustomLaneColorPreview(e.currentTarget.value)}
              onChange={(e) => setCustomLaneColor(e.currentTarget.value)}
              onBlur={(e) => setCustomLaneColor(e.currentTarget.value)}
            />
          </label>
        </div>
      </div>
      <div className={c('checkbox-wrapper')}>
        <div className={c('checkbox-label')}>{t('Mark cards in this list as complete')}</div>
        <div
          onClick={() =>
            boardModifiers.updateLane(
              lanePath,
              update(lane, {
                data: { $toggle: ['shouldMarkItemsComplete'] },
              })
            )
          }
          className={`checkbox-container ${lane.data.shouldMarkItemsComplete ? 'is-enabled' : ''}`}
        />
      </div>
    </div>
  );
}
