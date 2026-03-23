const https = require('https')
const path = require('path')
const package = require('./package.json')
const fs = require('fs')
const FormData = require('form-data')
const agent = new https.Agent({
  rejectUnauthorized: false // 仅测试环境使用
})
// 获取命令行参数
const args = process.argv.slice(2)
let access_token = args[0]
let name = args[1]
let owner = 'gzlingyi_0'
let repo = 'pubtw'
let target_commitish = 'main'
let baseUrl = 'gitee.com'
// 创建仓release post
let createReleaseApi = `/api/v5/repos/${owner}/${repo}/releases`
let pushBody = {
  access_token,
  tag_name: 'v' + name,
  tag: 'v' + name,
  name: 'v' + name,
  body: 'Release for ' + name,
  target_commitish
}

// 如果 Releases 超过五个，删除最旧的 Release
deleteOldestRelease()
// 发布
createRelease()

/** 额外文件路径：node upload-gitee.js <token> <version> [file ...]（仅上传 .exe / .dmg） */
function resolveUploadPaths() {
  const extra = args.slice(2).filter(a => a && a !== '--')
  if (extra.length > 0) {
    return extra
      .map(f => path.resolve(f))
      .filter(fp => /\.(exe|dmg)$/i.test(fp))
  }
  const buildDir = path.join(__dirname, 'build')
  const raw = path.join(
    buildDir,
    package.build.productName + ' Setup ' + name + '.exe'
  )
  const renamed = path.join(buildDir, 'Setup ' + name + '.exe')
  fs.renameSync(raw, renamed)
  return [renamed]
}

function uploadSingleFile(releaseId, filePath) {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('access_token', access_token)
    formData.append('file', fs.createReadStream(filePath))

    const options = {
      hostname: baseUrl,
      path: createReleaseApi + `/${releaseId}/attach_files`,
      method: 'POST',
      agent,
      headers: {
        ...formData.getHeaders(),
        'User-Agent': 'Node.js'
      }
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log('文件上传成功:', filePath)
          resolve()
        } else {
          reject(new Error(`文件上传失败 ${res.statusCode}: ${data}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(1000 * 60 * 20, () => {
      req.destroy(new Error('Upload timeout: 20 minutes exceeded'))
      reject(new Error('上传超时'))
    })
    formData.pipe(req)
  })
}

async function uploadAllFiles(releaseId) {
  let paths
  try {
    paths = resolveUploadPaths()
  } catch (e) {
    console.error('准备上传文件失败:', e.message)
    throw e
  }
  for (const fp of paths) {
    if (!fs.existsSync(fp)) {
      console.error('文件不存在，跳过:', fp)
      continue
    }
    console.log('开始上传', fp)
    await uploadSingleFile(releaseId, fp)
  }
}

// 创建标签
function createRelease() {
  const options = {
    hostname: baseUrl,
    path: createReleaseApi,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
      // 可能还需要其他标头，比如授权信息
    },
    body: JSON.stringify(pushBody)
  }
  let data = ''
  const req = https.request(options, res => {
    // 捕获数据流
    res.on('data', chunk => {
      data += chunk
    })
    // 在数据流结束时处理数据
    res.on('end', () => {
      if (res.statusCode === 201) {
        console.log('创建仓库成功', JSON.parse(data).id)
        uploadAllFiles(JSON.parse(data).id).catch(err => {
          console.error('上传附件失败:', err.message || err)
          process.exitCode = 1
        })
      } else {
        console.error('创建失败:', res.statusCode, data, options)
        if (data.indexOf('该标签已经存在发行版') != -1) {
          // 通过tag_name 获取release_id
          tgaGetRelease(releaseData => {
            console.log('获取release_id', releaseData.id)
            uploadAllFiles(releaseData.id).catch(err => {
              console.error('上传附件失败:', err.message || err)
              process.exitCode = 1
            })
          })
        }
      }
    })
  })
  req.on('error', error => {
    console.error('创建失败:', error)
  })
  req.write(JSON.stringify(pushBody))
  req.end()
}

// 标签获取
function tgaGetRelease(callback) {
  const options = {
    hostname: baseUrl,
    path:
      createReleaseApi +
      '/tags/' +
      pushBody.tag +
      '?access_token=' +
      access_token,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
      // 可能还需要其他标头，比如授权信息
    }
  }
  let data = ''
  console.log('标签获取', options)
  const req = https.request(options, res => {
    let data = ''

    res.on('data', chunk => {
      data += chunk
    })

    res.on('end', () => {
      callback(JSON.parse(data))
    })
  })

  req.on('error', error => {
    console.error('Error fetching releases:', error)
  })

  req.end()
}

// 获取所有 Releases
function getAllReleases(callback) {
  const options = {
    hostname: baseUrl,
    path:
      createReleaseApi + '?page=1&per_page=100&access_token=' + access_token,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
      // 可能还需要其他标头，比如授权信息
    }
  }

  const req = https.request(options, res => {
    let data = ''

    res.on('data', chunk => {
      data += chunk
    })

    res.on('end', () => {
      callback(JSON.parse(data))
    })
  })

  req.on('error', error => {
    console.error('Error fetching releases:', error)
  })

  req.end()
}
// 删除最旧的 Release
function deleteOldestRelease() {
  getAllReleases(releases => {
    console.log(releases)
    if (releases.length >= 5) {
      // 找到最旧的 Release
      const oldestRelease = releases[0]
      // 删除最旧的 Release
      const options = {
        hostname: baseUrl,
        path:
          createReleaseApi +
          `/${oldestRelease.id}?access_token=${access_token}`,
        method: 'DELETE'
      }
      const req = https.request(options, res => {
        if (res.statusCode === 204) {
          console.log('删除成功')
        } else {
          console.error('Error deleting release:', res.statusCode)
        }
      })
      req.on('error', error => {
        console.error('Error deleting release:', error)
      })
      req.end()
    } else {
      console.log('不需要删除')
    }
  })
}
