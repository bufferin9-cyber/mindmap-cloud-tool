// Stage5: 関係図タブ(人物・組織のつながりをネットワーク図で表示。vis-network使用)。
// マインドマップ(app.js)とは完全に独立(localStorageのキー名前空間も別)。
// 不要になれば index.html の該当セクション/script行と、このファイルを削除するだけで良い。

const REL_TEMPLATE =
  '# 書き方: 1行に「名前A | 名前B | 関係」を書きます(区切りは | )\n' +
  '# 名前の後に(所属)を付けると、同じ所属は同じ色で表示されます\n' +
  '# 関係に「協力」を含めると緑、「対立」を含めると赤、それ以外は青の線になります\n' +
  '田中太郎(東京大学) | 佐藤次郎(京都大学) | 共同研究プロジェクトX(協力)\n' +
  '田中太郎(東京大学) | 鈴木一郎(大阪大学) | 学会での対立\n' +
  '佐藤次郎(京都大学) | 鈴木一郎(大阪大学) | プロジェクトY(協力)\n';

// カテゴリカル配色(dataviz参照配色に準拠。赤は対立の辺色として予約済みのためノード所属色には使わない)
const REL_GROUP_PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e87ba4', '#eb6834', '#008300'];
const REL_NO_GROUP_COLOR = '#898781';
const REL_EDGE_CONFLICT = '#e34948';
const REL_EDGE_COOPERATION = '#1baf7a';
const REL_EDGE_DEFAULT = '#2a78d6';

// 色を自分で指定する際に選べる既定色(30色)。白文字のラベルでも読みやすいよう、
// 薄すぎる色は避けて選定している
const REL_PRESET_COLORS = [
  '#e34948', '#eb6834', '#eda100', '#c9a227', '#8bab1a',
  '#1baf7a', '#008300', '#0f9e8e', '#00838f', '#2a78d6',
  '#1e5fa8', '#3f51b5', '#4a3aa7', '#7b3fa0', '#9c27b0',
  '#ad1457', '#c2185b', '#e87ba4', '#8d6e63', '#795548',
  '#5d4037', '#6d4c41', '#455a64', '#607d8b', '#37474f',
  '#78909c', '#898781', '#616161', '#424242', '#212121',
];

const REL_FILES_INDEX_KEY = 'relation-app:files';
const REL_CURRENT_FILE_KEY = 'relation-app:currentFileId';

function relFileDataKey(id) {
  return 'relation-app:file:' + id;
}

