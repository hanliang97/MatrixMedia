var express = require('express');
var indexRouter = require('./routes/index');
const path = require('path');
var app = express();
 //设置跨域访问：仅允许本机来源访问，并校验请求来源，避免管理接口(如/changeData、/publish)
 //被局域网/公网上的任意主机或跨站请求(CSRF)访问
 app.all('*',function(req,res,next) {
  const remoteAddr = (req.socket && req.socket.remoteAddress) || '';
  if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remoteAddr)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    const origin = req.headers.origin || req.headers.referer || '';
    if (!/^(file:|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(origin)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }
  res.header('Access-Control-Allow-Methods','PUT,GET,POST,DELETE,OPTIONS');
  res.header("Access-Control-Allow-Headers","X-Requested-With");
  res.header('Access-Control-Allow-Headers','Content-Type');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/', indexRouter);
app.use(express.static(path.resolve(__dirname,'./public') , {dotfiles: 'allow'})); 
app.use(function(req, res, next) {
  res.json({ error: 404 })
});
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.json({ error: err })
});

export default app
