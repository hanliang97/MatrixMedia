import { dy, bjh, blbl, sph, tt, ks } from "./upLoad";
import zt from "./zt";


export default {
  // 上传
  抖音: dy,
  百家号: bjh,
  哔哩哔哩: blbl,
  视频号: sph,
  头条: tt,
  快手: ks,
  // 获取发布状态
  抖音状态: zt.dy,
  百家号状态: zt.bjh,
  哔哩哔哩状态: zt.blbl,
  视频号状态: zt.sph,
  头条状态: zt.tt,
  快手状态: zt.ks,
};