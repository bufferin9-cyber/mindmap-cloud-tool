// Stage5: 業務フロータブ(マウス操作。vis-network使用)。
// マインドマップ(app.js)とは完全に独立(localStorageのキー名前空間も別)。
// 不要になれば index.html の該当セクション/script行と、このファイルを削除するだけで良い。
//
// 竜彰さんから「Mermaid記法を自分で書くのは難しい、関係図のようにマウスで作りたい」との
// フィードバックを受けて、Mermaid.jsによるテキスト記法から関係図タブと同じvis-networkの
// マウス操作エディタに作り直した(2026-07-25)。

const FLOW_TEMPLATE =
  '# 書き方: 1行に「箱A(種類) | 箱B(種類) | ラベル」を書きます(区切りは | )\n' +
  '# 種類の例: 開始/終了(丸い形)、分岐(ひし形)、それ以外は処理(四角い形)\n' +
  '開始1(開始) | 承認確認(分岐) | \n' +
  '承認確認(分岐) | 実行(処理) | はい\n' +
  '承認確認(分岐) | 差し戻し(処理) | いいえ\n' +
  '実行(処理) | 終了1(終了) | \n' +
  '差し戻し(処理) | 終了1(終了) | \n';

const FLOW_NODE_COLOR = '#2a78d6';

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
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
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

// ---- テキスト(独自の簡易記法) → 箱・矢印への変換 ----

// 種類キーワードから、箱の形を決める(開始/終了は丸み、分岐はひし形、それ以外は四角)
function shapeForType(type) {
  if (!type) return 'box';
  if (type.includes('開始') || type.includes('終了')) return 'ellipse';
  if (type.includes('分岐')) return 'diamond';
  return 'box';
}

// 箱表記は「名前」または「名前(種類)」
function flowParseNodeToken(raw) {
  const m = raw.match(/^(.+?)(?:\((.+?)\))?$/);
  const name = (m && m[1] ? m[1] : raw).trim();
  const type = m && m[2] ? m[2].trim() : '';
  return { name, type };
}

function parseFlowText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const nodes = new Map(); // name -> { name, type }
  const edgeList = [];
  const warnings = [];

  function ensureNode(raw) {
    const { name, type } = flowParseNodeToken(raw);
    if (!name) return null;
    if (!nodes.has(name)) {
      nodes.set(name, { name, type });
    } else if (type) {
      nodes.get(name).type = type;
    }
    return name;
  }

  lines.forEach((line, i) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length === 1) {
      ensureNode(parts[0]);
    } else if (parts.length >= 2) {
      const a = ensureNode(parts[0]);
      const b = ensureNode(parts[1]);
      const label = parts.length >= 3 ? parts.slice(2).join('|').trim() : '';
      if (a && b) {
        edgeList.push({ from: a, to: b, label });
      }
    } else {
      warnings.push((i + 1) + '行目: 「箱A(種類) | 箱B(種類) | ラベル」の形になっていません(スキップしました)');
    }
  });

  return { nodes, edgeList, warnings };
}

// ---- 描画 ----
//
// テキスト欄とネットワーク図(vis-network)は双方向に同期する:
// - テキストを編集 → 解析して箱/矢印のデータを作り直す(全体を再構築)
// - GUI操作(箱追加・矢印追加・編集・削除ボタン)で箱/矢印を操作 → その内容をテキストへ書き戻す
// この2つが無限ループしないよう、`flowSyncingFromText`フラグでどちらが発生源かを区別している。

const flowEditor = document.getElementById('flow-editor');
const flowRenderEl = document.getElementById('flow-render');
const flowStatusEl = document.getElementById('flow-status');

function setFlowStatus(text) {
  flowStatusEl.textContent = text;
}

function flowNodeVisualFromNameType(name, type) {
  const shape = shapeForType(type);
  // vis-networkは box/ellipse などは図形の中に白文字でラベルを描けるが、
  // diamond などの一部の形はラベルを図形の外(白い背景の上)に描くため、
  // 白文字のままだと見えなくなる。形によって文字色を切り替える
  const labelOutsideShape = shape === 'diamond';
  return {
    name,
    type: type || '',
    label: name,
    shape,
    color: { background: FLOW_NODE_COLOR, border: FLOW_NODE_COLOR },
    font: { color: labelOutsideShape ? '#212121' : '#ffffff', multi: false },
    margin: 10,
  };
}

