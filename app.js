App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloud1-d7gogubdf7a966eb3', // 比如 cloud1-xxxxxx
        traceUser: true,
      })
    }
  }
})
