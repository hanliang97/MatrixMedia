/* eslint-disable no-return-assign */
/**
 * 计时器
 * 支持链式调用
 * timeout()
 *  .then(()=>{
 *     return inTheEnd();
 *   })
 *  .then(()=>{
 *      return inTheEnd();
 *   });
 *
 * @date 2019-11-25
 */
class Timer {
  /**
     * 延时操作
     * @returns {void}
     * @date 2019-11-25
     */
  timeout (interval, args) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(args)
      }, interval)
    })
  }

  /**
     * 等待代码片段执行完毕后再执行
     * @returns {void}
     * @date 2019-11-25
     */
  inTheEnd () {
    return this.timeout(0)
  }

  /**
     * 循环定时, 执行回调后再继续下一轮循环
     * @param {Number} interval 执行间隔
     * @param {Function} [callback] 回调
     * @returns {Object}
     * @date 2019-11-25
     */
  interval (interval, callback) {
    this.timeout(interval)
      .then(() => {
        typeof callback === 'function' &&
          callback() !== false &&
          this.interval(interval, callback)
      })
    return { then: c => callback = c }
  }

  /**
     * 计时，单位毫秒
     * @returns {void}
     * @date 2019-11-29
     */
  start () {
    const startDate = new Date()
    return {
      stop () {
        const stopDate = new Date()
        return stopDate.getTime() - startDate.getTime()
      }
    }
  }
}

export default new Timer()
