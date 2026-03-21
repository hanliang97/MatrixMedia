'use strict'
process.env.NODE_ENV = 'production'
const { say } = require('cfonts')
const chalk = require('chalk')
const del = require('del')
const webpack = require('webpack')
const { Listr } = require('listr2')


const mainConfig = require('./webpack.main.config')
const rendererConfig = require('./webpack.renderer.config')

const doneLog = chalk.bgGreen.white(' DONE ') + ' '
const errorLog = chalk.bgRed.white(' ERROR ') + ' '
const okayLog = chalk.bgBlue.white(' OKAY ') + ' '
const isCI = process.env.CI || false

if (process.env.BUILD_TARGET === 'web') web()
else build()

function clean() {
  del.sync(['dist/electron/*', 'build/*', '!build/icons', '!build/lib', '!build/lib/electron-build.*', '!build/icons/icon.*'])
  console.log(`\n${doneLog}clear done`)
  if (process.env.BUILD_TARGET === 'onlyClean') process.exit()
}

function build() {
  greeting()
  if (process.env.BUILD_TARGET === 'clean' || process.env.BUILD_TARGET === 'onlyClean') clean()
  const tasksLister = new Listr([
    {
      title: 'building main process',
      task: async (_, tasks) => {
        try {
          await pack(mainConfig)
        } catch (error) {
          console.error(`\n${error}\n`)
          console.log(`\n  ${errorLog}failed to build main process`)
          process.exit(1)
        }
      }
    },
    {
      title: "building renderer process",
      task: async (_, tasks) => {
        try {
          await pack(rendererConfig)
          tasks.output = `${okayLog}take it away ${chalk.yellow('`electron-builder`')}\n`
        } catch (error) {
          console.error(`\n${error}\n`)
          console.log(`\n  ${errorLog}failed to build renderer process`)
          process.exit(1)
        }
      },
      options: { persistentOutput: true }
    }
  ], {
    exitOnError: true
  })
  tasksLister.run()
}

function pack(config) {
  return new Promise((resolve, reject) => {
    config.mode = 'production'
    webpack(config, (err, stats) => {
      if (err) reject(err.stack || err)
      else if (stats.hasErrors()) {
        let err = ''

        stats.toString({
          chunks: false,
          colors: true
        })
          .split(/\r?\n/)
          .forEach(line => {
            err += `    ${line}\n`
          })

        reject(err)
      } else {
        resolve(stats.toString({
          chunks: false,
          colors: true
        }))
      }
    })
  })
}

function web() {
  del.sync(['dist/web/*', '!.gitkeep'])
  rendererConfig.mode = 'production'
  webpack(rendererConfig, (err, stats) => {
    if (err || stats.hasErrors()) console.log(err)

    console.log(stats.toString({
      chunks: false,
      colors: true
    }))

    process.exit()
  })
}

function greeting() {
  const cols = process.stdout.columns
  let text = ''

  if (cols > 85) text = `let's-build`
  else if (cols > 60) text = `let's-|build`
  else text = false

  if (text && !isCI) {
    say(text, {
      colors: ['yellow'],
      font: 'simple3d',
      space: false
    })
  } else console.log(chalk.yellow.bold(`\n  let's-build`))
  console.log()
}