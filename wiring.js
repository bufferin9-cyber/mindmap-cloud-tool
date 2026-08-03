// Stage6: 配線図タブ(電気配線の接続図。vis-network使用)。
// マインドマップ・業務フロー・関係図とは完全に独立(localStorageのキー名前空間も別)。
// 不要になれば index.html の該当セクション/script行と、このファイルを削除するだけで良い。
//
// 今のところ「つなぎ方(接続図)」だけを扱う試作段階。電流や電線の太さの計算はまだ行わない。

const WIRE_TEMPLATE =
  '# 書き方: 1行に「部品A(種類) | 部品B(種類) | 種類」を書きます(区切りは | )\n' +
  '# 種類の例: パネル/バッテリー/コントローラー/ヒューズ/スイッチ/負荷\n' +
  '# 配線の種類は + (プラス配線、赤) / - (マイナス配線、黒) / 信号 (信号線、青) を書きます\n' +
  '# 「+-」と書くと、+とーの配線を1行で2本まとめて作れます\n' +
  'パネル1(パネル) | コントローラー1(コントローラー) | +-\n' +
  'コントローラー1(コントローラー) | バッテリー1(バッテリー) | +-\n' +
  'バッテリー1(バッテリー) | 負荷1(負荷) | +-\n' +
  'コントローラー1(コントローラー) | 負荷1(負荷) | 信号\n';

const WIRE_NODE_COLOR = '#37474f';
const WIRE_PLUS_COLOR = '#e34948';
const WIRE_MINUS_COLOR = '#212121';
const WIRE_SIGNAL_COLOR = '#2a78d6';
const WIRE_DEFAULT_COLOR = '#898781';

// 「+-」「-+」「±」のように書かれた場合、+とーの2本セットとして展開する
function isPlusMinusPairLabel(label) {
  const trimmed = (label || '').trim();
  return trimmed === '+-' || trimmed === '-+' || trimmed === '±';
}

const WIRE_FILES_INDEX_KEY = 'wiring-app:files';
const WIRE_CURRENT_FILE_KEY = 'wiring-app:currentFileId';

function wireFileDataKey(id) {
  return 'wiring-app:file:' + id;
}

