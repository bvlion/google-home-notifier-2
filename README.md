# google-home-notifier-2

[google-home-notifier](https://github.com/noelportugal/google-home-notifier) の `google-tts-api` を `@google-cloud/text-to-speech` に変更したもので、Google Home に音声ファイルを再生させます。

## インストール

``` sh
$ git clone https://github.com/bvlion/google-home-notifier-2
$ cd google-home-notifier-2
$ npm install
```

## セットアップ

### node や依存ライブラリ

```
$ sudo apt-get install -y nodejs npm git-core libnss-mdns libavahi-compat-libdnssd-dev
$ sudo npm cache clean
$ sudo npm install npm n -g
$ sudo n lts
```

### Text-to-Speech

Cloud Text-to-Speech API を有効にし、サービスアカウントキーを発行後、環境変数 `GOOGLE_APPLICATION_CREDENTIALS` を設定します。

``` sh
$ export GOOGLE_APPLICATION_CREDENTIALS=/path/to/dir/target.json
```

[Google ドキュメント](https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries)

### sample.js を修正

以下を環境に合わせて設定します。

- const serverPort = 8091
- const language = 'ja-JP'
- const voice = 'ja-JP-Standard-A'
- const mp3Url = '/text-mp3'
- const notifyUrl = '/google-home-notifier'
- const mp3OutputPath = 'sample.mp3'
- const ip = '192.168.11.100'

[音声の参考](https://cloud.google.com/text-to-speech/docs/voices)

## 実行

``` sh
$ node sample.js
```