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

### 環境変数

ソースコードを直接編集する必要はありません。以下の環境変数で設定します。

`.env.example` をコピーして `.env` を作成し、値を設定してください。

``` sh
$ cp .env.example .env
```

`.env` はアプリが自動読み込みするものではありません。実行前にシェルや systemd などから環境変数として渡してください（後述）。

#### 必須

| 環境変数 | 説明 |
| --- | --- |
| `NGROK_AUTHTOKEN` | ngrok の authtoken |

#### 任意（省略時はデフォルト値を使用）

| 環境変数 | 説明 | デフォルト値 |
| --- | --- | --- |
| `GOOGLE_HOME_IP` | Google Home のIPアドレス。リポジトリ直下の `main.js`（固定1台向けサンプルrunner）でのみ使用（後述） | 未設定（設定しない場合の挙動は後述） |
| `SERVER_PORT` | サーバーのポート番号 | `8091` |
| `TTS_LANGUAGE` | Text-to-Speech の言語コード（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP` |
| `TTS_VOICE` | Text-to-Speech の音声名（[参考](https://cloud.google.com/text-to-speech/docs/voices)） | `ja-JP-Standard-A` |
| `MP3_URL_PATH` | 生成したMP3を配信するエンドポイントのパス | `/text-mp3` |
| `NOTIFY_URL_PATH` | 通知を受け付けるエンドポイントのパス | `/google-home-notifier` |
| `MP3_OUTPUT_PATH` | 生成したMP3の出力先パス | `sample.mp3` |

#### Google Cloud認証関連

| 環境変数 | 説明 |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントJSONのパス（ADCの標準環境変数。他のADC方式を使う場合は不要） |

### サンプルrunnerとカスタムrunner

`google-home-notifier-2.js` がコアライブラリで、通知先デバイスは `googlehome.ip(ip)` をリクエストごとに呼び出すことで、1プロセス内でも都度切り替えられます。

- リポジトリ直下の `main.js`
  - 固定1台のGoogle Home/Castデバイスにのみ通知する単純な利用例（sample runner）です。
  - `GOOGLE_HOME_IP` を設定した場合のみ、そのIPへ固定で通知します。設定しない場合は `googlehome.ip()` を呼び出さないため、mDNSディスカバリでのデバイス検出に委ねられます。
- `script/main.js` 等（Git管理対象外）
  - 複数デバイスへの通知先切り替えや、家庭固有のリクエスト処理などを実装するカスタムrunnerの配置場所です。
  - `script/` ディレクトリは `.gitignore` で除外されているため、リクエスト内容に応じて `googlehome.ip(ip)` を呼び出すなど、利用者固有のロジックを自由に実装・保存できます。
  - `main.js` をコピーして必要な処理を追加する形で作成できます。

``` sh
$ cp main.js script/main.js
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