function genWireFileId() {
  return 'wf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getWireFilesIndex() {
  try {
    return JSON.parse(localStorage.getItem(WIRE_FILES_INDEX_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function setWireFilesIndex(list) {
  localStorage.setItem(WIRE_FILES_INDEX_KEY, JSON.stringify(list));
}

function wireFirstLineAsName(text) {
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
  return (line || '無題の配線図').trim().slice(0, 30);
}

function registerWireFile(id, text) {
  const list = getWireFilesIndex();
  const name = wireFirstLineAsName(text);
  const existing = list.find((f) => f.id === id);
  if (existing) {
    existing.name = name;
    existing.updatedAt = Date.now();
  } else {
    list.unshift({ id, name, updatedAt: Date.now() });
  }
  setWireFilesIndex(list);
}

function saveWireFileData(id, text) {
  localStorage.setItem(wireFileDataKey(id), text);
  registerWireFile(id, text);
}

function loadWireFileData(id) {
  return localStorage.getItem(wireFileDataKey(id));
}

function deleteWireFileData(id) {
  localStorage.removeItem(wireFileDataKey(id));
  setWireFilesIndex(getWireFilesIndex().filter((f) => f.id !== id));
}

let currentWireFileId = null;

function setCurrentWireFileId(id) {
  currentWireFileId = id;
  localStorage.setItem(WIRE_CURRENT_FILE_KEY, id);
}

// ---- テキスト(独自の簡易記法) → 部品・配線への変換 ----

// 部品の種類キーワードから、分かりやすいアイコンを決める
function iconForType(type) {
  if (!type) return '';
  if (type.includes('パネル') || type.includes('ソーラー')) return '☀️';
  if (type.includes('バッテリー')) return '🔋';
  if (type.includes('コントローラー')) return '🎛️';
  if (type.includes('ヒューズ')) return '🛡️';
  if (type.includes('スイッチ')) return '🔘';
  if (type.includes('負荷') || type.includes('ライト') || type.includes('ポンプ') || type.includes('モーター')) return '💡';
  return '🔲';
}

// 部品表記は「名前」または「名前(種類)」
function wireParseNodeToken(raw) {
  const m = raw.match(/^(.+?)(?:\((.+?)\))?$/);
  const name = (m && m[1] ? m[1] : raw).trim();
  const type = m && m[2] ? m[2].trim() : '';
  return { name, type };
}

function colorForPolarity(label) {
  const trimmed = (label || '').trim();
  if (trimmed.includes('信号')) return WIRE_SIGNAL_COLOR;
  if (trimmed.includes('+')) return WIRE_PLUS_COLOR;
  if (trimmed.includes('-') || trimmed.includes('−')) return WIRE_MINUS_COLOR;
  return WIRE_DEFAULT_COLOR;
}

function parseWiringText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const nodes = new Map(); // name -> { name, type }
  const edgeList = [];
  const warnings = [];

  function ensureNode(raw) {
    const { name, type } = wireParseNodeToken(raw);
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
    } else if (parts.length >= 3) {
      const a = ensureNode(parts[0]);
      const b = ensureNode(parts[1]);
      const label = parts.slice(2).join('|').trim();
      if (a && b) {
        if (isPlusMinusPairLabel(label)) {
          edgeList.push({ from: a, to: b, label: '+' });
          edgeList.push({ from: a, to: b, label: '-' });
        } else {
          edgeList.push({ from: a, to: b, label });
        }
      }
    } else {
      warnings.push((i + 1) + '行目: 「部品A | 部品B | 種類」の形になっていません(スキップしました)');
    }
  });

  return { nodes, edgeList, warnings };
}

// ---- 描画 ----
//
// テキスト欄とネットワーク図(vis-network)は双方向に同期する:
// - テキストを編集 → 解析して部品/配線のデータを作り直す(全体を再構築)
// - GUI操作(部品追加・配線追加・編集・削除ボタン)で部品/配線を操作 → その内容をテキストへ書き戻す
// この2つが無限ループしないよう、`wireSyncingFromText`フラグでどちらが発生源かを区別している。

const wireEditor = document.getElementById('wire-editor');
const wireRenderEl = document.getElementById('wire-render');
const wireStatusEl = document.getElementById('wire-status');

function setWireStatus(text) {
  wireStatusEl.textContent = text;
}

function nodeVisualFromNameType(name, type) {
  const icon = iconForType(type);
  return {
    name,
    type: type || '',
    label: (icon ? icon + ' ' : '') + name + (type ? '\n(' + type + ')' : ''),
    shape: 'box',
    color: { background: WIRE_NODE_COLOR, border: WIRE_NODE_COLOR },
    font: { color: '#ffffff', multi: false },
    margin: 10,
  };
}

function wireEdgeVisualFromLabel(label) {
  const color = colorForPolarity(label);
  return {
    label,
    color: { color },
    font: { align: 'top', size: 12, color: '#52514e' },
    smooth: { type: 'continuous' },
    width: 3,
  };
}

let wireSyncingFromText = false;

const wireNodesDataSet = new vis.DataSet([]);
const wireEdgesDataSet = new vis.DataSet([]);
let wireNetwork = null;

function wireSerializeNetworkToText() {
  const nodesArr = wireNodesDataSet.get();
  const edgesArr = wireEdgesDataSet.get();
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
    const fromNode = wireNodesDataSet.get(e.from);
    const toNode = wireNodesDataSet.get(e.to);
    if (!fromNode || !toNode) return;
    lines.push(nodeToken(fromNode) + ' | ' + nodeToken(toNode) + ' | ' + (e.label || ''));
  });
  return lines.join('\n');
}

