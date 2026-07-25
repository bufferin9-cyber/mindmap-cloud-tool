// Stage 2: Googleドライブ連携
// Google Identity Services (GIS) のトークンクライアントでOAuth認証し、
// drive.fileスコープ(アプリが作成したファイルのみアクセス可能)でDrive REST APIを直接呼び出す。
// バックエンドサーバーは持たない(すべてブラウザ内で完結)。

// OAuthクライアントID(公開情報。ブラウザ上のコードに直接書く前提の値なので秘匿不要)
const GOOGLE_CLIENT_ID = '272800951156-ejdnk71riru27ecmjdt0akqqbj52nh0j.apps.googleusercontent.com';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_APP_FOLDER_NAME = 'マインドマップクラウド化ツール';

const Drive = (() => {
  let tokenClient = null;
  let accessToken = null;
  let appFolderId = null;
  let onSignedInCallback = null;

  function loadGisScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google Identity Servicesの読み込みに失敗しました'));
      document.head.appendChild(script);
    });
  }

  async function init(onSignedIn) {
    onSignedInCallback = onSignedIn;
    await loadGisScript();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: async (response) => {
        if (response.error) {
          alert('Googleサインインに失敗しました: ' + response.error);
          return;
        }
        accessToken = response.access_token;
        await ensureAppFolder();
        if (onSignedInCallback) onSignedInCallback();
      },
    });
  }

  function isSignedIn() {
    return !!accessToken;
  }

  function signIn() {
    tokenClient.requestAccessToken({ prompt: '' });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    appFolderId = null;
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: 'Bearer ' + accessToken,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Google Drive APIエラー(' + res.status + '): ' + text);
    }
    return res;
  }

  async function ensureAppFolder() {
    if (appFolderId) return appFolderId;
    // 完全一致ではなく「名前に含まれる」で検索する。
    // ユーザーがドライブ内の整理のため「005_マインドマップクラウド化ツール」のように
    // 番号などを前後に付けてリネームしても、同じフォルダを見つけられるようにするため。
    const q = encodeURIComponent(
      "name contains '" + DRIVE_APP_FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    const res = await apiFetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      appFolderId = data.files[0].id;
      return appFolderId;
    }
    const createRes = await apiFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DRIVE_APP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    const created = await createRes.json();
    appFolderId = created.id;
    return appFolderId;
  }

  async function listFiles() {
    const folderId = await ensureAppFolder();
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
    const res = await apiFetch(
      'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc'
    );
    const data = await res.json();
    return data.files || [];
  }

  async function createFile(name, dataObj) {
    const folderId = await ensureAppFolder();
    const metadata = { name, parents: [folderId], mimeType: 'application/json' };
    const boundary = 'mindmap_boundary_' + Math.random().toString(36).slice(2);
    const body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(dataObj) + '\r\n' +
      '--' + boundary + '--';

    const res = await apiFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
      {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body,
      }
    );
    return res.json();
  }

  async function getFileMeta(fileId) {
    const res = await apiFetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id,name,modifiedTime'
    );
    return res.json();
  }

  async function loadFile(fileId) {
    const meta = await getFileMeta(fileId);
    const res = await apiFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media');
    const data = await res.json();
    return { data, name: meta.name, modifiedTime: meta.modifiedTime };
  }

  // 保存前に、読み込んだ時点のmodifiedTimeと現在のmodifiedTimeを比較し、
  // 他の人が間に更新していないかを確認する(非同期共同編集の競合防止)
  async function saveFile(fileId, name, dataObj, expectedModifiedTime) {
    const currentMeta = await getFileMeta(fileId);
    if (expectedModifiedTime && currentMeta.modifiedTime !== expectedModifiedTime) {
      const err = new Error('CONFLICT');
      err.isConflict = true;
      throw err;
    }
    await apiFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataObj),
    });
    if (name && name !== currentMeta.name) {
      await apiFetch('https://www.googleapis.com/drive/v3/files/' + fileId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    }
    return getFileMeta(fileId);
  }

  async function deleteFile(fileId) {
    await apiFetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE' });
  }

  return {
    init,
    isSignedIn,
    signIn,
    signOut,
    listFiles,
    createFile,
    loadFile,
    saveFile,
    deleteFile,
  };
})();
