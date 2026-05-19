/**
 * Auto-mode permission classifier.
 * Rule-driven local classifier that determines whether a tool invocation
 * should be automatically allowed or blocked in auto mode.
 *
 * Based on claude-code's yoloClassifier risk categories:
 * - BLOCK_ALWAYS: irreversible destruction, code-from-external, privilege escalation
 * - BLOCK_UNLESS_INTENT: remote git ops, package management, writes outside CWD
 * - ALLOW: read-only operations, local git, CWD file edits, tests/builds
 */

// ─── Dangerous command patterns ──────────────────────────────────────

/** Commands that execute arbitrary code from external sources */
const CODE_FROM_EXTERNAL_PATTERNS = [
  /\bcurl\b.*\|\s*(bash|sh|zsh)/i,
  /\bwget\b.*\|\s*(bash|sh|zsh)/i,
  /\bcurl\b.*-o\s+\S+.*&&\s*(bash|sh|chmod)/i,
  /\beval\s+"\$\(curl/i,
  /\beval\s+"\$\(wget/i,
] as const;

/** Commands that cause irreversible local destruction */
const IRREVERSIBLE_DESTRUCTION_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\b/,
  /\brm\s+-rf\s+[/~]/,
  /\bdd\s+.*\bof=/i,
  /\bmkfs\b/i,
  /\bshred\b/i,
  /\btruncate\b.*--size\s*0/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d/,
  /\bgit\s+reset\s+--hard/,
  /DROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /TRUNCATE\s+TABLE\b/i,
  /DELETE\s+FROM\s+\S+\s*$/i,
] as const;

/** Commands that modify system persistence (startup, cron, services) */
const UNAUTHORIZED_PERSISTENCE_PATTERNS = [
  />>?\s*~?\/?\.bashrc\b/,
  />>?\s*~?\/?\.bash_profile\b/,
  />>?\s*~?\/?\.zshrc\b/,
  />>?\s*~?\/?\.profile\b/,
  /\bcrontab\s+-[er]?\b/i,
  /\bsystemctl\s+(enable|start|restart)\b/i,
  /\blaunchctl\s+(load|submit)\b/i,
  /\bat\b\s+\d/,
  />>?\s*\/etc\/(cron|init)/,
] as const;

/** Commands that weaken system security */
const SECURITY_WEAKENING_PATTERNS = [
  /\bchmod\s+[0-7]*7[0-7]{2}\b/,
  /\bchmod\s+777\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bufw\s+disable\b/i,
  /\biptables\s+-F\b/i,
  /\bsetenforce\s+0\b/i,
  /\bpasswd\s+-d\b/i,
] as const;

/** Commands that escalate privileges */
const PRIVILEGE_ESCALATION_PATTERNS = [
  /^\s*sudo\s/,
  /\bsu\s+-?\s*$/,
  /\bsu\s+-\s+root\b/,
  /\bpkexec\b/,
  /\bdoas\b/,
] as const;

/** Commands that start network services */
const NETWORK_SERVICE_PATTERNS = [
  /\bpython[23]?\s+-m\s+http\.server\b/,
  /\bpython[23]?\s+-m\s+SimpleHTTPServer\b/,
  /\bnc\s+-l/,
  /\bsshd\b/,
  /\bnginx\b(?!.*-t\b)/,
  /\bapache2?ctl\s+start\b/i,
  /\bmongod(b)?\s+--fork\b/i,
  /\bredis-server\b/,
  /\bmysqld\b/,
  /\bpostgres\b.*-D\b/,
] as const;

// ─── Block-unless-intent patterns ────────────────────────────────────

/** Git remote/push operations */
const GIT_REMOTE_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
] as const;

/** System-level package management */
const SYSTEM_PACKAGE_PATTERNS = [
  /\bapt(-get)?\s+install\b/i,
  /\byum\s+install\b/i,
  /\bdnf\s+install\b/i,
  /\bbrew\s+install\b/i,
  /\bpacman\s+-S\b/i,
  /\bsnap\s+install\b/i,
  /\bpip\s+install\b(?!.*-r\s+requirements)/i,
  /\bnpm\s+install\s+-g\b/i,
  /\bsudo\s+(apt|yum|dnf|brew|pip|npm)\b/i,
] as const;

// ─── Safe read-only patterns ─────────────────────────────────────────

