import type { ReminderItem, ReminderType } from '../types/reminder';
import { BIRTHDAY_REPEAT } from '../types/reminder';

export { BIRTHDAY_REPEAT };

/**
 * 新增 / 切换类型时的默认值补全：
 * 生日（BIRTHDAY）若尚未设置重复，则自动补「每 1 年」，
 * 使首页与详情的「下一次生日」口径与上游一致。
 */
export function applyTypeDefaults(item: ReminderItem, nextType: ReminderType): ReminderItem {
  if (nextType === 'BIRTHDAY' && item.repeatInfo === null) {
    return { ...item, type: nextType, repeatInfo: { ...BIRTHDAY_REPEAT } };
  }
  return { ...item, type: nextType };
}
