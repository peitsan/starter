// commitlint config — conventional commits
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // bug 修复
        'docs',     // 文档
        'style',    // 格式（不影响代码运行）
        'refactor', // 重构（既不是新功能也不是 bug 修复）
        'perf',     // 性能
        'test',     // 测试
        'build',    // 构建系统或外部依赖变动
        'ci',       // CI 配置文件和脚本变动
        'chore',    // 杂项（不修改 src 或测试）
        'revert',   // 回滚
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-empty': [0],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