const SAFE_READONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq',
  'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'find', 'locate', 'which', 'whereis', 'type', 'file',
  'echo', 'printf', 'date', 'cal', 'uptime', 'whoami', 'hostname',
  'pwd', 'realpath', 'dirname', 'basename',
  'env', 'printenv', 'set',
  'diff', 'cmp', 'comm',
  'less', 'more',
  'tree',
  'du', 'df', 'free',
  'uname', 'id',
  'true', 'false',
]);

const SAFE_VERSION_PATTERNS = /^(\S+)\s+(-v|--version|version)$/;

const SAFE_GIT_READONLY = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag',
  'remote', 'stash', 'reflog',
  'ls-files', 'ls-tree', 'rev-parse', 'name-rev',
  'describe', 'shortlog', 'rev-list',
  'config', 'help',
]);

const SAFE_GIT_LOCAL = new Set([
  'add', 'commit', 'checkout', 'switch', 'merge', 'rebase',
  'cherry-pick', 'stash', 'branch', 'tag', 'restore',
  'reset', 'fetch', 'pull',
]);

/** Tools that are always safe in auto mode */
const AUTO_ALLOW_TOOLS = new Set([
  'filereadtool',
  'globtool',
  'greptool',
  'websearchtool',
  'webfetchtool',
  'listcodeusagestool',
  'listmcpresourcestool',
  'readmcpresourcetool',
  'toolsearchtool',
  'enterplanmodetool',
  'exitplanmodetool',
  'verifyplanexecutiontool',
  'todowritetool',
  'configtool',
]);

/** Tools that always need confirmation in auto mode */
const AUTO_ASK_TOOLS = new Set([
  'agenttool',
]);

// ─── Classification types ────────────────────────────────────────────

export type ClassificationResult = {
  shouldBlock: boolean;
  reason: string;
  category: RiskCategory;
};

export type RiskCategory =
  | 'safe'
  | 'safe_readonly'
  | 'safe_local_git'
  | 'code_from_external'
  | 'irreversible_destruction'
  | 'unauthorized_persistence'
  | 'security_weakening'
  | 'privilege_escalation'
  | 'network_service'
  | 'git_remote'
  | 'system_package'
  | 'write_outside_cwd'
  | 'unknown';

// ─── Classifier ──────────────────────────────────────────────────────

/**
 * Classify a tool invocation for auto mode.
 */
export function classifyToolForAutoMode(
  toolName: string,
  input?: Record<string, unknown>,
  cwd?: string,
): ClassificationResult {
  const normalizedName = toolName.toLowerCase();

  // Always-safe tools
  if (AUTO_ALLOW_TOOLS.has(normalizedName)) {
    return { shouldBlock: false, reason: 'Safe tool', category: 'safe' };
  }

  // Always-ask tools
  if (AUTO_ASK_TOOLS.has(normalizedName)) {
    return { shouldBlock: true, reason: 'Agent tool requires confirmation', category: 'unknown' };
  }

  // File write tools — check path
  if (normalizedName === 'filewritetool' || normalizedName === 'fileedittool') {
    return classifyFileWrite(input, cwd);
  }

  // Bash/shell commands — full analysis
  if (normalizedName === 'bashtool') {
    const command = extractCommand(input);
    if (!command) {
      return { shouldBlock: true, reason: 'No command provided', category: 'unknown' };
    }
    return classifyBashCommand(command, cwd);
  }

  // NotebookEditTool — safe
  if (normalizedName === 'notebookedittool') {
    return { shouldBlock: false, reason: 'Notebook edit', category: 'safe' };
  }

  // MCP tools — default ask
  if (normalizedName.startsWith('mcp__')) {
    return { shouldBlock: true, reason: 'MCP tool requires confirmation', category: 'unknown' };
  }

  // Unknown tools — ask
  return { shouldBlock: true, reason: `Unknown tool: ${toolName}`, category: 'unknown' };
}

/**
 * Classify a bash command for auto mode.
 */
