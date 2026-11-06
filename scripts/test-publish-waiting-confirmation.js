"use strict";

// 回归：扫码进度不能结算成功、重复建记录或结束 CLI；调度和 GUI 使用同一结果语义。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");
const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache/waiting-confirmation");
fs.mkdirSync(cache, { recursive: true });
const state = { records: [], tasks: [], updates: [] };
global.__waitingHarness = state;
const stubs = {
  electron: 'exports.ipcMain = { on() {} };',
  './puppeteerFile': 'exports.runPuppeteerTask = (task, transport) => global.__waitingHarness.tasks.push({ task, transport });',
  '../server/utils': `exports.changeData = ({type, item}) => {
    const h = global.__waitingHarness;
    if (type === 'add') { h.records.push({...item, id: 'record-' + h.records.length}); return {success:true, data:h.records}; }
    if (type === 'update') { h.updates.push(item); Object.assign(h.records.find(r => r.id === item.id) || {}, item); }
    return {data:{today:h.records}};
  };`,
  './accountPublishSettingsResolver.js': 'exports.resolveAccountPublishMode = ({requestDraftMode}) => requestDraftMode ? "draft" : "publish";',
};
(async () => {
  await build({ entryPoints: ['publishVideo', 'scheduledPublish'].map(n => path.join(root, 'src/main/services/' + n + '.js')),
    bundle:true, platform:'node', format:'cjs', outdir:cache,
    plugins:[{name:'waiting-boundaries', setup(b) {
      b.onResolve({filter:/.*/}, a => stubs[a.path] ? {path:a.path, namespace:'stub'} : null);
      b.onLoad({filter:/.*/, namespace:'stub'}, a => ({contents:stubs[a.path], loader:'js'}));
    }}] });
  await build({ entryPoints:[path.join(root, 'src/shared/publishResult.js')], bundle:true, platform:'node', format:'cjs', outfile:path.join(cache, 'result.cjs') });
  const { resolvePublishCompletion } = require(path.join(cache,'result.cjs'));
  for (const [payload, recordStatus] of [
    [{status:true, needsAttention:true, outcome:'waiting_confirmation'}, 'waiting_confirmation'],
    [{status:true, needsAttention:true, outcome:'publish_unverified'}, 'abnormal'],
    [{status:true, pt:'公众号', publishVerified:false}, 'abnormal'],
    [{status:true, pt:'微信公众号', publishVerified:false}, 'abnormal'],
  ]) {
    const result = resolvePublishCompletion(payload);
    assert.strictEqual(result.status, 'needs_attention');
    assert.strictEqual(result.recordStatus, recordStatus);
    assert.strictEqual(result.exitCode, 4);
    assert.strictEqual(result.savedAsDraft, false);
  }
  assert.strictEqual(resolvePublishCompletion({status:true, pt:'公众号', publishVerified:true}).status, 'success');
  assert.match(resolvePublishCompletion({status:true, outcome:'waiting_confirmation'}).message, /等待|确认/);
  const { runSingleFilePublish } = require(path.join(cache,'publishVideo.js'));
  const events = [];
  let completed = false;
  const resultPromise = runSingleFilePublish({platform:'抖音', file:__filename, title:'视频', phone:'test'},
    {sourceFile:__filename, resolvedFile:__filename}, {onProgress:p => events.push(p)}).then(r => { completed = true; return r; });
  await new Promise(resolve => setImmediate(resolve));
  const {task, transport} = state.tasks.pop();
  transport.reply('puppeteerFile-progress', {...task, taskId:'another', phase:'waiting_confirmation'});
  assert.strictEqual(state.records[0].publishStatus, 'publishing');
  transport.reply('puppeteerFile-progress', {...task, phase:'waiting_confirmation', waitingConfirmation:true, message:'请扫码确认'});
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(completed, false);
  assert.strictEqual(state.records.length, 1);
  assert.strictEqual(state.records[0].publishStatus, 'waiting_confirmation');
  assert.strictEqual(state.records[0].publishSuccessCount, 0);
  assert.strictEqual(events[0].phase, 'waiting_confirmation');
  transport.reply('puppeteerFile-progress', {...task, phase:'verifying', waitingConfirmation:false});
  assert.strictEqual(state.records[0].publishStatus, 'publishing');
  transport.reply('puppeteerFile-done', {...task, status:true, needsAttention:true, outcome:'waiting_confirmation'});
  const result = await resultPromise;
  assert.strictEqual(result.status, 'needs_attention');
  assert.strictEqual(result.needsAttention, true);
  assert.strictEqual(state.records[0].publishStatus, 'waiting_confirmation');
  assert.strictEqual(state.records[0].publishSuccessCount, 0);

  const { schedulePublishRecord, stopScheduledPublishScheduler } = require(path.join(cache,'scheduledPublish.js'));
  for (const payload of [{status:true, publishMode:'draft', draftVerified:true}, {status:true, outcome:'waiting_confirmation', needsAttention:true}]) {
    const record = {id:'schedule', date:'2026-11-02', pt:'抖音', textType:'local', filePath:__filename, publishStatus:'scheduled', scheduledPublishAt:Date.now()+5};
    state.records.push(record);
    schedulePublishRecord(record);
    await new Promise(resolve => setTimeout(resolve, 20));
    const scheduled = state.tasks.pop();
    scheduled.transport.reply('puppeteerFile-progress', {...scheduled.task, phase:'waiting_confirmation'});
    assert.strictEqual(record.publishStatus, 'waiting_confirmation');
    scheduled.transport.reply('puppeteerFile-done', {...scheduled.task, ...payload});
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(record.publishStatus, payload.publishMode === 'draft' ? 'draft' : 'waiting_confirmation');
    state.records.pop();
  }
  stopScheduledPublishScheduler();
  console.log('test-publish-waiting-confirmation: 全部断言通过');
})().catch(e => { console.error(e); process.exit(1); });
