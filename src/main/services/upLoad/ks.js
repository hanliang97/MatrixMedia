import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_UPLOAD_PROCESSING_MS } from "./uploadTimeouts.js";

export default async function (page, data, window,event) {

  console.log(data);
  try {
    let sel = '#joyride-wrapper input[type="file"]';
    await page.waitForSelector(sel, { timeout: 5000 });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = "#work-description-edit";
    await page.waitForSelector(selector, { timeout: 1000 });
    const input = await page.$(selector);
    await input.click();
    await page.keyboard.type(data.data.bt1 + " " + data.data.bq, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }
  try {
    await page.click(".ant-checkbox-group>label:nth-of-type(2)", { delay: 200 });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }
  try {
    await page.waitForSelector("#preview-tours video", { timeout: WAIT_UPLOAD_PROCESSING_MS });
    await page.waitForFunction(
      () => {
        const bar = document.querySelector("#setting-tours + div");
        if (!bar || bar.offsetParent === null) return false;
        for (const row of bar.querySelectorAll(":scope > div")) {
          const t = row.textContent.replace(/\s+/g, "").trim();
          if (t === "发布") return true;
        }
        return false;
      },
      { timeout: 10000 }
    );
    // 快手发布按钮点击：原先用 page.evaluateHandle 返回行级 div 再 puppeteer click，
    // 在 hidden window 下几何中心常落不到真正的 <button> 上，结果是"看起来点过了但没发"。
    // 改为在 evaluate 内部遍历真实 button / 行 div，直接调 DOM .click()，避开鼠标几何问题。
    const clicked = await page.evaluate(() => {
      const norm = t => String(t || "").replace(/\s+/g, "").trim();
      const bar = document.querySelector("#setting-tours + div");
      if (!bar) return { ok: false, reason: "no-bar" };
      for (const btn of bar.querySelectorAll("button")) {
        if (norm(btn.textContent) === "发布" && !btn.disabled) {
          btn.click();
          return { ok: true, via: "button" };
        }
      }
      for (const row of bar.querySelectorAll(":scope > div")) {
        if (norm(row.textContent) === "发布") {
          const inner = row.querySelector("button,[role='button']");
          if (inner) {
            inner.click();
            return { ok: true, via: "row>inner" };
          }
          row.click();
          return { ok: true, via: "row" };
        }
      }
      return { ok: false, reason: "no-match" };
    });
    if (!clicked || !clicked.ok) {
      throw new Error(`未找到发布按钮(${clicked && clicked.reason})`);
    }
    console.log(`✅ 快手视频已触发发布，click via=${clicked.via}`);
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    console.error("❌ 发布失败", e);
  }
}
