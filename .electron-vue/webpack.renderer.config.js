'use strict'

const IsWeb = process.env.BUILD_TARGET === 'web'
process.env.BABEL_ENV = IsWeb ? 'web' : 'renderer'

const path = require('path')
const { dependencies } = require('../package.json')
const webpack = require('webpack')
const config = require('../config')
const { styleLoaders } = require('./utils')

const CopyWebpackPlugin = require('copy-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')
// const ESLintPlugin = require('eslint-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader')
const { getConfig } = require("./utils")
const WindiCSSWebpackPlugin = require('windicss-webpack-plugin')

function resolve(dir) {
  return path.join(__dirname, '..', dir)
}
/**
 * List of node_modules to include in webpack bundle
 *
 * Required for specific packages like Vue UI libraries
 * that provide pure *.vue files that need compiling
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/webpack-configurations.html#white-listing-externals
 */

let rendererConfig = {
  entry: IsWeb ? { web: path.join(__dirname, '../src/renderer/main.js') } : { renderer: resolve('src/renderer/main.js') },
  infrastructureLogging: { level: 'warn' },
  stats: 'none',
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: "vue-loader",
        options: {
          babelParserPlugins: [
            'jsx',
            'classProperties',
            'decorators-legacy'
          ]
        }
      },
      {
        test: /\.jsx$/,
        loader: 'babel-loader',
      },
      {
        test: /\.html$/,
        use: 'vue-html-loader'
      },
      {
        test: /\.svg$/,
        loader: 'svg-sprite-loader',
        include: [resolve('src/renderer/icons')],
        options: {
          symbolId: 'icon-[name]'
        }
      },
      {
        test: /\.(png|jpe?g|gif)(\?.*)?$/,
        type: "asset/resource",
        generator: {
          filename: 'imgs/[name]--[hash].[ext]'
        }
      },
      {
        test: /\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/,
        type: "asset/resource",
        generator: {
          filename: 'media/[name]--[hash].[ext]'
        }
      },
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
        type: "asset/resource",
        generator: {
          filename: 'fonts/[name]--[hash].[ext]'
        }
      }
    ]
  },
  node: {
    __dirname: process.env.NODE_ENV !== 'production',
    __filename: process.env.NODE_ENV !== 'production'
  },
  plugins: [
    new WindiCSSWebpackPlugin(),
    new VueLoaderPlugin(),
    new MiniCssExtractPlugin(),
    new webpack.DefinePlugin({
      'process.env.userConfig': JSON.stringify(getConfig),
      'process.env.IS_WEB': IsWeb
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: resolve('src/index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true
      },
      templateParameters(compilation, assets, options) {
        return {
          compilation: compilation,
          webpack: compilation.getStats().toJson(),
          webpackConfig: compilation.options,
          htmlWebpackPlugin: {
            files: assets,
            options: options
          },
          process,
        };
      },
      nodeModules: false
    }),
  ],
  output: {
    filename: '[name].js',
    path: IsWeb ? path.join(__dirname, '../dist/web') : path.join(__dirname, '../dist/electron')
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      'vue$': 'vue/dist/vue.esm.js'
    },
    extensions: ['.js', '.vue', '.json', '.css', '.node']
  },
  target: IsWeb ? 'web' : 'electron-renderer'
}
// 将css相关得loader抽取出来
rendererConfig.module.rules = rendererConfig.module.rules.concat(styleLoaders({ sourceMap: process.env.NODE_ENV !== 'production' ? config.dev.cssSourceMap : false, extract: IsWeb, minifyCss: process.env.NODE_ENV === 'production' }));
(IsWeb || config.UseJsx) ? rendererConfig.module.rules.push({ test: /\.m?[jt]sx$/, use: [{ loader: 'babel-loader', options: { cacheDirectory: true } }] }) : rendererConfig.module.rules.push({ test: /\.m?[jt]s$/, loader: 'esbuild-loader', options: { loader: 'ts', } })

/**
 * Adjust rendererConfig for development settings
 */
if (process.env.NODE_ENV !== 'production' && !IsWeb) {
  rendererConfig.plugins.push(
    new webpack.DefinePlugin({
      __lib: `"${path.join(__dirname, `../${config.DllFolder}`).replace(/\\/g, '\\\\')}"`
    })
  )
}

/**
 * Adjust rendererConfig for production settings
 */
if (process.env.NODE_ENV === 'production') {

  rendererConfig.plugins.push(
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, '../static'),
          to: path.join(__dirname, '../dist/electron/static'),
          globOptions: {
            ignore: ['.*']
          }
        }
      ]
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': '"production"',
    }),
    new webpack.LoaderOptionsPlugin({
      minimize: true
    })
  )
  rendererConfig.optimization = {
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
  rendererConfig.optimization.splitChunks = {
    chunks: "async",
    cacheGroups: {
      vendor: { // 将第三方模块提取出来
        minSize: 30000,
        minChunks: 1,
        test: /node_modules/,
        chunks: 'initial',
        name: 'vendor',
        priority: 1
      },
      commons: {
        test: /[\\/]src[\\/]common[\\/]/,
        name: 'commons',
        minSize: 30000,
        minChunks: 3,
        chunks: 'initial',
        priority: -1,
        reuseExistingChunk: true // 这个配置允许我们使用已经存在的代码块
      }
    }
  }
  rendererConfig.optimization.runtimeChunk = { name: 'runtime' }
} else {
  rendererConfig.devtool = 'eval-source-map'
  // eslint
  // rendererConfig.plugins.push(new ESLintPlugin(config.dev.ESLintoptions))
}

module.exports = rendererConfig
