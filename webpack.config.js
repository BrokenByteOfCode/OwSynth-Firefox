const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env) => {
  const isDebug = env && (env.debug === 'true' || env.debug === true);

  console.log('Building for Firefox');
  console.log(`Debug mode: ${isDebug}`);

  const copyPatterns = [
    { from: 'manifest.json', to: 'manifest.json' },
    { from: 'popup.html', to: 'popup.html' },
    { from: 'player.html', to: 'player.html' },
    { from: 'player.css', to: 'player.css' },
    { from: 'settings.html', to: 'settings.html' },
    { from: 'icons', to: 'icons', noErrorOnMissing: true },
    { from: 'default.sf2', to: 'default.sf2', noErrorOnMissing: true }
  ];

  if (isDebug) {
    copyPatterns.push({ from: 'debug.log', to: 'debug.log', noErrorOnMissing: true });
  }

  return {
    entry: {
      content: './src/content.ts',
      popup: './src/popup.ts',
      player: './src/player.ts',
      settings: './src/settings.ts',
      processor: './src/processor.ts',
      background: './src/background.ts'
    },
    optimization: {
      minimize: !isDebug,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: !isDebug,
              passes: 2
            },
            mangle: false,
            format: {
              comments: false,
              beautify: true
            },
            keep_classnames: true,
            keep_fnames: true
          },
          extractComments: false,
        }),
      ],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'dist')
    },
    plugins: [
      new CopyPlugin({
        patterns: copyPatterns
      })
    ]
  };
};