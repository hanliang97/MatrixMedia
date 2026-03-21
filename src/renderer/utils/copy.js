import { Message } from "element-ui";
export default (text) => {
  if(!text){
    console.log("复制失败,内容为空");
    return;
  }
  if (document.execCommand) {
    // IE浏览器
    var textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      var successful = document.execCommand("copy");
      if (successful) {
       Message.success("复制成功");
      } else {
        Message.error("复制失败");
      }
    } catch (err) {
      Message.error("复制失败: " + err.message);
    }
    document.body.removeChild(textarea);
  } else {
    // 现代浏览器
    navigator.clipboard
      .writeText(text)
      .then(() => {
        Message.success("复制成功");
      })
      .catch(error => {
        Message.error("复制失败: " + error.message);
      });
  }
}
