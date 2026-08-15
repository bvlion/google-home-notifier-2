# google-home-notifier-2

[noelportugal/google-home-notifier](https://github.com/noelportugal/google-home-notifier) をベースに、TTSエンジンを `google-tts-api` から [`@google-cloud/text-to-speech`](https://cloud.google.com/text-to-speech) へ置き換え、現在のNode.js環境向けに保守しているプロジェクトです。Node.jsからGoogle Home / Google Cast対応デバイスへテキスト読み上げやMP3再生を行えます。

## Features

現在の実装で提供している機能です。

- **Text-to-Speech通知**: テキストをGoogle Cloud Text-to-Speechで音声合成し、Google Home / Castデバイスで再生
- **MP3 URLの直接再生**: 任意のMP3 URLを指定してそのまま再生
- **IPによる通知先指定**: `googlehome.ip(ip)` で通知先デバイスをIPで直接指定
- **`device()` + mDNSによるデバイス探索**: IP未指定時は `googlehome.device(name)` で設定した名前を含むデバイスを mDNS(`_googlecast._tcp`)で探索
- **音量指定**: `googlehome.volume(level)` で再生音量を指定
- **複数デバイスの切り替え**: `googlehome.ip(ip)` は処理（リクエスト）ごとに呼び出せるため、1プロセスで複数デバイスを使い分け可能

## Architecture / Usage model

このリポジトリは3つの層に分かれています。

| ファイル | 役割 |
| --- | --- |
| `google-home-notifier-2.js` | Google Home / Castへの通知・再生を行うコアライブラリ |
| `main.js` | 固定1台のデバイス向けsample runner（そのまま実行できる最小構成） |
| `script/main.js` など（Git管理対象外） | 利用者が必要に応じて作成するカスタムrunner。複数デバイスの切り替えや家庭固有のルーティングを実装する場所 |

**`main.js` をそのまま使う方法だけがこのプロジェクトの利用方法ではありません。** `google-home-notifier-2.js` を直接 `require` して独自のrunnerを書くこともできます。`script/` ディレクトリは `.gitignore` で除外されているため、家庭固有のIPやルーティング、secretなどをOSS本体へコミットせずに管理できます（詳細は [Custom runner example](#custom-runner-example)）。

`main.js` は次の2つのHTTPサーバーを別ポートで起動します。

- 通知用server: `POST /google-home-notifier`（既定ポート `8091`） — テキストまたはMP3 URLを受け取り通知
- MP3配信用server: `GET /text-mp3`（既定ポート `8092`） — TTSで生成したMP3をGoogle Home / Castデバイスへ配信（ngrokで公開）

この「通知POSTは公開せず、MP3配信だけをngrokへ公開する」構成の理由は [ngrokの用途](#ngrokの用途) を参照してください。

## Requirements / Supported environment

- Node.js 22 または 24（CIでこの2バージョンを検証しています。Node.js 20など、CIで検証していないバージョンでの動作は保証していません）
- Google Cloudプロジェクト（Text-to-Speech APIを有効化し、認証情報を用意）
- ngrokアカウントとauthtoken
- 通知対象のGoogle Home / Google Cast対応デバイスと、実行ホストが同一LAN上で通信できること

CIではUbuntu上のNode.js 22 / 24を検証しています。また、Raspberry Piでの実運用実績があります。mDNS探索には [`bonjour-service`](https://www.npmjs.com/package/bonjour-service) というpure JavaScript実装を使用しており、旧`mdns`パッケージのようなnative addonや、そのビルドに必要な追加OSパッケージには依存していません。ただし、上記以外のOS・実行環境全般について一律に動作を保証するものではありません。

## Quick Start

```sh
$ git clone https://github.com/bvlion/google-home-notifier-2
$ cd google-home-notifier-2
$ npm install
```

1. Google Cloud Text-to-Speech APIを有効化し、認証情報を用意する（詳細は [Configuration](#configuration) を参照）
2. ngrokの [authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) を取得する
3. `.env.example` をコピーして必要な環境変数を設定する

   ```sh
   $ cp .env.example .env
   # .env を編集
   ```

4. 環境変数を読み込んでsample runnerを起動する

   ```sh
   $ set -a && source .env && set +a
   $ npm start
   # または
   $ node main.js
   ```

起動すると、通知用server（例: `http://localhost:8091/google-home-notifier`）とMP3配信用server（ngrok経由で公開）が立ち上がります。以下のように通知を送信できます。

```sh
$ curl -X POST -d "text=こんにちは" http://localhost:8091/google-home-notifier
```

## Configuration

`.env.example` をコピーして `.env` を作成し、値を設定してください。**`.env` は自動読み込みされません**。実行前にシェルや systemd などから環境変数として渡す必要があります（例: `set -a && source .env && set +a`）。

### 必須（共通）

| 環境変数 | 説明 |
| --- | --- |
| `NGROK_AUTHTOKEN` | ngrokのauthtoken |

### 任意（省略時はデフォルト値を使用）

| 環境変数 | 説明 | デフォルト値 |
| --- | --- | --- |
| `SERVER_PORT` | 通知用server（`POST /google-home-notifier`）のポート番号。ngrokへは公開されません | `8091` |
| `MP3_SERVER_PORT` | MP3配信用server（`GET /text-mp3`）のポート番号。ngrokはこのポートだけをforwardします。`SERVER_PORT` と同じ値は設定できません | `8092` |
| `TTS_LANGUAGE` | Text-to-Speechの言語コード（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP` |
| `TTS_VOICE` | Text-to-Speechの音声名（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP-Standard-A` |
| `MP3_URL_PATH` | 生成したMP3を配信するエンドポイントのパス | `/text-mp3` |
| `NOTIFY_URL_PATH` | 通知を受け付けるエンドポイントのパス | `/google-home-notifier` |
| `MP3_OUTPUT_PATH` | 生成したMP3の出力先パス | `sample.mp3` |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントJSONのパス（ADCの標準環境変数。他のADC方式を使う場合は不要） | - |

### `GOOGLE_HOME_IP`（sample runner専用）

`GOOGLE_HOME_IP` はライブラリ／共通設定としては必須ではありません。リポジトリ直下の `main.js`（固定1台向けsample runner）を利用する場合のみ必須で、未設定のまま起動するとエラーになります。処理ごとに通知先を切り替えるカスタムrunnerでは使いません（[Custom runner example](#custom-runner-example) を参照）。

### Google Cloud Text-to-Speechの認証

Google Cloudクライアントライブラリの標準的な認証方法（[Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)）を利用します。サービスアカウントJSONを使う場合は `GOOGLE_APPLICATION_CREDENTIALS` にそのファイルパスを設定してください。`gcloud auth application-default login` 済みの環境では設定不要です。

> [!TIP]
> [Google公式ドキュメント](https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries)

## Public API

`google-home-notifier-2.js` は次のAPIをexportしています。

```js
const googlehome = require('./google-home-notifier-2')

googlehome.setUp(language, voice, mp3OutputPath) // TTSの言語・音声・MP3出力先を設定
googlehome.ip(ip)                                // 通知先デバイスをIPで指定
googlehome.device(name)                          // ip()未指定時にmDNSで探索するデバイス名を指定
googlehome.volume(volume)                        // 再生音量を指定 (0.0〜1.0)
googlehome.ngrokUrl(url)                         // MP3配信用のngrok URL（+パス）を設定
googlehome.notify(text, callback)                // テキストを音声合成して再生
googlehome.play(url, callback)                   // 指定したMP3 URLを再生
```

基本的な使い方（IPを直接指定する場合）:

```js
googlehome.setUp('ja-JP', 'ja-JP-Standard-A', 'sample.mp3')
googlehome.ip('192.168.1.20')
googlehome.ngrokUrl('https://xxxx.ngrok-free.app/text-mp3') // main.js利用時は起動時に自動設定される

googlehome.notify('こんにちは', (result) => console.log(result))
googlehome.play('https://example.com/sound.mp3', (result) => console.log(result))
```

`ip()` を一度も呼び出していない状態であれば、`device()` でデバイス名を設定してmDNS探索させることもできます（`ip()` を呼び出すとそのIPがmodule内に保持され続けるため、`device()` を呼んでもIP指定は解除されません。IP指定とmDNS探索は排他的な設定として使い分けてください）。

```js
const googlehome = require('./google-home-notifier-2')

googlehome.setUp('ja-JP', 'ja-JP-Standard-A', 'sample.mp3')
googlehome.ngrokUrl('https://xxxx.ngrok-free.app/text-mp3') // main.js利用時は起動時に自動設定される
googlehome.device('Living Room speaker') // ip()は呼び出さない

googlehome.notify('こんにちは', (result) => console.log(result))
```

`ip()` は処理ごとに呼び出せるため、1プロセス内で複数デバイスを使い分けられます（詳細は次節）。

## Custom runner example

`main.js` は固定1台のデバイス向けsample runnerです。複数デバイスへの通知先切り替えや、家庭固有のリクエスト処理を行いたい場合は、`script/` ディレクトリ（`.gitignore` で除外済み）に独自のrunnerを作成してください。

`main.js` を土台にする場合、次の変更を行ってください。

1. リポジトリ内モジュールへの相対requireを、`script/` から見て1階層上を指すよう変更する（`require('./google-home-notifier-2')` → `require('../google-home-notifier-2')`、`require('./config')` → `require('../config')`、`require('./request-mp3')` → `require('../request-mp3')`）
2. `requireGoogleHomeIp` のimport（`require('../config')` の分割代入部分）と呼び出し（`const googleHomeIp = requireGoogleHomeIp(config)`）を削除する（custom runnerでは `GOOGLE_HOME_IP` を必須にする必要がないため）
3. `start()` 内の `createNotifyApp({ notifyUrl, googleHomeIp, language, voice, mp3OutputPath })` から `googleHomeIp` を取り除く（`const googleHomeIp = ...` を削除しただけでは、この参照が未定義変数となり起動時に `ReferenceError` になります）
4. `createNotifyApp` のrequestハンドラ内で固定IPを渡している `googlehome.ip(googleHomeIp)` を、リクエスト内容に応じて解決したIPに置き換える（例: `googlehome.ip(req.body.ip)` や家庭固有のルーティング条件）。あわせて `createNotifyApp` の引数リストからも不要になった `googleHomeIp` を取り除いて構いません

```sh
$ cp main.js script/main.js
# 上記の変更を反映
$ node script/main.js
```

通知用app（`createNotifyApp`）とMP3配信用app（`createMp3App`）を別ポートで起動し、ngrokはMP3配信用appだけをforwardする構成は、カスタムrunnerでも維持してください（[ngrokの用途](#ngrokの用途) を参照）。家庭固有の実際のIPやルーティング条件はOSS本体へコミットする必要はなく、`script/` 側だけで管理できます。

## ngrokの用途

ngrokの目的は、**通知POSTを外部公開することではなく、Text-to-Speechで生成したMP3ファイルをGoogle Home / Castデバイス自身が取得できるURLを用意すること**です。

通知を受け付けるserver（`SERVER_PORT`、POST `/google-home-notifier`）とMP3を配信するserver（`MP3_SERVER_PORT`、GET `/text-mp3`）は別ポートに分かれており、**ngrokはMP3配信用serverだけをforward**します。通知POSTはngrok経由では到達できず、LAN / localhostなど信頼できるネットワークから利用する前提です。

```
LAN / localhost                      Google Home / Cast
      |                                     |
      v                                   ngrok
通知用server                                |
POST /google-home-notifier                  v
:SERVER_PORT (既定8091)              MP3配信用server
                                     GET /text-mp3
                                     :MP3_SERVER_PORT (既定8092)
```

ngrok URLの固定化は行っていません。サーバー起動のたびに新しく取得したURLが自動的に利用されます。

## Security considerations

- Google Cloudのcredential（サービスアカウントJSON等）をコミットしない
- ngrokのauthtokenをコミットしない（`.env` は `.gitignore` 対象）
- 通知POST用server（`SERVER_PORT`）をngrok等で外部公開しない
- カスタムrunnerの家庭固有情報（IP・ルーティング等）はOSS本体へコミットせず、`script/`（Git管理対象外）に置く

## Troubleshooting

- **Text-to-Speechが失敗する**: Google Cloud Text-to-Speech APIが有効化されているか、認証情報（ADCまたは `GOOGLE_APPLICATION_CREDENTIALS`）が正しいか確認してください
- **デバイスに通知が届かない**: 実行ホストとGoogle Home / Castデバイスが、VLAN分離等なく同一LAN上で通信できるか確認してください
- **IP指定とmDNS探索の違い**: `ip()` を呼び出すとmDNS探索はスキップされます。IPが変わりやすい環境ではmDNS探索（`device()`）、固定IPが分かっている場合は `ip()` の方が簡便です

## systemd

serviceとして登録する場合の例です。`ExecStart` のnode実行パスや `WorkingDirectory`、実行ユーザーは環境に合わせて書き換えてください（`which node` で実際のパスを確認できます）。`.env` を `EnvironmentFile` として渡すことで環境変数を読み込ませられます。

```
[Unit]
Description=google-home-notifier Server
After=syslog.target network-online.target

[Service]
Type=simple
User=<your-user>
EnvironmentFile=/path/to/google-home-notifier-2/.env
ExecStart=/path/to/node /path/to/google-home-notifier-2/main.js
Restart=on-failure
RestartSec=10
WorkingDirectory=/path/to/google-home-notifier-2

[Install]
WantedBy=multi-user.target
```

## Credits / License

[noelportugal/google-home-notifier](https://github.com/noelportugal/google-home-notifier) をベースにしています。派生元へのクレジットは [NOTICE](./NOTICE) を参照してください。

MIT License. 詳細は [LICENSE](./LICENSE) を参照してください。
