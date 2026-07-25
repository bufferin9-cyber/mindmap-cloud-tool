// Stage5: 業務フロータブ(Mermaid.js flowchart記法)。
// マインドマップ(app.js)とは完全に独立(localStorageのキー名前空間も別)。
// 不要になれば index.html の該当セクション/script行と、このファイルを削除するだけで良い。

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

const FLOW_TEMPLATE =
  'flowchart TD\n' +
  '  A[開始] --> B{承認?}\n' +
  '  B -- はい --> C[実行]\n' +
  '  B -- いいえ --> D[差し戻し]\n' +
  '  C --> E[終了]\n' +
  '  D --> E\n';

const FLOW_FILES_INDEX_KEY = 'flowchart-app:files';
const FLOW_CURRENT_FILE_KEY = 'flowchart-app:currentFileId';

function flowFileDataKey(id) {
  return 'flowchart-app:file:' + id;
}

function genFlowFileId() {
  return 'ff-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getFlowFilesIndex() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_FILES_INDEX_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function setFlowFilesIndex(list) {
  localStorage.setItem(FLOW_FILES_INDEX_KEY, JSON.stringify(list));
}

function flowFirstLineAsName(text) {
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('flowchart'));
  return (line || '無題の業務フロー').trim().slice(0, 30);
}

function registerFlowFile(id, text) {
  const list = getFlowFilesIndex();
  const name = flowFirstLineAsName(text);
  const existing = list.find((f) => f.id === id);
  if (existing) {
    existing.name = name;
    existing.updatedAt = Date.now();
  } else {
    list.unshift({ id, name, updatedAt: Date.now() });
  }
  setFlowFilesIndex(list);
}

function saveFlowFileData(id, text) {
  localStorage.setItem(flowFileDataKey(id), text);
  registerFlowFile(id, text);
}

function loadFlowFileData(id) {
  return localStorage.getItem(flowFileDataKey(id));
}

function deleteFlowFileData(id) {
  localStorage.removeItem(flowFileDataKey(id));
  setFlowFilesIndex(getFlowFilesIndex().filter((f) => f.id !== id));
}

let currentFlowFileId = null;

function setCurrentFlowFileId(id) {
  currentFlowFileId = id;
  localStorage.setItem(FLOW_CURRENT_FILE_KEY, id);
}

const flowEditor = document.getElementById('flow-editor');
const flowRender = document.getElementById('flow-render');
const flowStatusEl = document.getElementById('flow-status');

function setFlowStatus(text) {
  flowStatusEl.textContent = text;
}

let flowRenderSeq = 0;

async function renderFlow() {
  const text = flowEditor.value.trim();
  if (!text) {
    flowRender.innerHTML = '';
    return;
  }
  const id = 'flow-svg-' + (++flowRenderSeq);
  try {
    const { svg } = await mermaid.render(id, text);
    flowRender.innerHTML = svg;
  } catch (err) {
    flowRender.innerHTML =
      '<div class="render-error">記法にエラーがあります: ' +
      String(err.message || err).replace(/</g, '&lt;') +
      '</div>';
  }
}

let flowRenderTimer = null;
flowEditor.addEventListener('input', () => {
  clearTimeout(flowRenderTimer);
  flowRenderTimer = setTimeout(renderFlow, 400);
});

function resolveInitialFlowText() {
  const savedCurrentId = localStorage.getItem(FLOW_CURRENT_FILE_KEY);
  if (savedCurrentId) {
    const text = loadFlowFileData(savedCurrentId);
    if (text !== null) {
      currentFlowFileId = savedCurrentId;
      return text;
    }
  }
  const id = genFlowFileId();
  saveFlowFileData(id, FLOW_TEMPLATE);
  setCurrentFlowFileId(id);
  return FLOW_TEMPLATE;
}

flowEditor.value = resolveInitialFlowText();
renderFlow();

document.getElementById('flow-btn-new').addEventListener('click', () => {
  if (!confirm('保存していない変更は失われます。新しい業務フローを作成しますか?')) {
    return;
  }
  const id = genFlowFileId();
  saveFlowFileData(id, '');
  setCurrentFlowFileId(id);
  flowEditor.value = '';
  renderFlow();
  setFlowStatus('新規フローを作成しました');
});

