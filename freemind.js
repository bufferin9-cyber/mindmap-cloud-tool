// FreeMind (.mm) <-> MindElixir nodeData 相互変換
// FreeMindの.mmは <map><node TEXT="ルート"><node TEXT="子1"/>...</node></map> というXML構造。
// MindElixirは {id, topic, children: [...]} というツリーJSONを使う。

function genId() {
  return 'nd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// .mm (XML文字列) -> MindElixirのdata ({nodeData, linkData:{}})
function freemindToMindElixir(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('.mmファイルの解析に失敗しました(XML形式が不正です)');
  }

  const rootNodeEl = doc.querySelector('map > node');
  if (!rootNodeEl) {
    throw new Error('.mmファイルにルートノードが見つかりません');
  }

  function convertNode(el) {
    const topic = el.getAttribute('TEXT') || '';
    const children = Array.from(el.children)
      .filter((child) => child.tagName === 'node')
      .map(convertNode);

    const node = { id: genId(), topic };
    if (children.length > 0) {
      node.children = children;
    }
    return node;
  }

  return {
    nodeData: convertNode(rootNodeEl),
    linkData: {},
  };
}

// MindElixirのnodeData -> .mm (XML文字列)
function mindElixirToFreemind(nodeData) {
  function escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function convertNode(node) {
    const children = (node.children || []).map(convertNode).join('');
    return `<node TEXT="${escapeXml(node.topic)}">${children}</node>`;
  }

  return `<map version="1.0.1">${convertNode(nodeData)}</map>`;
}

// MindElixirのnodeData -> 生成AIに渡しやすいインデント付き箇条書きテキスト
// (画像が付いているノードには [画像あり] と注記して、文字だけでも構造が伝わるようにする)
function mindElixirToOutline(nodeData) {
  const lines = [];

  function convertNode(node, depth) {
    const indent = '  '.repeat(depth);
    const marker = depth === 0 ? '#' : '-';
    const imageNote = node.image ? ' [画像あり]' : '';
    lines.push(`${indent}${marker} ${node.topic}${imageNote}`);
    (node.children || []).forEach((child) => convertNode(child, depth + 1));
  }

  convertNode(nodeData, 0);
  return lines.join('\n');
}
