// Stage 1: ローカル単体プロトタイプ(サーバー・認証なし)
// データはブラウザのlocalStorageにのみ保存する。Googleドライブ連携はStage 2で追加する。

// CDN配布のIIFE版はクラス本体が MindElixir.default に入っている
const MindElixirCtor = window.MindElixir.default;

// file://で直接開くとESモジュール(import)がCORSでブロックされるため、
// 右クリックメニューの日本語ロケールはMindElixir公式のi18n.jsの内容をそのまま埋め込む
const JA_LOCALE = {
  addChild: '子ノードを追加する',
  addParent: '親ノードを追加します',
  addSibling: '兄弟ノードを追加する',
  removeNode: 'ノードを削除',
  focus: '集中',
  cancelFocus: '集中解除',
  moveUp: '上へ移動',
  moveDown: '下へ移動',
  link: 'コネクト',
  linkBidirectional: '双方向リンク',
  clickTips: 'ターゲットノードをクリックしてください',
  summary: '概要',
};

// ---- ローカルファイル管理(1マップ = 1ファイル。名前は中心ノードの文字をそのまま使う) ----

const OLD_STORAGE_KEY = 'mindmap-cloud-app:current'; // 旧バージョン(単一マップ保存)からの移行用
const FILES_INDEX_KEY = 'mindmap-cloud-app:files';
const CURRENT_FILE_KEY = 'mindmap-cloud-app:currentFileId';

function fileDataKey(id) {
  return 'mindmap-cloud-app:file:' + id;
}

function genFileId() {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getFilesIndex() {
  try {
    return JSON.parse(localStorage.getItem(FILES_INDEX_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function setFilesIndex(list) {
  localStorage.setItem(FILES_INDEX_KEY, JSON.stringify(list));
}

function registerFile(id, data) {
  const list = getFilesIndex();
  const name = (data.nodeData && data.nodeData.topic) || '無題のマインドマップ';
  const existing = list.find((f) => f.id === id);
  if (existing) {
    existing.name = name;
    existing.updatedAt = Date.now();
  } else {
    list.unshift({ id, name, updatedAt: Date.now() });
  }
  setFilesIndex(list);
}

function saveFileData(id, data) {
  localStorage.setItem(fileDataKey(id), JSON.stringify(data));
  registerFile(id, data);
}

function loadFileData(id) {
  try {
    return JSON.parse(localStorage.getItem(fileDataKey(id)));
  } catch (e) {
    return null;
  }
}

function deleteFileData(id) {
  localStorage.removeItem(fileDataKey(id));
  setFilesIndex(getFilesIndex().filter((f) => f.id !== id));
}

function setCurrentFileId(id) {
  currentFileId = id;
  localStorage.setItem(CURRENT_FILE_KEY, id);
}

let currentFileId = null;

function migrateOldSingleFileIfNeeded() {
  const old = localStorage.getItem(OLD_STORAGE_KEY);
  if (!old) return;
  try {
    const data = JSON.parse(old);
    const id = genFileId();
    saveFileData(id, data);
    setCurrentFileId(id);
  } catch (e) {
    console.warn('旧データの移行に失敗しました', e);
  } finally {
    localStorage.removeItem(OLD_STORAGE_KEY);
  }
}

function resolveInitialData() {
  migrateOldSingleFileIfNeeded();

  const savedCurrentId = localStorage.getItem(CURRENT_FILE_KEY);
  if (savedCurrentId) {
    const data = loadFileData(savedCurrentId);
    if (data) {
      currentFileId = savedCurrentId;
      return data;
    }
  }

  // 保存済みファイルが1つもない場合は新規ファイルを作る
  const id = genFileId();
  const data = MindElixirCtor.new('新しいマインドマップ');
  saveFileData(id, data);
  setCurrentFileId(id);
  return data;
}

const mind = new MindElixirCtor({
  el: '#map',
  direction: MindElixirCtor.SIDE,
  contextMenu: { locale: JA_LOCALE, focus: true, link: true },
  toolBar: true,
  keypress: true,
});

mind.init(resolveInitialData());

const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

function saveCurrentFile() {
  const data = mind.getData();
  saveFileData(currentFileId, data);
  setStatus('保存しました: ' + new Date().toLocaleTimeString('ja-JP'));
}

document.getElementById('btn-save').addEventListener('click', saveCurrentFile);

function startNewFile(data) {
  const id = genFileId();
  saveFileData(id, data);
  setCurrentFileId(id);
  mind.init(data);
}

document.getElementById('btn-new').addEventListener('click', () => {
  if (!confirm('保存していない変更は失われます。新しいマインドマップを作成しますか?')) {
    return;
  }
  startNewFile(MindElixirCtor.new('新しいマインドマップ'));
  setStatus('新規マップを作成しました');
});

function importMmFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = freemindToMindElixir(reader.result);
      startNewFile(data);
      setStatus('.mmファイルを読み込みました: ' + file.name);
    } catch (err) {
      alert(err.message);
    }
  };
  reader.readAsText(file);
}

document.getElementById('btn-import-mm').addEventListener('click', () => {
  document.getElementById('file-input-mm').click();
});

document.getElementById('file-input-mm').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  importMmFile(file);
  event.target.value = '';
});