document.getElementById('flow-btn-template').addEventListener('click', () => {
  flowEditor.value = FLOW_TEMPLATE;
  renderFlow();
  setFlowStatus('テンプレートを挿入しました');
});

document.getElementById('flow-btn-save').addEventListener('click', () => {
  saveFlowFileData(currentFlowFileId, flowEditor.value);
  setFlowStatus('保存しました: ' + new Date().toLocaleTimeString('ja-JP'));
});

document.getElementById('flow-btn-export-svg').addEventListener('click', () => {
  const svgEl = flowRender.querySelector('svg');
  if (!svgEl) {
    alert('先に図を描画してください(記法にエラーがないか確認してください)');
    return;
  }
  const xml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = flowFirstLineAsName(flowEditor.value) + '.svg';
  a.click();
  URL.revokeObjectURL(url);
  setFlowStatus('SVGを書き出しました');
});

// ---- ファイル一覧パネル ----

const flowFileListPanel = document.getElementById('flow-file-list-panel');
const flowFileListItems = document.getElementById('flow-file-list-items');

function renderFlowFileList() {
  const list = getFlowFilesIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  flowFileListItems.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.textContent = '保存されたファイルはまだありません';
    flowFileListItems.appendChild(li);
    return;
  }

  list.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (f.id === currentFlowFileId ? ' current' : '');

    const info = document.createElement('div');
    info.className = 'file-list-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-list-item-name';
    nameEl.textContent = f.name;
    const dateEl = document.createElement('div');
    dateEl.className = 'file-list-item-date';
    dateEl.textContent = '最終更新: ' + new Date(f.updatedAt).toLocaleString('ja-JP');
    info.appendChild(nameEl);
    if (f.id === currentFlowFileId) {
      const badge = document.createElement('span');
      badge.className = 'file-list-item-badge';
      badge.textContent = '開いているファイル';
      info.appendChild(badge);
    }
    info.appendChild(dateEl);

    const openBtn = document.createElement('button');
    openBtn.textContent = '開く';
    openBtn.disabled = f.id === currentFlowFileId;
    openBtn.addEventListener('click', () => {
      if (!confirm('保存していない変更は失われます。「' + f.name + '」を開きますか?')) {
        return;
      }
      const text = loadFlowFileData(f.id);
      if (text === null) {
        alert('データの読み込みに失敗しました');
        return;
      }
      setCurrentFlowFileId(f.id);
      flowEditor.value = text;
      renderFlow();
      setFlowStatus('「' + f.name + '」を開きました');
      renderFlowFileList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('「' + f.name + '」を削除します。元に戻せません。よろしいですか?')) {
        return;
      }
      const wasCurrent = f.id === currentFlowFileId;
      deleteFlowFileData(f.id);
      if (wasCurrent) {
        const id = genFlowFileId();
        saveFlowFileData(id, '');
        setCurrentFlowFileId(id);
        flowEditor.value = '';
        renderFlow();
      }
      setFlowStatus('「' + f.name + '」を削除しました');
      renderFlowFileList();
    });

    li.appendChild(info);
    li.appendChild(openBtn);
    li.appendChild(deleteBtn);
    flowFileListItems.appendChild(li);
  });
}

document.getElementById('flow-btn-file-list').addEventListener('click', () => {
  renderFlowFileList();
  flowFileListPanel.hidden = !flowFileListPanel.hidden;
});

document.getElementById('flow-btn-file-list-close').addEventListener('click', () => {
  flowFileListPanel.hidden = true;
});

// ---- 使い方パネル ----

const flowHelpPanel = document.getElementById('flow-help-panel');

document.getElementById('flow-btn-help').addEventListener('click', () => {
  flowHelpPanel.hidden = !flowHelpPanel.hidden;
});

document.getElementById('flow-btn-help-close').addEventListener('click', () => {
  flowHelpPanel.hidden = true;
});
