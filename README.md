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

### Text-to-Speech

1. Cloud Text-to-Speech API を有効にしサービスアカウントキーを発行
1. json をダウンロードして `target.json` にファイル名を変更
1. script フォルダに配置

> [!TIP]
> [Google ドキュメント](https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries)

### Ngrok

Ngrok で [auth key](https://dashboard.ngrok.com/get-started/your-authtoken) を発行します。


### sample.js を修正

main.js を script フォルダにコピーして、以下を環境に合わせて設定します。（必要に応じてご自身のコードを git 管理いただけます）

- const serverPort = 8091
- const language = 'ja-JP'
- const voice = 'ja-JP-Standard-A'
- const mp3Url = '/text-mp3'
- const notifyUrl = '/google-home-notifier'
- const mp3OutputPath = 'sample.mp3'
- const ip = '192.168.11.100'
- const ngrokToken = 'token'

> [!TIP]
> [音声の参考](https://cloud.google.com/text-to-speech/docs/voices)

## 実行

``` sh
$ node script/main.js
```

## systemctl

service に登録する場合は `/etc/systemd/system` に service ファイルを作ると利用できます。
以下は参考です。

```
[Unit]
Description=google-home-notifier Server
After=syslog.target network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/node script/main.js
Restart=on-failure
RestartSec=10
KillMode=process
WorkingDirectory=/home/pi/google-home-notifier

[Install]
WantedBy=multi-user.target
```
