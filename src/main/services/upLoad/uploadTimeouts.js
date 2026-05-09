"use strict";

/**
 * 弱网 / 大文件场景：等待页面出现「上传完成、可继续编辑/发布」等状态的上限。
 * 例如约 2GB @ ~700KB/s 传输约 50 分钟，另预留转码与接口耗时，故用 3 小时档。
 */
export const WAIT_UPLOAD_PROCESSING_MS = 3 * 60 * 60 * 1000;

/**
 * 发布用 BrowserWindow 兜底自动关闭：必须大于弱网下大文件上传所需时间，
 * 否则定时关窗会中断仍在进行的浏览器上传。
 */
export const UPLOAD_WINDOW_AUTO_CLOSE_MS = 4 * 60 * 60 * 1000;

/** CLI `publish` 等待 puppeteerFile-done 的上限，需覆盖弱网下大文件上传 */
export const CLI_PUBLISH_TIMEOUT_MS = 4 * 60 * 60 * 1000;
