var express = require("express");
const { changeData } = require("../utils");

var router = express.Router();

router.get("/", function (req, res) {
  res.send("<h1>MatrixMedia API</h1>");
});

router.post("/changeData", function (req, res) {
  res.send(changeData({ ...req.body }));
});

router.post("/publish", async function (req, res) {
  try {
    const { parsePublishRequest } = await import(
      "../../cli/parsePublishArgs.js"
    );
    const { runSingleFilePublish } = await import(
      "../../services/publishVideo.js"
    );

    const parsed = parsePublishRequest(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: parsed.error,
      });
    }

    if (parsed.value.dir) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "HTTP API 暂不支持批量目录发布，请使用 cli publish --dir",
      });
    }

    const result = await runSingleFilePublish(parsed.value);
    const success = result.exitCode === 0;

    return res.status(success ? 200 : result.exitCode === 2 ? 400 : 200).json({
      success,
      status: result.status || (success ? "success" : "failed"),
      exitCode: result.exitCode,
      id: result.id ?? null,
      publishAt: result.publishAt ?? null,
      scheduled: result.scheduled === true,
      message: result.message || "",
    });
  } catch (error) {
    console.error("[HTTP /publish]", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: error && error.message ? error.message : String(error),
    });
  }
});

module.exports = router;
