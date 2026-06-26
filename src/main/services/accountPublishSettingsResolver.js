"use strict";

import { changeData } from "../server/utils";
import {
  resolveEffectivePublishMode,
  isDefaultPublishToDraftEnabled,
} from "../../shared/accountPublishSettings.js";

function normalizePhone(value) {
  return String(value || "").split("-")[0];
}

/**
 * 从账号数据文件夹里查匹配 phone + pt 的账号记录
 * @param {{ phone?: string, pt?: string }} query
 * @returns {{ defaultPublishToDraft: boolean } | null}
 */
export function findAccountPublishSettings({ phone, pt } = {}) {
  const targetPhone = normalizePhone(phone);
  const targetPt = String(pt || "");
  if (!targetPhone || !targetPt) return null;

  try {
    const result = changeData({
      fileName: "account",
      type: "get",
      item: { page: 1, pageSize: 9999 },
    });
    const data = (result && result.data) || {};
    const dateKeys = Object.keys(data).sort((a, b) =>
      String(b).localeCompare(String(a))
    );
    for (const dateKey of dateKeys) {
      const rows = data[dateKey] || [];
      for (const row of rows) {
        if (
          row &&
          normalizePhone(row.phone) === targetPhone &&
          String(row.pt || "") === targetPt
        ) {
          return {
            defaultPublishToDraft: isDefaultPublishToDraftEnabled(row),
          };
        }
      }
    }
  } catch (e) {
    console.warn(
      "[accountPublishSettingsResolver] 查询账号发布设置失败:",
      e && e.message
    );
  }
  return null;
}

/**
 * 结合「请求显式 draft」+「账号 defaultPublishToDraft」算出最终发布模式
 * @param {{ phone?: string, pt?: string, requestDraftMode?: boolean }} query
 * @returns {{ publishMode: "publish"|"draft", publishToDraft: boolean }}
 */
export function resolveAccountPublishMode({
  phone,
  pt,
  requestDraftMode = false,
} = {}) {
  const settings = findAccountPublishSettings({ phone, pt }) || {};
  return resolveEffectivePublishMode(requestDraftMode, settings);
}