const mapEl = document.getElementById('map');

mapEl.addEventListener('dragover', (event) => {
  event.preventDefault();
  mapEl.classList.add('drag-over');
});

mapEl.addEventListener('dragleave', () => {
  mapEl.classList.remove('drag-over');
});

mapEl.addEventListener('drop', (event) => {
  event.preventDefault();
  mapEl.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.mm')) {
    alert('.mm形式のファイルをドロップしてください');
    return;
  }
  importMmFile(file);
});

document.getElementById('btn-export-mm').addEventListener('click', () => {
  const data = mind.getData();
  const xml = mindElixirToFreemind(data.nodeData);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.nodeData.topic || 'mindmap') + '.mm';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('.mmファイルを書き出しました');
});

document.getElementById('btn-export-outline').addEventListener('click', () => {
  const data = mind.getData();
  const text = mindElixirToOutline(data.nodeData);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.nodeData.topic || 'mindmap') + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('テキストを書き出しました(生成AI用)');
});

// ---- ノードへの画像挿入 ----

function insertImageIntoNode(file) {
  if (!mind.currentNode) {
    alert('先にノードをクリックして選択してください');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 240;
      const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
      mind.reshapeNode(mind.currentNode, {
        image: {
          url: reader.result,
          width: Math.round(img.naturalWidth * scale),
          height: Math.round(img.naturalHeight * scale),
        },
      });
      setStatus('画像を挿入しました');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

document.getElementById('btn-insert-image').addEventListener('click', () => {
  document.getElementById('file-input-image').click();
});

document.getElementById('file-input-image').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  insertImageIntoNode(file);
  event.target.value = '';
});

document.addEventListener('paste', (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  insertImageIntoNode(file);
});

// ---- ファイル一覧パネル ----

const fileListPanel = document.getElementById('file-list-panel');
const fileListItems = document.getElementById('file-list-items');

function renderFileList() {
  const list = getFilesIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  fileListItems.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.textContent = '保存されたファイルはまだありません';
    fileListItems.appendChild(li);
    return;
  }

  list.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (f.id === currentFileId ? ' current' : '');

    const info = document.createElement('div');
    info.className = 'file-list-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-list-item-name';
    nameEl.textContent = f.name;
    const dateEl = document.createElement('div');
    dateEl.className = 'file-list-item-date';
    dateEl.textContent = '最終更新: ' + new Date(f.updatedAt).toLocaleString('ja-JP');
    info.appendChild(nameEl);
    if (f.id === currentFileId) {
      const badge = document.createElement('span');
      badge.className = 'file-list-item-badge';
      badge.textContent = '開いているファイル';
      info.appendChild(badge);
    }
    info.appendChild(dateEl);

    const openBtn = document.createElement('button');
    openBtn.textContent = '開く';
    openBtn.disabled = f.id === currentFileId;
    openBtn.addEventListener('click', () => {
      if (!confirm('保存していない変更は失われます。「' + f.name + '」を開きますか?')) {
        return;
      }
      const data = loadFileData(f.id);
      if (!data) {
        alert('データの読み込みに失敗しました');
        return;
      }
      setCurrentFileId(f.id);
      mind.init(data);
      setStatus('「' + f.name + '」を開きました');
      renderFileList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('「' + f.name + '」を削除します。元に戻せません。よろしいですか?')) {
        return;
      }
      const wasCurrent = f.id === currentFileId;
      deleteFileData(f.id);
      if (wasCurrent) {
        startNewFile(MindElixirCtor.new('新しいマインドマップ'));
      }
      setStatus('「' + f.name + '」を削除しました');
      renderFileList();
    });

    li.appendChild(info);
    li.appendChild(openBtn);
    li.appendChild(deleteBtn);
    fileListItems.appendChild(li);
  });
}

document.getElementById('btn-file-list').addEventListener('click', () => {
  renderFileList();
  fileListPanel.hidden = !fileListPanel.hidden;
});

document.getElementById('btn-file-list-close').addEventListener('click', () => {
  fileListPanel.hidden = true;
});

// ---- 使い方パネル ----

const helpPanel = document.getElementById('help-panel');
const HELP_SEEN_KEY = 'mindmap-cloud-app:help-seen';

document.getElementById('btn-help').addEventListener('click', () => {
  helpPanel.hidden = !helpPanel.hidden;
});

document.getElementById('btn-help-close').addEventListener('click', () => {
  helpPanel.hidden = true;
});

// 初回だけ自動で開いて操作方法に気づいてもらう
if (!localStorage.getItem(HELP_SEEN_KEY)) {
  helpPanel.hidden = false;
  localStorage.setItem(HELP_SEEN_KEY, '1');
}

setStatus('準備完了(ブラウザ内保存のみ / Stage 1)');
