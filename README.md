# pCloud Gateway — WebDAV / OPDS (webdav-proxy-workers)

pCloud の WebDAV および OPDS カタログエンドポイントをブラウザや電子書籍リーダー（Readest、KOReader 等）から CORS 制限なしで利用するためのゲートウェイプロキシです。Cloudflare Workers 上で動作します。

- **WebDAV プロキシ**: 既存の WebDAV 通信（PROPFIND、GET、PUT 等）を pCloud WebDAV へ転送
- **OPDS カタログ (`/opds/`)**: pCloud 上のフォルダ一覧を OPDS 1.2 Atom XML フィードに変換し、Readest などの電子書籍リーダーから直接ブラウズ・ダウンロード可能にする機能
  - **OPDS 1.2 規格に準拠したフィード分離**: フォルダ階層をたどる Navigation Feed (`kind=navigation`) と、本の一覧・ダウンロードを行う Acquisition Feed (`kind=acquisition`, `?type=acquisition`) を明確に分離しています。フォルダ内に本がある場合は「📚 Books (N)」というエントリから書籍一覧へ遷移します。

プロキシ自体は独自の Basic 認証で保護されており、pCloud の実際の認証情報は Cloudflare Workers の secrets 内に安全に隠蔽されます。

## セットアップ

```sh
bun install
npx wrangler secret put PROXY_USERNAME   # クライアント側に設定する任意のユーザー名
npx wrangler secret put PROXY_PASSWORD   # クライアント側に設定する任意のパスワード
npx wrangler secret put PCLOUD_USERNAME  # pCloud アカウントのメールアドレス
npx wrangler secret put PCLOUD_PASSWORD  # pCloud アカウントのパスワード
```

`wrangler.toml` の `vars`:

- `UPSTREAM` - pCloud WebDAV のベース URL (既定: EU リージョン `https://ewebdav.pcloud.com`。US の場合は `https://webdav.pcloud.com`)
- `ALLOWED_ORIGINS` - CORS を許可する Origin のカンマ区切りリスト (例: `https://readest-web-personal.raven-log.workers.dev`)

## ローカル開発とテスト

```sh
# テスト実行
bun test

# 型チェック
bun run typecheck

# ローカル起動
bun run dev
```

`.dev.vars` にローカル用の secrets を置いて上書きできます:

```env
PROXY_USERNAME=devuser
PROXY_PASSWORD=devpass
PCLOUD_USERNAME=you@example.com
PCLOUD_PASSWORD=your-pcloud-password
```

### 動作確認

```sh
# CORS preflight
curl -i -X OPTIONS http://127.0.0.1:8787/Documents/Books \
  -H "Origin: https://readest-web-personal.raven-log.workers.dev" \
  -H "Access-Control-Request-Method: PROPFIND"

# WebDAV PROPFIND (要認証)
curl -i -X PROPFIND http://127.0.0.1:8787/Documents/Books/ \
  -H "Depth: 1" -u devuser:devpass

# OPDS カタログ取得 (要認証)
curl -i http://127.0.0.1:8787/opds/Documents/Books/ \
  -u devuser:devpass
```

## デプロイ

```sh
bun run deploy
```

## クライアント側の設定

### 1. Readest (OPDS カタログとして利用する場合)

Readest のライブラリ画面（「＋」メニュー → 「OPDS Catalogs」または「Online Library」）でカタログを追加します:

- **Catalog URL**: `https://<your-worker>.<your-subdomain>.workers.dev/opds/<書籍フォルダのパス>/`
  - 例: `https://webdav-proxy-37i4blu.raven-log.workers.dev/opds/Documents/Books/`
  - ルート全体を見る場合は `https://.../opds/`
- **Username**: `PROXY_USERNAME` に設定した値
- **Password**: `PROXY_PASSWORD` に設定した値

登録後、フォルダごとのナビゲーションや本のダウンロード（取り込み）がそのまま行えます。

### 2. WebDAV クライアント (KOReader やファイル同期として利用する場合)

- **WebDAV URL**: `https://<your-worker>.<your-subdomain>.workers.dev/<サブディレクトリ>/`
- **Username / Password**: `PROXY_USERNAME` / `PROXY_PASSWORD` に設定した値
