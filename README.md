# webdav-proxy-workers

pCloud の WebDAV エンドポイントをブラウザから CORS 制限なしで利用するための、
個人用 CORS 対応 WebDAV リバースプロキシです。Cloudflare Workers 上で動作し、
pCloud WebDAV (既定は EU リージョン `https://ewebdav.pcloud.com`) の任意の
サブディレクトリを転送します。

プロキシ自体は独自の Basic 認証で保護されており、pCloud の実際の認証情報は
Cloudflare Workers の secrets 内に隠蔽されます。

## セットアップ

```sh
npm install
npx wrangler secret put PROXY_USERNAME   # クライアント側に設定する任意のユーザー名
npx wrangler secret put PROXY_PASSWORD   # クライアント側に設定する任意のパスワード
npx wrangler secret put PCLOUD_USERNAME  # pCloud アカウントのメールアドレス
npx wrangler secret put PCLOUD_PASSWORD  # pCloud アカウントのパスワード
```

`wrangler.toml` の `vars`:

- `UPSTREAM` - pCloud WebDAV のベース URL (既定: EU リージョン `https://ewebdav.pcloud.com`。US の場合は `https://webdav.pcloud.com`)
- `ALLOWED_ORIGINS` - CORS を許可する Origin のカンマ区切りリスト

## ローカル開発

```sh
npx wrangler dev
```

`.dev.vars` にローカル用の secrets を置いて上書きできます:

```
PROXY_USERNAME=devuser
PROXY_PASSWORD=devpass
PCLOUD_USERNAME=you@example.com
PCLOUD_PASSWORD=your-pcloud-password
```

### 動作確認

```sh
# CORS preflight
curl -i -X OPTIONS http://127.0.0.1:8787/Documents/Books \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: PROPFIND"

# PROPFIND (要認証)
curl -i -X PROPFIND http://127.0.0.1:8787/Documents/Books/ \
  -H "Depth: 1" -u devuser:devpass

# 誤認証は 401
curl -i -X PROPFIND http://127.0.0.1:8787/Documents/Books/ \
  -H "Depth: 1" -u wrong:wrong
```

## デプロイ

```sh
npx wrangler deploy
```

## クライアント側の設定

WebDAV クライアントには以下を設定します。

- WebDAV URL: `https://<your-worker>.<your-subdomain>.workers.dev/<サブディレクトリ>/`
  (サブディレクトリは pCloud 上の任意のパスに置き換え可能)
- ユーザー名 / パスワード: `PROXY_USERNAME` / `PROXY_PASSWORD` に設定した値
  (pCloud の認証情報はクライアントには渡らない)
