var express = require('express');
const { changeData} = require('../utils');
var router = express.Router();


/* GET home page. */
router.get('/', function(req, res, next) {
  res.send('<h1>Express</h1>'); 
});


/* GET home page. */
router.post('/changeData', function(req, res) {
  res.send(changeData({...req.body})); 
});



module.exports = router;