function wireSyncTextFromNetworkData() {
  if (wireSyncingFromText) return;
  wireEditor.value = wireSerializeNetworkToText();
  setWireStatus('図の操作をテキストに反映しました(コメント行は失われます)');
}

wireNodesDataSet.on('add', wireSyncTextFromNetworkData);
wireNodesDataSet.on('update', wireSyncTextFromNetworkData);
wireNodesDataSet.on('remove', wireSyncTextFromNetworkData);
wireEdgesDataSet.on('add', wireSyncTextFromNetworkData);
wireEdgesDataSet.on('update', wireSyncTextFromNetworkData);
wireEdgesDataSet.on('remove', wireSyncTextFromNetworkData);

// 配線図タブが非表示(display:none)の間にvis-networkを初期化すると、
// コンテナの幅・高さを0として認識してしまい、表示後もズーム位置がおかしくなる
// (関係図タブで実際に発生した不具合と同じ)。タブが表示された瞬間に
// サイズを再計算させるため、tabs.jsから呼び出す。
function handleWiringTabShown() {
  if (!wireNetwork) return;
  wireNetwork.redraw();
  wireNetwork.fit();
}

function wireEnsureNetworkCreated() {
  if (wireNetwork) return;
  wireNetwork = new vis.Network(
    wireRenderEl,
    { nodes: wireNodesDataSet, edges: wireEdgesDataSet },
    {
      physics: {
        stabilization: { iterations: 200, fit: true },
        barnesHut: { springLength: 220, avoidOverlap: 0.6 },
      },
      interaction: { hover: true, multiselect: true },
      edges: { arrows: { to: false } },
      manipulation: {
        enabled: true,
        initiallyActive: true,
        addNode: function (data, callback) {
          const name = (prompt('新しい部品の名前を入力してください', '') || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const type = (prompt('種類(任意。例: パネル/バッテリー/コントローラー/ヒューズ/スイッチ/負荷)', '') || '').trim();
          Object.assign(data, nodeVisualFromNameType(name, type));
          data.id = name;
          callback(data);
        },
        addEdge: function (data, callback) {
          if (data.from === data.to) {
            alert('同じ部品同士は結べません');
            callback(null);
            return;
          }
          const label = prompt('この配線の種類を入力してください(+ / - / 信号 / 自由な名前。「+-」で+とーを2本まとめて作成)', '+-');
          if (label === null) {
            callback(null);
            return;
          }
          const trimmedLabel = label.trim();
          if (isPlusMinusPairLabel(trimmedLabel)) {
            Object.assign(data, wireEdgeVisualFromLabel('+'));
            callback(data);
            wireEdgesDataSet.add(
              Object.assign({ from: data.from, to: data.to }, wireEdgeVisualFromLabel('-'))
            );
            return;
          }
          Object.assign(data, wireEdgeVisualFromLabel(trimmedLabel));
          callback(data);
        },
        editNode: function (data, callback) {
          const current = wireNodesDataSet.get(data.id) || {};
          const name = (prompt('名前を編集してください', current.name || data.id) || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const type = (prompt('種類を編集してください(空欄可)', current.type || '') || '').trim();
          Object.assign(data, nodeVisualFromNameType(name, type));
          // idは変更しない(配線のfrom/toが参照しているため、表示名だけ更新する)
          callback(data);
        },
        editEdge: {
          editWithoutDrag: function (data, callback) {
            const current = wireEdgesDataSet.get(data.id) || {};
            const label = prompt('極性を編集してください(+ または -)', current.label || '');
            if (label === null) {
              callback(null);
              return;
            }
            Object.assign(data, wireEdgeVisualFromLabel(label.trim()));
            callback(data);
          },
        },
        deleteNode: function (data, callback) {
          if (!confirm('選択した部品(とつながっている配線)を削除します。よろしいですか?')) {
            callback(null);
            return;
          }
          callback(data);
        },
        deleteEdge: function (data, callback) {
          if (!confirm('選択した配線を削除します。よろしいですか?')) {
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
          addNode: '部品追加',
          addEdge: '配線追加',
          editNode: '部品編集',
          editEdge: '配線編集',
          addDescription: '部品を置きたい場所をクリックしてください。',
          edgeDescription: '起点の部品をクリックし、そのまま繋ぎたい部品までドラッグしてください。',
          editEdgeDescription: '配線の端をドラッグして繋ぎ変えるか、配線をクリックして内容を編集してください。',
          createEdgeError: 'この部品には配線を作成できません。',
          deleteClusterError: 'クラスターは削除できません。',
          editClusterError: 'クラスターは編集できません。',
        },
      },
    }
  );
  wireNetwork.on('stabilizationIterationsDone', () => {
    wireNetwork.setOptions({ physics: false });
    wireNetwork.fit();
  });
}

function renderWiring() {
  const text = wireEditor.value;
  const { nodes, edgeList, warnings } = parseWiringText(text);

  wireEnsureNetworkCreated();

  wireSyncingFromText = true;

  const nodeArray = Array.from(nodes.values());
  const initRadius = 200;
  wireNodesDataSet.clear();
  wireNodesDataSet.add(
    nodeArray.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodeArray.length;
      return Object.assign({ id: n.name }, nodeVisualFromNameType(n.name, n.type), {
        x: Math.round(initRadius * Math.cos(angle)),
        y: Math.round(initRadius * Math.sin(angle)),
      });
    })
  );
  wireEdgesDataSet.clear();
  wireEdgesDataSet.add(
    edgeList.map((e, i) => Object.assign({ id: i, from: e.from, to: e.to }, wireEdgeVisualFromLabel(e.label)))
  );
  wireSyncingFromText = false;

  if (nodeArray.length > 0) {
    wireNetwork.setOptions({ physics: { enabled: true, stabilization: { iterations: 200, fit: true } } });
  }

  setWireStatus(
    warnings.length
      ? '描画しました(' + warnings.length + '件のスキップ行あり: ' + warnings[0] + ')'
      : '描画しました'
  );
}

let wireRenderTimer = null;
wireEditor.addEventListener('input', () => {
  clearTimeout(wireRenderTimer);
  wireRenderTimer = setTimeout(renderWiring, 400);
});

function resolveInitialWireText() {
  const savedCurrentId = localStorage.getItem(WIRE_CURRENT_FILE_KEY);
  if (savedCurrentId) {
    const text = loadWireFileData(savedCurrentId);
    if (text !== null) {
      currentWireFileId = savedCurrentId;
      return text;
    }
  }
  const id = genWireFileId();
  saveWireFileData(id, WIRE_TEMPLATE);
  setCurrentWireFileId(id);
  return WIRE_TEMPLATE;
}

wireEditor.value = resolveInitialWireText();
renderWiring();

document.getElementById('wire-btn-new').addEventListener('click', () => {
  if (!confirm('保存していない変更は失われます。新しい配線図を作成しますか?')) {
    return;
  }
  const id = genWireFileId();
  saveWireFileData(id, '');
  setCurrentWireFileId(id);
  wireEditor.value = '';
  renderWiring();
  setWireStatus('新規の配線図を作成しました');
});

document.getElementById('wire-btn-template').addEventListener('click', () => {
  wireEditor.value = WIRE_TEMPLATE;
  renderWiring();
  setWireStatus('テンプレートを挿入しました');
});

document.getElementById('wire-btn-save').addEventListener('click', () => {
  saveWireFileData(currentWireFileId, wireEditor.value);
  setWireStatus('保存しました: ' + new Date().toLocaleTimeString('ja-JP'));
});

document.getElementById('wire-btn-export-png').addEventListener('click', () => {
  const canvas = wireRenderEl.querySelector('canvas');
  if (!canvas) {
    alert('先に図を描画してください');
    return;
  }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = wireFirstLineAsName(wireEditor.value) + '.png';
  a.click();
  setWireStatus('PNGを書き出しました');
});

document.getElementById('wire-btn-swap').addEventListener('click', () => {
  const selected = wireNetwork.getSelectedNodes();
  if (selected.length !== 2) {
    alert('位置を入れ替えたい部品を2つ選んでください(1つ目をクリックしたあと、Ctrlキーを押しながら2つ目をクリック)');
    return;
  }
  const positions = wireNetwork.getPositions(selected);
  const [a, b] = selected;
  // 物理演算(自動配置)が動いたままだと、入れ替えた直後に位置がまたずれてしまうため、
  // 入れ替えるタイミングで確実に止める
  wireNetwork.setOptions({ physics: false });
  wireNetwork.moveNode(a, positions[b].x, positions[b].y);
  wireNetwork.moveNode(b, positions[a].x, positions[a].y);
  wireNetwork.unselectAll();
  setWireStatus('位置を入れ替えました');
});

// ---- ファイル一覧パネル ----

const wireFileListPanel = document.getElementById('wire-file-list-panel');
const wireFileListItems = document.getElementById('wire-file-list-items');

function renderWireFileList() {
  const list = getWireFilesIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  wireFileListItems.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.textContent = '保存されたファイルはまだありません';
    wireFileListItems.appendChild(li);
    return;
  }

  list.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (f.id === currentWireFileId ? ' current' : '');

    const info = document.createElement('div');
    info.className = 'file-list-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-list-item-name';
    nameEl.textContent = f.name;
    const dateEl = document.createElement('div');
    dateEl.className = 'file-list-item-date';
    dateEl.textContent = '最終更新: ' + new Date(f.updatedAt).toLocaleString('ja-JP');
    info.appendChild(nameEl);
    if (f.id === currentWireFileId) {
      const badge = document.createElement('span');
      badge.className = 'file-list-item-badge';
      badge.textContent = '開いているファイル';
      info.appendChild(badge);
    }
    info.appendChild(dateEl);

    const openBtn = document.createElement('button');
    openBtn.textContent = '開く';
    openBtn.disabled = f.id === currentWireFileId;
    openBtn.addEventListener('click', () => {
      if (!confirm('保存していない変更は失われます。「' + f.name + '」を開きますか?')) {
        return;
      }
      const text = loadWireFileData(f.id);
      if (text === null) {
        alert('データの読み込みに失敗しました');
        return;
      }
      setCurrentWireFileId(f.id);
      wireEditor.value = text;
      renderWiring();
      setWireStatus('「' + f.name + '」を開きました');
      renderWireFileList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('「' + f.name + '」を削除します。元に戻せません。よろしいですか?')) {
        return;
      }
      const wasCurrent = f.id === currentWireFileId;
      deleteWireFileData(f.id);
      if (wasCurrent) {
        const id = genWireFileId();
        saveWireFileData(id, '');
        setCurrentWireFileId(id);
        wireEditor.value = '';
        renderWiring();
      }
      setWireStatus('「' + f.name + '」を削除しました');
      renderWireFileList();
    });

    li.appendChild(info);
    li.appendChild(openBtn);
    li.appendChild(deleteBtn);
    wireFileListItems.appendChild(li);
  });
}

document.getElementById('wire-btn-file-list').addEventListener('click', () => {
  renderWireFileList();
  wireFileListPanel.hidden = !wireFileListPanel.hidden;
});

document.getElementById('wire-btn-file-list-close').addEventListener('click', () => {
  wireFileListPanel.hidden = true;
});

// ---- 使い方パネル ----

const wireHelpPanel = document.getElementById('wire-help-panel');

document.getElementById('wire-btn-help').addEventListener('click', () => {
  wireHelpPanel.hidden = !wireHelpPanel.hidden;
});

document.getElementById('wire-btn-help-close').addEventListener('click', () => {
  wireHelpPanel.hidden = true;
});
