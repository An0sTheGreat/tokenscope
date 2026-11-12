// Settings → ccusage argument arrays. Pure; no DOM. The host adds --json and checks every flag
// against ArgPolicy (src/Tokenscope/Engine.cs): a new flag changes both sides together.

export function engineArgs({ timezone = '', costMode = 'auto', offline = false, tokenLimit = '' } = {}) {
  const common = [
    ...(timezone ? ['--timezone', timezone] : []),
    ...(costMode && costMode !== 'auto' ? ['--mode', costMode] : []),
    ...(offline ? ['--offline'] : []),
  ];
  return {
    main: ['daily', '--sections', 'daily,session', '--by-agent', ...common],
    sessions: ['claude', 'session', ...common],
    blocks: ['blocks', ...common, ...(tokenLimit ? ['--token-limit', String(tokenLimit)] : [])],
    projects: ['claude', 'daily', '--instances', ...common],
  };
}
