// Stage5: タブ切り替え(マインドマップ/業務フロー/関係図)。
// マインドマップ自体のロジック(app.js)には一切触れていない。
// 不要になれば index.html の <nav class="app-tabs"> ブロックとこのファイルを削除するだけで良い。

document.querySelectorAll('.app-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.app-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.hidden = true;
    });
    document.getElementById('panel-' + btn.dataset.tab).hidden = false;

    // 関係図・配線図はhidden状態で初期化されるとコンテナサイズを0と誤認識するため、
    // 表示されたタイミングで再フィットさせる(各jsファイルが定義する関数)
    if (btn.dataset.tab === 'relation' && typeof handleRelationTabShown === 'function') {
      handleRelationTabShown();
    }
    if (btn.dataset.tab === 'wiring' && typeof handleWiringTabShown === 'function') {
      handleWiringTabShown();
    }
  });
});
