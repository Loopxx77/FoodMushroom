const STORAGE_KEY = 'guli_feed_history_v1';

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    wantText: '', actualText: '', calDiff: 0, totalExp: 0,
    result: '', history: [], feedCount: 0, submitting: false,
    storageReady: false, managingHistory: false
  },

  onLoad() {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      const history = saved === '' ? [] : saved;
      if (!Array.isArray(history) || history.some(item =>
        !item || typeof item.calDiff !== 'number' || !Number.isFinite(item.calDiff) ||
        typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp) ||
        !Number.isFinite(new Date(item.timestamp).getTime()) ||
        typeof item.wantFood !== 'string' || typeof item.realFood !== 'string' ||
        (item.credited !== undefined && (typeof item.credited !== 'number' || !Number.isFinite(item.credited))))) {
        throw new Error('Invalid history');
      }
      this.updateHistory(history);
      this.setData({ storageReady: true });
    } catch (error) {
      wx.showModal({ title: '历史记录读取失败', content: '请重新打开小程序后再试，避免覆盖已有记录。', showCancel: false });
    }
  },

  updateHistory(history) {
    this.setData({
      history: history.map(item => ({ ...item, credited: item.credited === undefined ? Math.max(0, item.calDiff) : item.credited, timeText: formatTime(item.timestamp), gained: item.calDiff })),
      totalExp: Math.round(history.reduce((sum, item) => sum + (item.credited === undefined ? Math.max(0, item.calDiff) : item.credited), 0) * 100) / 100,
      feedCount: history.length
    });
  },

  onWantInput(e) { this.setData({ wantText: e.detail.value }); },
  onActualInput(e) { this.setData({ actualText: e.detail.value }); },

  undoLastFeed() { this.confirmHistoryChange(false); },
  clearHistory() { this.confirmHistoryChange(true); },

  askConfirmation(options) {
    return new Promise(resolve => wx.showModal({
      ...options, success: res => resolve(Boolean(res.confirm)), fail: () => resolve(false)
    }));
  },

  saveHistory(history) {
    wx.setStorageSync(STORAGE_KEY, history);
    this.updateHistory(history);
    this.setData({ calDiff: 0 });
  },

  async confirmHistoryChange(clearAll) {
    if (this.data.submitting || this.data.managingHistory || !this.data.storageReady || !this.data.history.length) return;
    this.setData({ managingHistory: true });
    try {
      const confirmed = await this.askConfirmation({
      title: clearAll ? '确认将累计热量归零？' : '确认撤回最近一次记录？',
      content: clearAll
        ? '菇哩的累计热量将归零。完成后会再询问是否删除历史记录。'
        : `将删除最近一次记录，${this.data.history[0].credited < 0 ? '并加回之前扣除的 ' + Math.abs(this.data.history[0].credited) + ' 大卡' : '并扣除它仍计入累计的 ' + this.data.history[0].credited + ' 大卡'}。撤回后可修改输入并重新投喂。`,
      confirmText: clearAll ? '确认归零' : '确认撤回',
      cancelText: '先保留',
      confirmColor: '#c0392b',
      });
      if (!confirmed) return;
      if (clearAll) {
        // 归零后保留原始热量差，但旧记录不再参与新的累计。
        const history = this.data.history.map(({ timeText, gained, ...item }) => ({ ...item, credited: 0 }));
        this.saveHistory(history);
        this.setData({ result: '累计热量已归零，历史记录已保留。' });
        const deleteRecords = await this.askConfirmation({
          title: '是否同时清空热量历史记录？',
          content: `累计热量已归零。是否删除全部 ${this.data.feedCount} 条历史记录？删除后无法恢复；选择“不清空”会保留历史记录。`,
          confirmText: '确认清空', cancelText: '不清空', confirmColor: '#c0392b'
        });
        if (deleteRecords) {
          this.saveHistory([]);
          this.setData({ result: '累计热量已归零，全部历史记录已清空。', wantText: '', actualText: '' });
        }
      } else {
        const latest = this.data.history[0];
        const history = this.data.history.slice(1).map(({ timeText, gained, ...item }) => item);
        this.saveHistory(history);
        this.setData({
          calDiff: 0,
          result: '最近一次记录已删除，累计热量已更新，可以修改后重新投喂。',
          wantText: latest.wantFood,
          actualText: latest.realFood
        });
      }
    } catch (error) {
      console.error('修改记录失败：', error);
      wx.showModal({ title: '操作未完成', content: '保存失败，本步修改未生效，请稍后重试。', showCancel: false });
    } finally {
      this.setData({ managingHistory: false });
    }
  },

  async confirmFeed() {
    if (this.data.submitting || this.data.managingHistory || !this.data.storageReady) return;
    const wantFood = this.data.wantText.trim();
    const realFood = this.data.actualText.trim();
    if (!wantFood || !realFood) {
      wx.showModal({ title: '提示', content: '请把想吃的和实际吃的都填上', showCancel: false });
      return;
    }
    this.setData({ submitting: true, result: '' });
    wx.showLoading({ title: '菇哩正在算...' });
    let stage = 'calculate';
    try {
      const res = await wx.cloud.callFunction({ name: 'calcCalDiff', data: { wantFood, realFood } });
      const raw = res.result && res.result.calDiff;
      if ((typeof raw !== 'number' && typeof raw !== 'string') ||
          (typeof raw === 'string' && !raw.trim()) || !Number.isFinite(Number(raw))) {
        throw new Error('Invalid calDiff');
      }
      const calDiff = Math.round(Number(raw) * 100) / 100;
      if (!Number.isFinite(calDiff)) throw new Error('Invalid calDiff');
      const timestamp = Date.now();
      const record = { id: `${timestamp}-${Math.random().toString(36).slice(2)}`, timestamp, wantFood, realFood, calDiff, credited: calDiff };
      const history = [record, ...this.data.history.map(({ timeText, gained, ...item }) => item)];
      stage = 'save';
      wx.setStorageSync(STORAGE_KEY, history);
      this.updateHistory(history);
      this.setData({
        calDiff,
        result: calDiff > 0 ? `热量差：${calDiff} 大卡，已累计给菇哩！` : calDiff < 0 ? `热量差：${calDiff} 大卡，已从累计中扣除 ${Math.abs(calDiff)} 大卡。` : '热量差：0 大卡，已记录，累计热量不变。'
      });
    } catch (error) {
      console.error('投喂失败：', error);
      wx.showModal({
        title: stage === 'save' ? '历史记录保存失败' : '计算失败',
        content: stage === 'save' ? '本次未加入菇哩的累计，请检查设备存储空间后重试。' : '未获得有效的热量差，请稍后重试。',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
