'use strict'

process.env.BABEL_ENV = 'main'

const path = require('path')
const { dependencies } = require('../package.json')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')
const config = require('../config')
const { getConfig } = require("./utils")

function resolve(dir) {
  return path.join(__dirname, '..', dir)
}

let mainConfig = {
  infrastructureLogging: {
    level: 'warn'
  },
  entry: {
    main: path.join(__dirname, '../src/main/index.js')
  },
  externals: [
    ...Object.keys(dependencies || {})
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'esbuild-loader'
      },
      {
        test: /\.node$/,
        use: 'node-loader'
      }
    ]
  },
  node: {
    __dirname: process.env.NODE_ENV !== 'production',
    __filename: process.env.NODE_ENV !== 'production'
  },
  output: {
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    path: path.join(__dirname, '../dist/electron')
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.userConfig':JSON.stringify(getConfig)
    })
  ],
  resolve: {
    alias: {
      '@config': resolve('config'),
    },
    extensions: ['.js', '.json', '.node']
  },
  target: 'electron-main',
}

/**
 * Adjust mainConfig for development settings
 */
if (process.env.NODE_ENV !== 'production') {
  mainConfig.plugins.push(
    new webpack.DefinePlugin({
      '__static': `"${path.join(__dirname, '../static').replace(/\\/g, '\\\\')}"`,
      'process.env.libPath': `"${path.join(__dirname, `../${config.DllFolder}`).replace(/\\/g, '\\\\')}"`
    })
  )
}

/**
 * Adjust mainConfig for production settings
 */
if (process.env.NODE_ENV === 'production' && config.build.cleanConsole) {
  mainConfig.optimization = {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ["console.log", "console.warn"]
          }
        }

      })
    ]
  }
  mainConfig.plugins.push(
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': '"production"'
    })
  )
}

module.exports = mainConfig
