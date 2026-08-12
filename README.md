# google-home-notifier-2

[google-home-notifier](https://github.com/noelportugal/google-home-notifier) の `google-tts-api` を `@google-cloud/text-to-speech` に変更したもので、Google Home に音声ファイルを再生させます。

## セットアップ

### node や依存ライブラリ

```
$ sudo apt-get install -y git-core libnss-mdns libavahi-compat-libdnssd-dev
$ curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
$ sudo apt-get install -y nodejs
```

### インストール

``` sh
$ git clone https://github.com/bvlion/google-home-notifier-2
$ cd google-home-notifier-2
$ npm install
```

### Text-to-Speech の認証

1. Cloud Text-to-Speech API を有効にしサービスアカウントキーを発行
1. json をダウンロードして任意の場所に配置（`script` フォルダは git 管理対象外なので配置先として利用できます）
1. Google Cloud クライアントライブラリの標準的な認証方法（[Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)）を利用します。サービスアカウントJSONを使う場合は環境変数 `GOOGLE_APPLICATION_CREDENTIALS` にそのファイルパスを設定してください。`gcloud auth application-default login` 済みの環境などでは設定不要です。

> [!TIP]
> [Google ドキュメント](https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries)

### Ngrok

Ngrok で [auth key](https://dashboard.ngrok.com/get-started/your-authtoken) を発行します。取得した値は環境変数 `NGROK_AUTHTOKEN` に設定します。

このプロジェクトで ngrok を使う目的は、通知POSTを外部公開することではなく、**Text-to-Speechで生成したMP3ファイルをGoogle Home / Castデバイス自身が取得できるURLを用意すること**です。

そのため、通知を受け付ける server（`SERVER_PORT`、POST `/google-home-notifier`）とMP3を配信する server（`MP3_SERVER_PORT`、GET `/text-mp3`）は別ポートに分かれており、**ngrokはMP3配信用serverだけをforward**します。通知POSTはngrok経由では到達できず、LAN / localhost等の信頼できるネットワークから利用する前提です。

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

### 環境変数

ソースコードを直接編集する必要はありません。以下の環境変数で設定します。

`.env.example` をコピーして `.env` を作成し、値を設定してください。

``` sh
$ cp .env.example .env
```

`.env` はアプリが自動読み込みするものではありません。実行前にシェルや systemd などから環境変数として渡してください（後述）。

#### 必須（共通）

| 環境変数 | 説明 |
| --- | --- |
| `NGROK_AUTHTOKEN` | ngrok の authtoken |

#### 任意（省略時はデフォルト値を使用）

| 環境変数 | 説明 | デフォルト値 |
| --- | --- | --- |
| `SERVER_PORT` | 通知用server（POST `/google-home-notifier`）のポート番号。ngrokへは公開されません | `8091` |
| `MP3_SERVER_PORT` | MP3配信用server（GET `/text-mp3`）のポート番号。ngrokはこのポートだけをforwardします。`SERVER_PORT` と同じ値は設定できません | `8092` |
| `TTS_LANGUAGE` | Text-to-Speech の言語コード（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP` |
| `TTS_VOICE` | Text-to-Speech の音声名（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP-Standard-A` |
| `MP3_URL_PATH` | 生成したMP3を配信するエンドポイントのパス | `/text-mp3` |
| `NOTIFY_URL_PATH` | 通知を受け付けるエンドポイントのパス | `/google-home-notifier` |
| `MP3_OUTPUT_PATH` | 生成したMP3の出力先パス | `sample.mp3` |

#### `GOOGLE_HOME_IP`（sample runner専用）

`GOOGLE_HOME_IP` はライブラリ／共通設定としては必須ではありません。`googlehome.ip(ip)` を処理ごとに呼び出して通知先を切り替えるカスタムrunner（後述）では、この環境変数は使いません。

一方、リポジトリ直下の `main.js`（固定1台向けsample runner、後述）を利用する場合は必須です。未設定のまま `main.js` を起動するとエラーになり起動できません。

| 環境変数 | 説明 |
| --- | --- |
| `GOOGLE_HOME_IP` | Google Home のIPアドレス。`main.js`（sample runner）を利用する場合のみ必須 |

#### Google Cloud認証関連

| 環境変数 | 説明 |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントJSONのパス（ADCの標準環境変数。他のADC方式を使う場合は不要） |

### サンプルrunnerとカスタムrunner

`google-home-notifier-2.js` がコアライブラリで、通知先デバイスは `googlehome.ip(ip)` をリクエストごとに呼び出すことで、1プロセス内でも都度切り替えられます。

- リポジトリ直下の `main.js`
  - 固定1台のGoogle Home/Castデバイスにのみ通知する単純な利用例（sample runner）です。
  - `GOOGLE_HOME_IP` を必須とし、起動時にそのIPを `googlehome.ip()` へ設定します。
- `script/main.js` 等（Git管理対象外）
  - 複数デバイスへの通知先切り替えや、家庭固有のリクエスト処理などを実装するカスタムrunnerの配置場所です。
  - `script/` ディレクトリは `.gitignore` で除外されているため、利用者固有のロジックを自由に実装・保存できます。
  - `GOOGLE_HOME_IP` 環境変数は使わず、リクエスト内容に応じて `googlehome.ip(ip)` を処理ごとに呼び出してください。
  - `main.js` は「固定1台向けsample runner」専用のコードなので、`script/main.js` へコピーするだけでは動きません。以下をすべて行ってください。
    1. `require('./google-home-notifier-2')` / `require('./config')` を、1階層下の `script/` から親を指すよう `require('../google-home-notifier-2')` / `require('../config')` に書き換える。
    2. `config` の分割代入から `requireGoogleHomeIp` の import を削除する（`const { loadConfig, requireGoogleHomeIp } = require('../config')` → `const { loadConfig } = require('../config')`）。
    3. 起動時に `GOOGLE_HOME_IP` を必須として検証している `const googleHomeIp = requireGoogleHomeIp(config)` の行を削除する。
    4. リクエストハンドラ内の固定IPを設定している `googlehome.ip(googleHomeIp)` を、リクエスト内容（例: `req.body.ip` や家庭固有のルーティング条件）に応じて通知先を決める処理に置き換える。
  - `main.js` は通知用app（`createNotifyApp`）とMP3配信用app（`createMp3App`）を別ポートで起動し、ngrokはMP3配信用appだけをforwardする構成になっています。カスタムrunnerを作る場合も、この「通知POSTはngrokへ公開しない」構成を維持してください。`createNotifyApp` に渡す `googleHomeIp` を固定値ではなく、リクエストごとに解決した値に差し替える形であれば、この構成を崩さずにカスタムルーティングを実装できます。

``` sh
$ cp main.js script/main.js
# script/main.js に対して行う変更:
#   1. require('./google-home-notifier-2') → require('../google-home-notifier-2')
#      require('./config')                 → require('../config')
#   2. const { loadConfig, requireGoogleHomeIp } = require('../config')
#      → const { loadConfig } = require('../config')  (requireGoogleHomeIp は使わない)
#   3. const googleHomeIp = requireGoogleHomeIp(config) の行を削除
#   4. googlehome.ip(googleHomeIp) を、リクエストに応じて通知先IPを決める処理へ置き換える
#      (例: googlehome.ip(req.body.ip) 等)
$ node script/main.js
```

## 実行

``` sh
$ set -a && source .env && set +a
$ npm start
# または
$ node main.js
```

## systemctl

service に登録する場合は `/etc/systemd/system` に service ファイルを作ると利用できます。
`.env` を `EnvironmentFile` として渡すことで、環境変数を読み込ませることができます。
以下は参考です。

```
[Unit]
Description=google-home-notifier Server
After=syslog.target network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/home/pi/google-home-notifier/.env
ExecStart=/usr/bin/node main.js
Restart=on-failure
RestartSec=10
KillMode=process
WorkingDirectory=/home/pi/google-home-notifier

[Install]
WantedBy=multi-user.target
```

## License

MIT License. 派生元 [noelportugal/google-home-notifier](https://github.com/noelportugal/google-home-notifier) のクレジットについては [NOTICE](./NOTICE) を参照してください。
