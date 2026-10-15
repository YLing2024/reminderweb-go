import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowBackIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  DeleteIcon,
  EditIcon,
  PlusIcon,
  TagIcon,
} from '../components/icons';
import { ConfirmDialog, IconButton } from '../components/ui';
import { useReminderStore } from '../store/useReminderStore';
import type { TagItem } from '../types/reminder';
import styles from './TagPage.module.css';

const PRESET_COLORS = [
  '#2196F3',
  '#4CAF50',
  '#FF9800',
  '#F44336',
  '#9C27B0',
  '#E91E63',
  '#00BCD4',
  '#FFEB3B',
  '#673AB7',
];

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

interface EditorState {
  id: number | null; // null = 新建
  name: string;
  color: string;
}

export default function TagPage() {
  const navigate = useNavigate();
  const tags = useReminderStore((state) => state.tags);
  const reminders = useReminderStore((state) => state.reminders);
  const updateTag = useReminderStore((state) => state.updateTag);
  const deleteTag = useReminderStore((state) => state.deleteTag);
  const addTag = useReminderStore((state) => state.addTag);
  const moveTag = useReminderStore((state) => state.moveTag);

  const [sortMode, setSortMode] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagItem | null>(null);

  const ordered = useMemo(() => [...tags].sort((a, b) => a.sortOrder - b.sortOrder), [tags]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of reminders) {
      const key = item.tag.trim().toLowerCase();
      if (key === '') continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [reminders]);

  const saveEditor = async () => {
    if (editor === null) return;
    const name = editor.name.trim();
    if (name === '' || !HEX_RE.test(editor.color)) return;
    if (editor.id === null) {
      await addTag(name, editor.color);
    } else {
      await updateTag(editor.id, name, editor.color);
    }
    setEditor(null);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>{sortMode ? '调整标签顺序' : '标签管理'}</h1>
        {ordered.length > 1 && (
          <IconButton label={sortMode ? '完成' : '排序'} onClick={() => setSortMode((value) => !value)}>
            {sortMode ? <CheckIcon /> : <span className={styles.sortGlyph}>⇅</span>}
          </IconButton>
        )}
      </header>

      <div className={styles.content}>
        {ordered.length === 0 && (
          <div className={styles.empty}>
            <TagIcon width={64} height={64} className={styles.emptyIcon} />
            <p className={styles.emptyText}>暂无标签，点击下方按钮添加</p>
          </div>
        )}

        <ul className={styles.list}>
          {ordered.map((tag, index) => {
            const count = counts.get(tag.name.trim().toLowerCase()) ?? 0;
            return (
              <li key={tag.id} className={styles.row}>
                <span className={styles.colorDot} style={{ background: tag.color }} />
                <span className={styles.name}>{tag.name}</span>
                <span className={styles.count}>{count} 项</span>
                {sortMode ? (
                  <span className={styles.rowActions}>
                    <IconButton
                      label="上移"
                      onClick={() => void moveTag(tag.id, 'up')}
                      disabled={index === 0}
                      className={styles.smallAction}
                    >
                      <ArrowUpIcon width={20} height={20} />
                    </IconButton>
                    <IconButton
                      label="下移"
                      onClick={() => void moveTag(tag.id, 'down')}
                      disabled={index === ordered.length - 1}
                      className={styles.smallAction}
                    >
                      <ArrowDownIcon width={20} height={20} />
                    </IconButton>
                  </span>
                ) : (
                  <span className={styles.rowActions}>
                    <IconButton
                      label="编辑"
                      onClick={() => setEditor({ id: tag.id, name: tag.name, color: tag.color })}
                      className={styles.smallAction}
                    >
                      <EditIcon width={20} height={20} />
                    </IconButton>
                    <IconButton
                      label="删除"
                      onClick={() => setPendingDelete(tag)}
                      className={`${styles.smallAction} ${styles.danger}`}
                    >
                      <DeleteIcon width={20} height={20} />
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {!sortMode && (
        <button
          type="button"
          className={styles.fab}
          aria-label="新增标签"
          title="新增标签"
          onClick={() => setEditor({ id: null, name: '', color: '#2196F3' })}
        >
          <PlusIcon />
        </button>
      )}

      {editor !== null && (
        <TagEditorDialog
          editor={editor}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onConfirm={() => void saveEditor()}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="确认删除标签"
        message={
          pendingDelete === null
            ? ''
            : `删除标签【${pendingDelete.name}】后，所有使用该标签的提醒都会被归为【无标签】。此操作不可撤销，是否确认删除？`
        }
        confirmText="确认删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) void deleteTag(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function TagEditorDialog({
  editor,
  onChange,
  onCancel,
  onConfirm,
}: {
  editor: EditorState;
  onChange: (next: EditorState) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = editor.name.trim();
  const valid = name !== '' && HEX_RE.test(editor.color);
  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={editor.id === null ? '新建标签' : '修改标签'}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.dialogTitle}>{editor.id === null ? '新建标签' : '修改标签'}</h2>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>标签名称</span>
          <input
            className={styles.input}
            value={editor.name}
            maxLength={30}
            placeholder="标签名称"
            autoFocus
            onChange={(event) => onChange({ ...editor, name: event.target.value })}
          />
        </label>

        <p className={styles.fieldLabel}>选择标签颜色</p>
        <div className={styles.swatches}>
          {PRESET_COLORS.map((color) => {
            const selected = editor.color.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                aria-label={`选择颜色 ${color}`}
                aria-pressed={selected}
                onClick={() => onChange({ ...editor, color })}
              >
                {selected && (
                  <CheckIcon
                    width={20}
                    height={20}
                    style={{ color: color === '#FFEB3B' ? '#000' : '#fff' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className={styles.customRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>HEX 颜色代码</span>
            <input
              className={styles.input}
              value={editor.color}
              maxLength={7}
              placeholder="#2196F3"
              onChange={(event) => {
                const value = event.target.value.startsWith('#')
                  ? event.target.value.slice(0, 7)
                  : `#${event.target.value.slice(0, 6)}`;
                onChange({ ...editor, color: value });
              }}
            />
          </label>
          <input
            type="color"
            className={styles.colorInput}
            value={HEX_RE.test(editor.color) ? editor.color : '#2196F3'}
            aria-label="自定义颜色"
            onChange={(event) => onChange({ ...editor, color: event.target.value })}
          />
        </div>

        <div className={styles.dialogActions}>
          <button type="button" className={styles.textButton} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.textButton} ${styles.textButtonPrimary}`}
            disabled={!valid}
            onClick={onConfirm}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
