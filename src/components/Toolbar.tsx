import { useRef } from 'react';
import { useStore } from '../store';

export function Toolbar() {
  const selCount = useStore((s) => s.selected.size);
  const trackFilter = useStore((s) => s.trackFilter);
  const setTrackFilter = useStore((s) => s.setTrackFilter);
  const move = useStore((s) => s.move);
  const removeSelected = useStore((s) => s.removeSelected);
  const openDrawer = useStore((s) => s.openDrawer);
  const openIconPicker = useStore((s) => s.openIconPicker);
  const uploadFiles = useStore((s) => s.uploadFiles);
  const fileInput = useRef<HTMLInputElement>(null);
  const clearSel = useStore((s) => s.clearSel);

  const none = selCount === 0;

  return (
    <div className="toolbar">
      <div className="grp">
        <button className="tb" disabled={none} onClick={() => move('top')} title="Move to top">
          ⤒ Top
        </button>
        <button className="tb" disabled={none} onClick={() => move('bottom')} title="Move to bottom">
          ⤓ Bottom
        </button>
        <button
          className="tb icon-only"
          disabled={none}
          onClick={() => move('down')}
          title="Move down (Alt+↓)"
          aria-label="Move down"
        >
          ↓
        </button>
        <button
          className="tb icon-only"
          disabled={none}
          onClick={() => move('up')}
          title="Move up (Alt+↑)"
          aria-label="Move up"
        >
          ↑
        </button>
      </div>
      <div className="sep" />
      <div className="grp">
        <button className="tb" disabled={none} onClick={() => openDrawer('rename')}>
          ✎ Rename
        </button>
        <button className="tb" disabled={none} onClick={() => openIconPicker()}>
          ◧ Set icon
        </button>
        <button className="tb warn" disabled={none} onClick={removeSelected}>
          🗑 Remove
        </button>
      </div>
      <div className="sep" />
      <button className="tb" onClick={() => fileInput.current?.click()}>
        ⇪ Upload MP3
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,.aif,.aiff"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ''; // allow re-picking the same file
          if (files.length) void uploadFiles(files);
        }}
      />
      <div className="spacer" />
      <span className="selinfo">
        {none ? (
          'No selection'
        ) : (
          <>
            <b>{selCount}</b> selected
            {/* on touch there is no Escape key or blank-space click to clear with */}
            <button className="clear-x" title="Clear selection (Esc)" aria-label="Clear selection" onClick={clearSel}>
              ×
            </button>
          </>
        )}
      </span>
      <div className="sep" />
      <div className="searchbox">
        <span className="ico">⌕</span>
        <input
          placeholder="Search tracks..."
          value={trackFilter}
          onChange={(e) => setTrackFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setTrackFilter('')}
        />
        {trackFilter && (
          <button className="clear-x" title="Clear filter" aria-label="Clear filter" onClick={() => setTrackFilter('')}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}