function flowEdgeVisualFromLabel(label) {
  return {
    label: label || '',
    color: { color: '#52514e' },
    font: { align: 'top', size: 12, color: '#52514e' },
    smooth: { type: 'continuous' },
    arrows: { to: true },
  };
}

let flowSyncingFromText = false;

const flowNodesDataSet = new vis.DataSet([]);
const flowEdgesDataSet = new vis.DataSet([]);
let flowNetwork = null;

function flowSerializeNetworkToText() {
  const nodesArr = flowNodesDataSet.get();
  const edgesArr = flowEdgesDataSet.get();
  const connected = new Set();
  edgesArr.forEach((e) => {
    connected.add(e.from);
    connected.add(e.to);
  });

  function nodeToken(n) {
    return n.type ? n.name + '(' + n.type + ')' : n.name;
  }

  const lines = [];
  nodesArr.forEach((n) => {
    if (!connected.has(n.id)) {
      lines.push(nodeToken(n));
    }
  });
  edgesArr.forEach((e) => {
    const fromNode = flowNodesDataSet.get(e.from);
    const toNode = flowNodesDataSet.get(e.to);
    if (!fromNode || !toNode) return;
    lines.push(nodeToken(fromNode) + ' | ' + nodeToken(toNode) + ' | ' + (e.label || ''));
  });
  return lines.join('\n');
}

function flowSyncTextFromNetworkData() {
  if (flowSyncingFromText) return;
  flowEditor.value = flowSerializeNetworkToText();
  setFlowStatus('図の操作をテキストに反映しました(コメント行は失われます)');
}

flowNodesDataSet.on('add', flowSyncTextFromNetworkData);
flowNodesDataSet.on('update', flowSyncTextFromNetworkData);
flowNodesDataSet.on('remove', flowSyncTextFromNetworkData);
flowEdgesDataSet.on('add', flowSyncTextFromNetworkData);
flowEdgesDataSet.on('update', flowSyncTextFromNetworkData);
flowEdgesDataSet.on('remove', flowSyncTextFromNetworkData);

// 業務フロータブが非表示(display:none)の間にvis-networkを初期化すると、
// コンテナの幅・高さを0として認識してしまい、表示後もズーム位置がおかしくなる
// (関係図タブで実際に発生した不具合と同じ)。タブが表示された瞬間に
// サイズを再計算させるため、tabs.jsから呼び出す。
function handleFlowchartTabShown() {
  if (!flowNetwork) return;
  flowNetwork.redraw();
  flowNetwork.fit();
}

