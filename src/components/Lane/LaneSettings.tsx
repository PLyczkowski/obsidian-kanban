import update from 'immutability-helper';
import { useContext } from 'preact/compat';
import { Path } from 'src/dnd/types';
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
  const { boardModifiers } = useContext(KanbanContext);

  const setLaneColor = (color?: CanvasColor) => {
    boardModifiers.updateLane(
      lanePath,
      update(lane, {
        data: color
          ? {
              color: {
                $set: color,
              },
            }
          : {
              $unset: ['color'],
            },
      })
    );
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
              }}
              onClick={() => setLaneColor(color)}
            />
          ))}

          <label className={c('lane-custom-color-wrapper')}>
            <span className={c('lane-custom-color-label')}>{t('Custom')}</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(lane.data.color || '') ? lane.data.color : '#808080'}
              onChange={(e) => {
                setLaneColor((e.currentTarget.value || '').toUpperCase() as CanvasColor);
              }}
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
