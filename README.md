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
| `GOOGLE_HOME_IP` | Google Home のIPアドレス |
| `NGROK_AUTHTOKEN` | ngrok の authtoken |
| `NOTIFY_AUTH_TOKEN` | 通知用POSTエンドポイントの認証に使う共有シークレット（後述） |

#### 任意（省略時はデフォルト値を使用）

| 環境変数 | 説明 | デフォルト値 |
| --- | --- | --- |
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

## 実行

``` sh
$ set -a && source .env && set +a
$ npm start
# または
$ node main.js
```

## 通知用エンドポイントの認証

ngrok 等でこのサーバーを外部公開すると、通知用エンドポイントのURLを知る第三者が任意の通知を実行できてしまいます。これを防ぐため、通知を受け付けるPOSTエンドポイント（`NOTIFY_URL_PATH`）は、`NOTIFY_AUTH_TOKEN` に設定した値による Bearer Token 認証を必須とします。

- `NOTIFY_AUTH_TOKEN` はデフォルト値を持たない必須設定です。未設定のままではサーバーを起動できません（安全側に倒れるデフォルト）。
- リクエストには `Authorization: Bearer <NOTIFY_AUTH_TOKENの値>` ヘッダーを付与してください。
- ヘッダーがない、Bearer形式でない、値が不正な場合はいずれも `401` を返し、通知処理は実行されません。

``` sh
$ curl -X POST \
  -H "Authorization: Bearer $NOTIFY_AUTH_TOKEN" \
  -d "text=こんにちは" \
  http://localhost:8091/google-home-notifier
```

> [!WARNING]
> ngrok 等で外部公開する場合、`NOTIFY_AUTH_TOKEN` を設定せずに通知用POSTエンドポイントを公開しないでください。第三者が無認証で通知を実行できてしまいます。

一方、生成したMP3を配信するGETエンドポイント（`MP3_URL_PATH`）はGoogle Homeデバイス自身がngrok URL経由で直接取得するものであり、デバイス側からAuthorizationヘッダーを付与できません。そのため、このGETエンドポイントは今回の認証対象外です。

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
