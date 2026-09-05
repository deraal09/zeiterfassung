// ESLint-Konfiguration (Flat Config, ESLint 9).
//
// Bewusst schlank gehalten: die Regeln sollen Fehler finden, die beim Lesen
// leicht durchrutschen (vergessene Variablen, versehentliche Zuweisungen in
// Bedingungen), und nicht den Stil vorschreiben - der Code ist einheitlich
// und ein Formatierungsstreit hilft hier niemandem.
const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['node_modules/**', 'data/**'],
  },
  js.configs.recommended,
  {
    // Server-seitiger Code laeuft unter Node (CommonJS).
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      // Ein gefangener, absichtlich ignorierter Fehler ist hier ein
      // wiederkehrendes Muster (etwa beim Aufraeumen einer LDAP-Verbindung).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Die Dateien unter public/js laufen im Browser, nicht unter Node.
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Date: 'readonly',
      },
    },
  },
];