function flowEnsureNetworkCreated() {
  if (flowNetwork) return;
  flowNetwork = new vis.Network(
    flowRenderEl,
    { nodes: flowNodesDataSet, edges: flowEdgesDataSet },
    {
      physics: {
        stabilization: { iterations: 200, fit: true },
        barnesHut: { springLength: 220, avoidOverlap: 0.6 },
      },
      interaction: { hover: true },
      edges: { arrows: { to: true } },
      manipulation: {
        enabled: true,
        initiallyActive: true,
        addNode: function (data, callback) {
          const name = (prompt('新しい箱の名前を入力してください', '') || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const type = (prompt('種類(任意。例: 開始/終了/分岐/処理)', '') || '').trim();
          Object.assign(data, flowNodeVisualFromNameType(name, type));
          data.id = name;
          callback(data);
        },
        addEdge: function (data, callback) {
          if (data.from === data.to) {
            alert('同じ箱同士は結べません');
            callback(null);
            return;
          }
          const label = prompt('この矢印のラベルを入力してください(例: はい/いいえ。空欄でも可)', '');
          if (label === null) {
            callback(null);
            return;
          }
          Object.assign(data, flowEdgeVisualFromLabel(label.trim()));
          callback(data);
        },
        editNode: function (data, callback) {
          const current = flowNodesDataSet.get(data.id) || {};
          const name = (prompt('名前を編集してください', current.name || data.id) || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const type = (prompt('種類を編集してください(空欄可)', current.type || '') || '').trim();
          Object.assign(data, flowNodeVisualFromNameType(name, type));
          // idは変更しない(矢印のfrom/toが参照しているため、表示名だけ更新する)
          callback(data);
        },
        editEdge: {
          editWithoutDrag: function (data, callback) {
            const current = flowEdgesDataSet.get(data.id) || {};
            const label = prompt('ラベルを編集してください', current.label || '');
            if (label === null) {
              callback(null);
              return;
            }
            Object.assign(data, flowEdgeVisualFromLabel(label.trim()));
            callback(data);
          },
        },
        deleteNode: function (data, callback) {
          if (!confirm('選択した箱(とつながっている矢印)を削除します。よろしいですか?')) {
            callback(null);
            return;
          }
          callback(data);
        },
        deleteEdge: function (data, callback) {
          if (!confirm('選択した矢印を削除します。よろしいですか?')) {
            callback(null);
            return;
          }
          callback(data);
        },
      },
      locale: 'ja',
      locales: {
        // vis-networkはロケール設定に関わらず内部でlocales.en.closeを直接参照する箇所があるため、
        // 英語ロケールも(closeキーだけでも)残しておかないと描画が止まる(関係図タブと同じ不具合)
        en: {
          close: 'Close',
        },
        ja: {
          edit: '編集',
          del: '選択を削除',
          back: '戻る',
          addNode: '箱追加',
          addEdge: '矢印追加',
          editNode: '箱編集',
          editEdge: '矢印編集',
          addDescription: '箱を置きたい場所をクリックしてください。',
          edgeDescription: '起点の箱をクリックし、そのまま繋ぎたい箱までドラッグしてください。',
          editEdgeDescription: '矢印の端をドラッグして繋ぎ変えるか、矢印をクリックして内容を編集してください。',
          createEdgeError: 'この箱には矢印を作成できません。',
          deleteClusterError: 'クラスターは削除できません。',
          editClusterError: 'クラスターは編集できません。',
        },
      },
    }
  );
  flowNetwork.on('stabilizationIterationsDone', () => {
    flowNetwork.setOptions({ physics: false });
    flowNetwork.fit();
  });
}

function renderFlowchart() {
  const text = flowEditor.value;
  const { nodes, edgeList, warnings } = parseFlowText(text);

  flowEnsureNetworkCreated();

  flowSyncingFromText = true;

  const nodeArray = Array.from(nodes.values());
  const initRadius = 200;
  flowNodesDataSet.clear();
  flowNodesDataSet.add(
    nodeArray.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodeArray.length;
      return Object.assign({ id: n.name }, flowNodeVisualFromNameType(n.name, n.type), {
        x: Math.round(initRadius * Math.cos(angle)),
        y: Math.round(initRadius * Math.sin(angle)),
      });
    })
  );
  flowEdgesDataSet.clear();
  flowEdgesDataSet.add(
    edgeList.map((e, i) => Object.assign({ id: i, from: e.from, to: e.to }, flowEdgeVisualFromLabel(e.label)))
  );
  flowSyncingFromText = false;

  if (nodeArray.length > 0) {
    flowNetwork.setOptions({ physics: { enabled: true, stabilization: { iterations: 200, fit: true } } });
  }

  setFlowStatus(
    warnings.length
      ? '描画しました(' + warnings.length + '件のスキップ行あり: ' + warnings[0] + ')'
      : '描画しました'
  );
}

let flowRenderTimer = null;
flowEditor.addEventListener('input', () => {
  clearTimeout(flowRenderTimer);
  flowRenderTimer = setTimeout(renderFlowchart, 400);
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
renderFlowchart();

document.getElementById('flow-btn-new').addEventListener('click', () => {
  if (!confirm('保存していない変更は失われます。新しい業務フローを作成しますか?')) {
    return;
  }
  const id = genFlowFileId();
  saveFlowFileData(id, '');
  setCurrentFlowFileId(id);
  flowEditor.value = '';
  renderFlowchart();
  setFlowStatus('新規フローを作成しました');
});

document.getElementById('flow-btn-template').addEventListener('click', () => {
  flowEditor.value = FLOW_TEMPLATE;
  renderFlowchart();
  setFlowStatus('テンプレートを挿入しました');
});

document.getElementById('flow-btn-save').addEventListener('click', () => {
  saveFlowFileData(currentFlowFileId, flowEditor.value);
  setFlowStatus('保存しました: ' + new Date().toLocaleTimeString('ja-JP'));
});

document.getElementById('flow-btn-export-png').addEventListener('click', () => {
  const canvas = flowRenderEl.querySelector('canvas');
  if (!canvas) {
    alert('先に図を描画してください');
    return;
  }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = flowFirstLineAsName(flowEditor.value) + '.png';
  a.click();
  setFlowStatus('PNGを書き出しました');
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
      renderFlowchart();
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
        renderFlowchart();
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
