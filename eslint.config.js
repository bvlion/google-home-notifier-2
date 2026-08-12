const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      // castv2-client 等のコールバック引数を意図的に無視する箇所があるため、
      // "_" 始まりの引数は未使用でも許容する
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest
      }
    }
  }
]
