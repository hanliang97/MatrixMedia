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
    const { parseMultiPublishRequest } = await import(
      "../../cli/parsePublishArgs.js"
    );
    const publishService = await import("../../services/publishVideo.js");

    const parsed = parseMultiPublishRequest(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: parsed.error,
      });
    }

    const result = parsed.multi
      ? await publishService.runMultiPlatformPublish(parsed.value)
      : await publishService.runSingleFilePublish(parsed.value);

    const success = result.success === true || result.exitCode === 0;
    const httpStatus =
      result.exitCode === 2 && !parsed.multi ? 400 : success ? 200 : 200;

    return res.status(httpStatus).json(result);
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
