import Vue from 'vue'

Vue.config.errorHandler = function (err, vm, info) {
  Vue.nextTick(() => {
    if (process.env.NODE_ENV === 'development') {
      console.group('%c >>>>>> 错误信息 >>>>>>', 'color:red')
      console.log(`%c ${info}`, 'color:blue')
      console.groupEnd()
      console.group('%c >>>>>> 发生错误的Vue 实例对象 >>>>>>', 'color:green')
      console.log(vm)
      console.groupEnd()
      console.group('%c >>>>>> 发生错误的原因及位置 >>>>>>', 'color:red')
      console.error(err)
      console.groupEnd()
    }
  })
}
