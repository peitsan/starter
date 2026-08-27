// 简体中文
export default {
  app: {
    title: 'Starter',
    preview: '浏览器预览模式（mock 数据，无 Tauri 运行时）。启动 starter-ui.exe 看真实效果。',
  },
  tabs: {
    items: '启动项',
    timeline: '时间线',
    settings: '设置',
  },
  search: {
    placeholder: '搜索...',
  },
  buttons: {
    rescan: '重新扫描',
    refresh: '刷新',
    enable: '启用',
    disable: '禁用',
    detail: '详情',
    dryRun: '跑一次干调度（模拟）',
  },
  items: {
    title: '启动项',
    loading: '加载中...',
    empty: '暂无启动项。',
    columns: {
      name: '名称',
      source: '来源',
      risk: '风险',
      state: '状态',
      delay: '延迟 (ms)',
      priority: '优先级',
      actions: '操作',
    },
    risk: {
      critical: '关键',
      recommend_off: '建议关闭',
      normal: '常规',
    },
    state: {
      on: '开',
      off: '关',
    },
    toast: {
      enabled: '已启用',
      disabled: '已禁用',
      delayUpdated: '延迟已更新',
      priorityUpdated: '优先级已更新',
      error: '错误：{{msg}}',
      scanned: '已扫描 {{total}} 项（新增 {{inserted}}，更新 {{updated}}）',
      scanFailed: '扫描失败：{{msg}}',
      dryRun: '干调度：总数={{total}} 成功={{started}} 失败={{failed}}',
    },
    meta: {
      daemon: '守护进程：{{url}}（token {{token}}）',
      daemonTokenOK: '已配置',
      daemonTokenMissing: '缺失',
      initFailed: '初始化失败：{{msg}}',
      count: '共 {{n}} 项',
      error: '错误：{{msg}}',
      scanning: '正在扫描...',
    },
  },
  timeline: {
    title: '上次启动时间线',
    loading: '加载中...',
    empty: '暂无事件。运行 schedule_run 产生数据。',
  },
  settings: {
    title: '设置与诊断',
    refresh: '刷新',
    diskIo: '磁盘 IO',
    windowsService: 'Windows 服务',
    doctor: '自检',
    quickActions: '快捷操作',
    dryRunHelp: '跑一次模拟调度，用来填充时间线。',
  },
  common: {
    dash: '—',
    loading: '加载中...',
  },
};
