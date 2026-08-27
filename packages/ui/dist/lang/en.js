// English strings
export default {
  app: {
    title: 'Starter',
    preview: 'Browser preview mode (mock data, no Tauri runtime). Launch starter-ui.exe for the real app.',
  },
  tabs: {
    items: 'Items',
    timeline: 'Timeline',
    settings: 'Settings',
  },
  search: {
    placeholder: 'Search...',
  },
  buttons: {
    rescan: 'Rescan',
    refresh: 'Refresh',
    enable: 'Enable',
    disable: 'Disable',
    detail: 'Detail',
    dryRun: 'Run dry schedule (simulate)',
  },
  items: {
    title: 'Items',
    loading: 'Loading...',
    empty: 'No items.',
    columns: {
      name: 'Name',
      source: 'Source',
      risk: 'Risk',
      state: 'State',
      delay: 'Delay (ms)',
      priority: 'Priority',
      actions: 'Actions',
    },
    risk: {
      critical: 'critical',
      recommend_off: 'recommend off',
      normal: 'normal',
    },
    state: {
      on: 'on',
      off: 'off',
    },
    toast: {
      enabled: 'Enabled',
      disabled: 'Disabled',
      delayUpdated: 'Delay updated',
      priorityUpdated: 'Priority updated',
      error: 'Error: {{msg}}',
      scanned: 'Scanned {{total}} (inserted {{inserted}}, updated {{updated}})',
      scanFailed: 'Scan failed: {{msg}}',
      dryRun: 'dry_run: total={{total}} started={{started}} failed={{failed}}',
    },
    meta: {
      daemon: 'Daemon: {{url}} (token {{token}})',
      daemonTokenOK: 'OK',
      daemonTokenMissing: 'missing',
      initFailed: 'Init failed: {{msg}}',
      count: '{{n}} items',
      error: 'Error: {{msg}}',
      scanning: 'Scanning...',
    },
  },
  timeline: {
    title: 'Last run timeline',
    loading: 'Loading...',
    empty: 'No events yet. Run a schedule_run to populate.',
  },
  settings: {
    title: 'Settings & Diagnostics',
    refresh: 'Refresh',
    diskIo: 'Disk IO',
    windowsService: 'Windows Service',
    doctor: 'Doctor',
    quickActions: 'Quick actions',
    dryRunHelp: 'Run a simulated scheduling cycle to populate timeline.',
  },
  common: {
    dash: '—',
    loading: 'Loading...',
  },
};