export function classifyBashCommand(
  command: string,
  cwd?: string,
): ClassificationResult {
  const trimmed = command.trim();

  // BLOCK ALWAYS categories (checked first)
  for (const pattern of CODE_FROM_EXTERNAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Downloads and executes external code', category: 'code_from_external' };
    }
  }

  for (const pattern of IRREVERSIBLE_DESTRUCTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Irreversible data destruction', category: 'irreversible_destruction' };
    }
  }

  for (const pattern of UNAUTHORIZED_PERSISTENCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Modifies system startup/persistence', category: 'unauthorized_persistence' };
    }
  }

  for (const pattern of SECURITY_WEAKENING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Weakens system security', category: 'security_weakening' };
    }
  }

  for (const pattern of PRIVILEGE_ESCALATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Escalates privileges', category: 'privilege_escalation' };
    }
  }

  for (const pattern of NETWORK_SERVICE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Starts a network service', category: 'network_service' };
    }
  }

  // BLOCK UNLESS INTENT categories
  for (const pattern of GIT_REMOTE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'Git remote operation', category: 'git_remote' };
    }
  }

  for (const pattern of SYSTEM_PACKAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldBlock: true, reason: 'System-level package installation', category: 'system_package' };
    }
  }

  // SAFE patterns
  const firstWord = extractFirstWord(trimmed);

  // File writes via redirection to outside CWD (check before safe-command match)
  if (cwd && hasRedirectionOutsideCwd(trimmed, cwd)) {
    return { shouldBlock: true, reason: 'Writes outside project directory', category: 'write_outside_cwd' };
  }

  // Version checks
  if (SAFE_VERSION_PATTERNS.test(trimmed)) {
    return { shouldBlock: false, reason: 'Version query', category: 'safe_readonly' };
  }

  // Safe read-only commands
  if (SAFE_READONLY_COMMANDS.has(firstWord)) {
    return { shouldBlock: false, reason: 'Read-only command', category: 'safe_readonly' };
  }

  // Git commands
  if (firstWord === 'git') {
    return classifyGitCommand(trimmed);
  }

  // Project build/test commands (safe)
  if (isProjectCommand(trimmed)) {
    return { shouldBlock: false, reason: 'Project build/test command', category: 'safe' };
  }

  // Default: allow in auto mode (matching claude-code behavior)
  return { shouldBlock: false, reason: 'No dangerous patterns detected', category: 'safe' };
}

/**
 * Classify a file write operation.
 */
function classifyFileWrite(
  input?: Record<string, unknown>,
  cwd?: string,
): ClassificationResult {
  if (!cwd || !input) {
    return { shouldBlock: false, reason: 'File edit in project', category: 'safe' };
  }

  const filePath = (input.file_path ?? input.path ?? '') as string;

  if (!filePath) {
    return { shouldBlock: false, reason: 'File edit', category: 'safe' };
  }

  // Resolve relative paths
  const resolvedPath = filePath.startsWith('/')
    ? filePath
    : `${cwd}/${filePath}`;

  const normalizedCwd = cwd.replace(/\/+$/, '');
  const normalizedPath = resolvedPath.replace(/\/+$/, '');

  if (!normalizedPath.startsWith(normalizedCwd)) {
    return { shouldBlock: true, reason: 'File write outside project directory', category: 'write_outside_cwd' };
  }

  // Block writes to critical config files
  const baseName = normalizedPath.split('/').pop() ?? '';
  const criticalFiles = new Set(['.bashrc', '.bash_profile', '.zshrc', '.profile', '.gitconfig']);
  if (criticalFiles.has(baseName)) {
    return { shouldBlock: true, reason: `Write to critical config file: ${baseName}`, category: 'unauthorized_persistence' };
  }

  return { shouldBlock: false, reason: 'File edit within project', category: 'safe' };
}

/**
 * Classify a git command.
 */