function genRelFileId() {
  return 'rf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getRelFilesIndex() {
  try {
    return JSON.parse(localStorage.getItem(REL_FILES_INDEX_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function setRelFilesIndex(list) {
  localStorage.setItem(REL_FILES_INDEX_KEY, JSON.stringify(list));
}

function relFirstLineAsName(text) {
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
  return (line || '無題の関係図').trim().slice(0, 30);
}

function registerRelFile(id, text) {
  const list = getRelFilesIndex();
  const name = relFirstLineAsName(text);
  const existing = list.find((f) => f.id === id);
  if (existing) {
    existing.name = name;
    existing.updatedAt = Date.now();
  } else {
    list.unshift({ id, name, updatedAt: Date.now() });
  }
  setRelFilesIndex(list);
}

function saveRelFileData(id, text) {
  localStorage.setItem(relFileDataKey(id), text);
  registerRelFile(id, text);
}

function loadRelFileData(id) {
  return localStorage.getItem(relFileDataKey(id));
}

function deleteRelFileData(id) {
  localStorage.removeItem(relFileDataKey(id));
  setRelFilesIndex(getRelFilesIndex().filter((f) => f.id !== id));
}

let currentRelFileId = null;

function setCurrentRelFileId(id) {
  currentRelFileId = id;
  localStorage.setItem(REL_CURRENT_FILE_KEY, id);
}

// ---- テキスト(独自の簡易記法) → ノード・関係への変換 ----

// ノード表記は「名前」「名前(所属)」「名前#RRGGBB」「名前(所属)#RRGGBB」のいずれか。
// #RRGGBBが付いていれば、その色を自動配色より優先する(手動での色指定)。
function parseNodeToken(raw) {
  const m = raw.match(/^(.+?)(?:\((.+?)\))?(?:#([0-9a-fA-F]{6}))?$/);
  const name = (m && m[1] ? m[1] : raw).trim();
  const affiliation = m && m[2] ? m[2].trim() : '';
  const colorOverride = m && m[3] ? '#' + m[3] : '';
  return { name, affiliation, colorOverride };
}

// 関係(ラベル)の末尾に#RRGGBBが付いていれば、それを手動指定の色として切り出す
function parseEdgeLabel(rawLabel) {
  const m = rawLabel.match(/^(.*?)#([0-9a-fA-F]{6})$/);
  if (m) {
    return { label: m[1].trim(), colorOverride: '#' + m[2] };
  }
  return { label: rawLabel.trim(), colorOverride: '' };
}

function edgeColorForLabel(label) {
  if (label.includes('対立')) return REL_EDGE_CONFLICT;
  if (label.includes('協力')) return REL_EDGE_COOPERATION;
  return REL_EDGE_DEFAULT;
}

// 画面に表示するカラーピッカー用モーダル。
// <input type="color">を非表示にしてJSから.click()で強制的に開く方式は、
// (確認ダイアログなどを経由した後だと)ブラウザによってはユーザー操作と認識されず
// ピッカーが開かないまま処理が固まってしまう不具合が実際に発生したため、
// 必ず画面に見える状態でユーザー自身にクリックしてもらう方式に変更している。
const relColorModalOverlay = document.getElementById('rel-color-modal-overlay');
const relColorModalSwatches = document.getElementById('rel-color-modal-swatches');
const relColorModalInput = document.getElementById('rel-color-modal-input');
const relColorModalHex = document.getElementById('rel-color-modal-hex');

relColorModalInput.addEventListener('input', () => {
  relColorModalHex.textContent = relColorModalInput.value;
});

REL_PRESET_COLORS.forEach((color) => {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'modal-swatch';
  swatch.style.background = color;
  swatch.title = color;
  swatch.dataset.color = color;
  relColorModalSwatches.appendChild(swatch);
});

// 色選択モーダルを開き、既定色クリック/「この色にする」→選んだ色、
// 「自動配色に戻す」→空文字、「キャンセル」→null を返す
function askColorOverride(currentColor) {
  return new Promise((resolve) => {
    relColorModalInput.value = currentColor || '#2a78d6';
    relColorModalHex.textContent = relColorModalInput.value;
    relColorModalOverlay.hidden = false;

    function cleanup(result) {
      relColorModalOverlay.hidden = true;
      relColorModalSwatches.removeEventListener('click', onSwatchClick);
      okBtn.removeEventListener('click', onOk);
      autoBtn.removeEventListener('click', onAuto);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onSwatchClick(event) {
      const color = event.target.dataset && event.target.dataset.color;
      if (color) cleanup(color);
    }
    function onOk() {
      cleanup(relColorModalInput.value);
    }
    function onAuto() {
      cleanup('');
    }
    function onCancel() {
      cleanup(null);
    }

    const okBtn = document.getElementById('rel-color-modal-ok');
    const autoBtn = document.getElementById('rel-color-modal-auto');
    const cancelBtn = document.getElementById('rel-color-modal-cancel');
    relColorModalSwatches.addEventListener('click', onSwatchClick);
    okBtn.addEventListener('click', onOk);
    autoBtn.addEventListener('click', onAuto);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function parseRelationText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const nodes = new Map(); // name -> { name, affiliation, colorOverride }
  const groupOrder = [];
  const edgeList = [];
  const warnings = [];

  function ensureNode(raw) {
    const { name, affiliation, colorOverride } = parseNodeToken(raw);
    if (!name) return null;
    if (!nodes.has(name)) {
      nodes.set(name, { name, affiliation, colorOverride });
    } else {
      if (affiliation) nodes.get(name).affiliation = affiliation;
      if (colorOverride) nodes.get(name).colorOverride = colorOverride;
    }
    const finalAffiliation = nodes.get(name).affiliation;
    if (finalAffiliation && !groupOrder.includes(finalAffiliation)) {
      groupOrder.push(finalAffiliation);
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
      const { label, colorOverride } = parseEdgeLabel(parts.slice(2).join('|').trim());
      if (a && b) {
        edgeList.push({ from: a, to: b, label, colorOverride });
      }
    } else {
      warnings.push((i + 1) + '行目: 「名前A | 名前B | 関係」の形になっていません(スキップしました)');
    }
  });

  return { nodes, edgeList, groupOrder, warnings };
}

// ---- 描画 ----
//
// テキスト欄とネットワーク図(vis-network)は双方向に同期する:
// - テキストを編集 → 解析してノード/リンクのデータを作り直す(全体を再構築)
// - GUI操作(ノード追加・リンク追加・編集・削除ボタン)でノード/リンクを操作 → その内容をテキストへ書き戻す
// この2つが無限ループしないよう、`syncingFromText`フラグでどちらが発生源かを区別している。

const relEditor = document.getElementById('rel-editor');
const relRenderEl = document.getElementById('rel-render');
const relStatusEl = document.getElementById('rel-status');

function setRelStatus(text) {
  relStatusEl.textContent = text;
}

// GUI操作(ノード追加など)で新しく登場した所属にも色を割り当てられるよう、
// 所属の登場順リストをテキスト解析結果ではなくここで一元管理する
let relGroupOrder = [];

function colorForAffiliation(affiliation) {
  if (!affiliation) return REL_NO_GROUP_COLOR;
  let idx = relGroupOrder.indexOf(affiliation);
  if (idx === -1) {
    relGroupOrder.push(affiliation);
    idx = relGroupOrder.length - 1;
  }
  return REL_GROUP_PALETTE[idx % REL_GROUP_PALETTE.length];
}

function nodeVisualFromNameAffiliation(name, affiliation, colorOverride) {
  const color = colorOverride || colorForAffiliation(affiliation);
  return {
    name,
    affiliation: affiliation || '',
    colorOverride: colorOverride || '',
    label: affiliation ? name + '\n(' + affiliation + ')' : name,
    shape: 'box',
    color: { background: color, border: color },
    font: { color: '#ffffff', multi: false },
    margin: 10,
  };
}

function edgeVisualFromLabel(label, colorOverride) {
  const color = colorOverride || edgeColorForLabel(label);
  return {
    label,
    colorOverride: colorOverride || '',
    color: { color: color },
    font: { align: 'top', size: 12, color: '#52514e' },
    smooth: { type: 'continuous' },
  };
}

// テキスト解析中(renderRelationText)はtrueにして、DataSetの変更イベントで
// テキストへ書き戻すのを止める(自分自身を上書きするループを防ぐため)
let syncingFromText = false;

const relNodesDataSet = new vis.DataSet([]);
const relEdgesDataSet = new vis.DataSet([]);
let relNetwork = null;

function serializeNetworkToText() {
  const nodesArr = relNodesDataSet.get();
  const edgesArr = relEdgesDataSet.get();
  const connected = new Set();
  edgesArr.forEach((e) => {
    connected.add(e.from);
    connected.add(e.to);
  });

  function nodeToken(n) {
    return (n.affiliation ? n.name + '(' + n.affiliation + ')' : n.name) + (n.colorOverride || '');
  }

  const lines = [];
  nodesArr.forEach((n) => {
    if (!connected.has(n.id)) {
      lines.push(nodeToken(n));
    }
  });
  edgesArr.forEach((e) => {
    const fromNode = relNodesDataSet.get(e.from);
    const toNode = relNodesDataSet.get(e.to);
    if (!fromNode || !toNode) return;
    lines.push(nodeToken(fromNode) + ' | ' + nodeToken(toNode) + ' | ' + (e.label || '') + (e.colorOverride || ''));
  });
  return lines.join('\n');
}

// GUI操作でノード/リンクが変わったら、その内容をテキスト欄へ反映する
// (テキスト側の編集で発生した変更は syncingFromText が立っているのでここではスキップする)
function syncTextFromNetworkData() {
  if (syncingFromText) return;
  relEditor.value = serializeNetworkToText();
  setRelStatus('図の操作をテキストに反映しました(コメント行は失われます)');
}

relNodesDataSet.on('add', syncTextFromNetworkData);
relNodesDataSet.on('update', syncTextFromNetworkData);
relNodesDataSet.on('remove', syncTextFromNetworkData);
relEdgesDataSet.on('add', syncTextFromNetworkData);
relEdgesDataSet.on('update', syncTextFromNetworkData);
relEdgesDataSet.on('remove', syncTextFromNetworkData);

// 関係図タブが非表示(display:none)の間にvis-networkを初期化すると、
// コンテナの幅・高さを0として認識してしまい、表示後もズーム位置がおかしくなる。
// タブが表示された瞬間にサイズを再計算させるため、tabs.jsから呼び出す。
function handleRelationTabShown() {
  if (!relNetwork) return;
  relNetwork.redraw();
  relNetwork.fit();
}

function ensureNetworkCreated() {
  if (relNetwork) return;
  relNetwork = new vis.Network(
    relRenderEl,
    { nodes: relNodesDataSet, edges: relEdgesDataSet },
    {
      physics: {
        stabilization: { iterations: 200, fit: true },
        barnesHut: { springLength: 220, avoidOverlap: 0.6 },
      },
      interaction: { hover: true },
      edges: { arrows: { to: false } },
      manipulation: {
        enabled: true,
        initiallyActive: true,
        addNode: async function (data, callback) {
          const name = (prompt('新しいノードの名前を入力してください', '') || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const affiliation = (prompt('所属(任意。同じ所属は同じ色になります。空欄でも可)', '') || '').trim();
          const colorOverride = await askColorOverride(colorForAffiliation(affiliation));
          Object.assign(data, nodeVisualFromNameAffiliation(name, affiliation, colorOverride));
          data.id = name;
          callback(data);
        },
        addEdge: async function (data, callback) {
          if (data.from === data.to) {
            alert('同じノード同士は結べません');
            callback(null);
            return;
          }
          const label = prompt('2者の関係を入力してください(例: 協力、対立、プロジェクト名など)', '');
          if (label === null) {
            callback(null);
            return;
          }
          const trimmedLabel = label.trim();
          const colorOverride = await askColorOverride(edgeColorForLabel(trimmedLabel));
          Object.assign(data, edgeVisualFromLabel(trimmedLabel, colorOverride));
          callback(data);
        },
        editNode: async function (data, callback) {
          const current = relNodesDataSet.get(data.id) || {};
          const name = (prompt('名前を編集してください', current.name || data.id) || '').trim();
          if (!name) {
            callback(null);
            return;
          }
          const affiliation = (prompt('所属を編集してください(空欄可)', current.affiliation || '') || '').trim();
          const colorOverride = await askColorOverride(current.colorOverride || colorForAffiliation(affiliation));
          Object.assign(data, nodeVisualFromNameAffiliation(name, affiliation, colorOverride));
          // idは変更しない(リンクのfrom/toが参照しているため、表示名だけ更新する)
          callback(data);
        },
        editEdge: {
          editWithoutDrag: async function (data, callback) {
            const current = relEdgesDataSet.get(data.id) || {};
            const label = prompt('関係を編集してください', current.label || '');
            if (label === null) {
              callback(null);
              return;
            }
            const trimmedLabel = label.trim();
            const colorOverride = await askColorOverride(current.colorOverride || edgeColorForLabel(trimmedLabel));
            Object.assign(data, edgeVisualFromLabel(trimmedLabel, colorOverride));
            callback(data);
          },
        },
        deleteNode: function (data, callback) {
          if (!confirm('選択したノード(と、つながっているリンク)を削除します。よろしいですか?')) {
            callback(null);
            return;
          }
          callback(data);
        },
        deleteEdge: function (data, callback) {
          if (!confirm('選択したリンクを削除します。よろしいですか?')) {
            callback(null);
            return;
          }
          callback(data);
        },
      },
      locale: 'ja',
      locales: {
        // vis-networkはロケール設定に関わらず内部でlocales.en.closeを直接参照する箇所があるため、
        // 英語ロケールも(closeキーだけでも)残しておかないと「Cannot read properties of undefined (reading 'close')」で描画が止まる
        en: {
          close: 'Close',
        },
        ja: {
          edit: '編集',
          del: '選択を削除',
          back: '戻る',
          addNode: 'ノード追加',
          addEdge: 'リンク追加',
          editNode: 'ノード編集',
          editEdge: 'リンク編集',
          addDescription: 'ノードを置きたい場所をクリックしてください。',
          edgeDescription: '起点のノードをクリックし、そのまま繋ぎたいノードまでドラッグしてください。',
          editEdgeDescription: 'リンクの端をドラッグして繋ぎ変えるか、リンクをクリックして内容を編集してください。',
          createEdgeError: 'このノードにはリンクを作成できません。',
          deleteClusterError: 'クラスターは削除できません。',
          editClusterError: 'クラスターは編集できません。',
        },
      },
    }
  );
  // テキストの再解析のたびに物理演算をやり直すので'once'ではなく'on'で毎回反応させる
  relNetwork.on('stabilizationIterationsDone', () => {
    relNetwork.setOptions({ physics: false });
    relNetwork.fit();
  });
}

function renderRelation() {
  const text = relEditor.value;
  const { nodes, edgeList, warnings } = parseRelationText(text);

  ensureNetworkCreated();

  syncingFromText = true;
  relGroupOrder = []; // テキストからの全体再構築時は所属の登場順を作り直す

  // 初期位置を円形に散らしておく(全ノードが原点付近に重なった状態から始まると
  // 物理演算が早期に「安定」と誤判定し、重なったまま止まってしまうことがあるため)
  const nodeArray = Array.from(nodes.values());
  const initRadius = 200;
  relNodesDataSet.clear();
  relNodesDataSet.add(
    nodeArray.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodeArray.length;
      return Object.assign({ id: n.name }, nodeVisualFromNameAffiliation(n.name, n.affiliation, n.colorOverride), {
        x: Math.round(initRadius * Math.cos(angle)),
        y: Math.round(initRadius * Math.sin(angle)),
      });
    })
  );
  relEdgesDataSet.clear();
  relEdgesDataSet.add(
    edgeList.map((e, i) => Object.assign({ id: i, from: e.from, to: e.to }, edgeVisualFromLabel(e.label, e.colorOverride)))
  );
  syncingFromText = false;

  if (nodeArray.length > 0) {
    // テキストを編集し直したので、物理演算を再度有効にして配置し直す
    relNetwork.setOptions({ physics: { enabled: true, stabilization: { iterations: 200, fit: true } } });
  }

  setRelStatus(
    warnings.length
      ? '描画しました(' + warnings.length + '件のスキップ行あり: ' + warnings[0] + ')'
      : '描画しました'
  );
}

let relRenderTimer = null;
relEditor.addEventListener('input', () => {
  clearTimeout(relRenderTimer);
  relRenderTimer = setTimeout(renderRelation, 400);
});

function resolveInitialRelText() {
  const savedCurrentId = localStorage.getItem(REL_CURRENT_FILE_KEY);
  if (savedCurrentId) {
    const text = loadRelFileData(savedCurrentId);
    if (text !== null) {
      currentRelFileId = savedCurrentId;
      return text;
    }
  }
  const id = genRelFileId();
  saveRelFileData(id, REL_TEMPLATE);
  setCurrentRelFileId(id);
  return REL_TEMPLATE;
}

relEditor.value = resolveInitialRelText();
renderRelation();

document.getElementById('rel-btn-new').addEventListener('click', () => {
  if (!confirm('保存していない変更は失われます。新しい関係図を作成しますか?')) {
    return;
  }
  const id = genRelFileId();
  saveRelFileData(id, '');
  setCurrentRelFileId(id);
  relEditor.value = '';
  renderRelation();
  setRelStatus('新規の関係図を作成しました');
});

document.getElementById('rel-btn-template').addEventListener('click', () => {
  relEditor.value = REL_TEMPLATE;
  renderRelation();
  setRelStatus('テンプレートを挿入しました');
});

document.getElementById('rel-btn-save').addEventListener('click', () => {
  saveRelFileData(currentRelFileId, relEditor.value);
  setRelStatus('保存しました: ' + new Date().toLocaleTimeString('ja-JP'));
});

document.getElementById('rel-btn-export-png').addEventListener('click', () => {
  const canvas = relRenderEl.querySelector('canvas');
  if (!canvas) {
    alert('先に図を描画してください');
    return;
  }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = relFirstLineAsName(relEditor.value) + '.png';
  a.click();
  setRelStatus('PNGを書き出しました');
});

// ---- ファイル一覧パネル ----

const relFileListPanel = document.getElementById('rel-file-list-panel');
const relFileListItems = document.getElementById('rel-file-list-items');

function renderRelFileList() {
  const list = getRelFilesIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  relFileListItems.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.textContent = '保存されたファイルはまだありません';
    relFileListItems.appendChild(li);
    return;
  }

  list.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (f.id === currentRelFileId ? ' current' : '');

    const info = document.createElement('div');
    info.className = 'file-list-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-list-item-name';
    nameEl.textContent = f.name;
    const dateEl = document.createElement('div');
    dateEl.className = 'file-list-item-date';
    dateEl.textContent = '最終更新: ' + new Date(f.updatedAt).toLocaleString('ja-JP');
    info.appendChild(nameEl);
    if (f.id === currentRelFileId) {
      const badge = document.createElement('span');
      badge.className = 'file-list-item-badge';
      badge.textContent = '開いているファイル';
      info.appendChild(badge);
    }
    info.appendChild(dateEl);

    const openBtn = document.createElement('button');
    openBtn.textContent = '開く';
    openBtn.disabled = f.id === currentRelFileId;
    openBtn.addEventListener('click', () => {
      if (!confirm('保存していない変更は失われます。「' + f.name + '」を開きますか?')) {
        return;
      }
      const text = loadRelFileData(f.id);
      if (text === null) {
        alert('データの読み込みに失敗しました');
        return;
      }
      setCurrentRelFileId(f.id);
      relEditor.value = text;
      renderRelation();
      setRelStatus('「' + f.name + '」を開きました');
      renderRelFileList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('「' + f.name + '」を削除します。元に戻せません。よろしいですか?')) {
        return;
      }
      const wasCurrent = f.id === currentRelFileId;
      deleteRelFileData(f.id);
      if (wasCurrent) {
        const id = genRelFileId();
        saveRelFileData(id, '');
        setCurrentRelFileId(id);
        relEditor.value = '';
        renderRelation();
      }
      setRelStatus('「' + f.name + '」を削除しました');
      renderRelFileList();
    });

    li.appendChild(info);
    li.appendChild(openBtn);
    li.appendChild(deleteBtn);
    relFileListItems.appendChild(li);
  });
}

document.getElementById('rel-btn-file-list').addEventListener('click', () => {
  renderRelFileList();
  relFileListPanel.hidden = !relFileListPanel.hidden;
});

document.getElementById('rel-btn-file-list-close').addEventListener('click', () => {
  relFileListPanel.hidden = true;
});

// ---- 使い方パネル ----

const relHelpPanel = document.getElementById('rel-help-panel');

document.getElementById('rel-btn-help').addEventListener('click', () => {
  relHelpPanel.hidden = !relHelpPanel.hidden;
});

document.getElementById('rel-btn-help-close').addEventListener('click', () => {
  relHelpPanel.hidden = true;
});