function classifyGitCommand(command: string): ClassificationResult {
  const parts = command.trim().split(/\s+/);
  const subcommand = parts[1] ?? '';

  if (SAFE_GIT_READONLY.has(subcommand)) {
    return { shouldBlock: false, reason: `Git read-only: ${subcommand}`, category: 'safe_readonly' };
  }

  if (SAFE_GIT_LOCAL.has(subcommand)) {
    // Special case: git reset --hard is destructive
    if (subcommand === 'reset' && command.includes('--hard')) {
      return { shouldBlock: true, reason: 'git reset --hard is destructive', category: 'irreversible_destruction' };
    }
    return { shouldBlock: false, reason: `Git local: ${subcommand}`, category: 'safe_local_git' };
  }

  if (subcommand === 'push') {
    return { shouldBlock: true, reason: 'Git push to remote', category: 'git_remote' };
  }

  if (subcommand === 'clean') {
    return { shouldBlock: true, reason: 'git clean can delete files', category: 'irreversible_destruction' };
  }

  // Unknown git subcommand — allow by default
  return { shouldBlock: false, reason: `Git: ${subcommand}`, category: 'safe_local_git' };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function extractCommand(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const cmd = input.command ?? input.cmd ?? input.script;
  return typeof cmd === 'string' ? cmd : undefined;
}

function extractFirstWord(command: string): string {
  // Handle env prefix: env VAR=val command
  const stripped = command
    .replace(/^\s*(env\s+)?([A-Z_][A-Z0-9_]*=[^\s]*\s+)*/, '')
    .trim();
  return stripped.split(/\s+/)[0]?.replace(/^\/\S*\//, '') ?? '';
}

function isProjectCommand(command: string): boolean {
  const patterns = [
    /^npm\s+(test|run\s+(test|build|lint|format|check|dev|start))/i,
    /^npx\s+(vitest|jest|mocha|tsc|eslint|prettier|biome)\b/i,
    /^yarn\s+(test|build|lint|format|check|dev|start)\b/i,
    /^pnpm\s+(test|build|lint|format|check|dev|start)\b/i,
    /^bun\s+(test|run\s+(test|build|lint|format|check|dev|start))\b/i,
    /^make\s+(test|build|lint|check|clean|install|all)\b/i,
    /^cargo\s+(test|build|check|clippy|fmt)\b/i,
    /^go\s+(test|build|vet|fmt)\b/i,
    /^pytest\b/i,
    /^python[23]?\s+-m\s+(pytest|unittest|mypy|pylint|flake8|black|ruff)\b/i,
    /^tsc\b/,
    /^eslint\b/,
    /^prettier\b/,
    /^biome\b/,
  ];
  return patterns.some((p) => p.test(command.trim()));
}

function hasRedirectionOutsideCwd(command: string, cwd: string): boolean {
  // Simple heuristic: check > or >> followed by absolute path outside CWD
  const redirections = command.match(/>{1,2}\s*(\S+)/g);
  if (!redirections) return false;

  const normalizedCwd = cwd.replace(/\/+$/, '');
  for (const redir of redirections) {
    const target = redir.replace(/^>{1,2}\s*/, '').trim();
    if (target.startsWith('/') && !target.startsWith(normalizedCwd)) {
      return true;
    }
  }
  return false;
}

// ─── Dangerous permission rule detection ─────────────────────────────

/** Code execution interpreters that should not have blanket allow rules */
const CODE_EXEC_INTERPRETERS = new Set([
  'python', 'python3', 'python2',
  'node', 'deno', 'tsx', 'bun',
  'ruby', 'perl', 'php', 'lua',
  'npx', 'bunx',
  'bash', 'sh', 'zsh',
  'eval', 'exec', 'sudo',
]);

/**
 * Check if a Bash permission rule is too broad for auto mode.
 * Returns true if the rule allows arbitrary code execution.
 */
export function isDangerousBashRule(ruleContent?: string): boolean {
  if (!ruleContent) return true;  // Blanket Bash allow → dangerous

  const trimmed = ruleContent.trim();
  if (trimmed === '*' || trimmed === '') return true;

  // Check if it's an interpreter prefix with wildcard
  const prefixMatch = trimmed.match(/^(\w+)([*:])/);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase();
    if (CODE_EXEC_INTERPRETERS.has(prefix)) return true;
  }

  return false;
}

/**
 * Strip dangerous permission rules when entering auto mode.
 * Returns the stripped rules for later restoration.
 */
export function stripDangerousAutoModeRules(
  rules: Array<{ source: string; behavior: string; value: { toolName: string; ruleContent?: string } }>,
): Array<{ source: string; behavior: string; value: { toolName: string; ruleContent?: string } }> {
  const stripped: typeof rules = [];
  const safe: typeof rules = [];

  for (const rule of rules) {
    if (rule.behavior !== 'allow') {
      safe.push(rule);
      continue;
    }

    const toolLower = rule.value.toolName.toLowerCase();

    // Bash rules
    if (toolLower === 'bashtool' && isDangerousBashRule(rule.value.ruleContent)) {
      stripped.push(rule);
      continue;
    }

    // Agent rules — always strip in auto mode
    if (toolLower === 'agenttool') {
      stripped.push(rule);
      continue;
    }

    safe.push(rule);
  }

  return stripped;
}
