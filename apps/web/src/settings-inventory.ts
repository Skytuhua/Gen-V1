// T3 settings search inventory, pinned to da8cc591dadd75819ae62961da4a882767efb145.
// Labels and search terms transcribed from the upstream source; behavior is classified locally.
export const T3_SETTINGS_SOURCE = 'https://github.com/pingdotgg/t3code/blob/da8cc591dadd75819ae62961da4a882767efb145/apps/web/src/components/settings/settingsSearch.ts';
export interface SettingsInventoryRow { id: string; title: string; section: string; terms: string }
// Panel rows supplement the static search index. Dynamic provider fields are
// represented as unavailable adapter rows rather than invented credentials.
const panelRows = (section: string, titles: string[]): SettingsInventoryRow[] => titles.map(title => ({ id: `panel-${section}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title, section, terms: title }));
const t3Commands = [
  'workspace.focusNext', 'workspace.focusPrevious', 'sidebar.toggle', 'navigation.back', 'navigation.forward', 'terminal.toggle', 'terminal.split', 'terminal.splitVertical', 'terminal.new', 'terminal.close', 'rightPanel.toggle', 'rightPanel.new', 'threadPanel.toggle', 'rightPanel.toggleMaximized', 'rightPanel.close', 'view.reopenClosed', 'pullRequest.copyNumber', 'diff.toggle', 'preview.toggle', 'preview.refresh', 'preview.focusUrl', 'preview.zoomIn', 'preview.zoomOut', 'preview.resetZoom', 'commandPalette.toggle', 'filePicker.toggle', 'projectSearch.toggle', 'usage.open', 'theme.select', 'appearance.cycle', 'themeEditor.toggle', 'composer.stash', 'composer.sendAlternate', 'composer.sendBackground', 'composer.sendAndNewThread', 'composer.host', 'composer.cycleHost', 'composer.effort', 'composer.increaseEffort', 'composer.decreaseEffort', 'composer.mode', 'composer.workspace', 'composer.previousWorktree', 'composer.branch', 'chat.new', 'chat.newLocal', 'chat.newWithoutProject', 'chat.find', 'editor.openFavorite', 'usage.cost', 'usage.tokens', 'usage.limits', 'usage.period.day', 'usage.period.week', 'usage.period.month', 'usage.period.quarter', 'modelPicker.toggle', 'modelPicker.previousProvider', 'modelPicker.nextProvider', 'thread.stop', 'thread.steerQueuedMessage', 'thread.editQueuedMessage', 'thread.previous', 'thread.next', 'thread.copyReference', 'thread.settle', 'thread.pin', 'thread.undo',
  ...Array.from({ length: 9 }, (_, index) => `modelPicker.jump.${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `thread.jump.${index + 1}`),
];
const commandLabels: Record<string, string> = { 'workspace.focusNext': 'Focus Next Workspace Area', 'workspace.focusPrevious': 'Focus Previous Workspace Area', 'composer.sendAlternate': 'Composer: Opposite Queue or Steer Action', 'composer.sendBackground': 'Composer: Start in Background', 'composer.sendAndNewThread': 'Composer: Send and Start New Thread', 'thread.steerQueuedMessage': 'Queue: Send First Queued Message', 'thread.editQueuedMessage': 'Queue: Edit Last Queued Message', 'thread.copyReference': 'Pull Request: Copy Link or Thread', 'view.reopenClosed': 'Reopen Closed Tab', 'preview.focusUrl': 'Preview: Focus URL' };
export const T3_PANEL_ROWS: SettingsInventoryRow[] = [
  ...t3Commands.map(command => ({ id: `keybinding-${command}`, title: commandLabels[command] ?? command.split('.').map(part => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())).join(': '), section: 'keybindings', terms: command })),
  ...panelRows('scheduled-tasks', ['Runs on', 'Name', 'Project', 'Workspace', 'Base branch', 'Checkout path', 'Prompt', 'Model', 'Schedule type', 'Webhook URL', 'Skip requests older than', 'Filters', 'Replay key', 'Coalesce key', 'Coalesce window', 'Require signature', 'Header', 'Prefix', 'Encoding', 'Secret', 'Run at', 'Days to run', 'Run every', 'Enabled', 'Run now', 'Run history', 'Webhook deliveries', 'Rotate webhook URL', 'Delete scheduled task']),
  ...panelRows('diagnostics', ['Live Processes', 'Child Processes', 'CPU', 'Memory', 'Server PID', 'Resource History', 'Trace Diagnostics', 'Open logs folder', 'Spans', 'Failures', 'Slow Spans', 'Parse Errors', 'Latest Failures', 'Most Common Failures', 'Slowest Spans', 'Span Logs', 'Top Span Names', 'Resource monitor', 'Read throughput', 'Write throughput', 'Process count', 'CPU speed limit', 'Power source', 'Low power mode', 'Thermal', 'Native process monitor', 'Process scan', 'Inaccessible', 'Sidecar', 'Restarts', 'Collection time', 'Instrumented application I/O']),
  ...panelRows('providers', ['Add provider', 'Provider authentication', 'Provider command', 'Arguments', 'Provider models', 'Custom models', 'Provider sessions', 'Usage limit sources']),
  ...panelRows('projects', ['Project name', 'Project icon', 'Checkouts', 'Remove project', 'Setup actions', 'Run actions']),
  ...panelRows('access', ['Pairing link scopes', 'Client scopes', 'Authorized clients', 'Revoke client access']),
  ...panelRows('appearance', ['Import theme', 'Theme editor', 'Theme search', 'Light theme variant', 'Dark theme variant']),
  ...panelRows('connections', ['Add environment', 'Saved environments', 'SSH configuration', 'Environment routes']),
  ...panelRows('secrets', ['Secret provider name', 'Secret provider command', 'Vault account']),
  ...panelRows('licenses', ['Dependency license notices']),
];
export const T3_SETTINGS_ROWS: SettingsInventoryRow[] = [
  {
    "id": "storage-worktree-keep-when",
    "title": "Keep worktrees with local changes",
    "section": "worktrees",
    "terms": "any local files uncommitted changes edited tracked files ignored env build output cleanup ,"
  },
  {
    "id": "storage-delete-now",
    "title": "Delete now",
    "section": "maintenance",
    "terms": "storage cleanup run now results report removed kept failed"
  },
  {
    "id": "storage-worktrees",
    "title": "Worktree cleanup",
    "section": "worktrees",
    "terms": "disk storage delete deleted archived threads old inactive merged unchanged worktrees retention days project inherit off custom ,"
  },
  {
    "id": "storage-worktrees-location",
    "title": "Worktree location",
    "section": "worktrees",
    "terms": "worktree location folder directory path drive external disk"
  },
  {
    "id": "storage-artifacts",
    "title": "Artifacts and logs",
    "section": "maintenance",
    "terms": "disk storage browser screenshots captures rotated logs cleanup retention"
  },
  {
    "id": "project-defaults",
    "title": "Project defaults and overrides",
    "section": "threads",
    "terms": "model workspace environments projects inheritance checkout"
  },
  {
    "id": "project-overview",
    "title": "Project overview",
    "section": "projects",
    "terms": "name icon emoji image checkout remove delete"
  },
  {
    "id": "default-model",
    "title": "Default model",
    "section": "threads",
    "terms": "new thread project provider reasoning effort"
  },
  {
    "id": "default-permissions",
    "title": "Permissions",
    "section": "threads",
    "terms": "new thread default runtime mode supervised approvals auto accept edits full access ,"
  },
  {
    "id": "color-scheme",
    "title": "Color scheme",
    "section": "appearance",
    "terms": "appearance light dark system mode"
  },
  {
    "id": "theme",
    "title": "Themes",
    "section": "appearance",
    "terms": "appearance colors palette custom import"
  },
  {
    "id": "setting-appearance-contrast",
    "title": "Contrast",
    "section": "appearance",
    "terms": "colors borders interface"
  },
  {
    "id": "setting-glass-opacity",
    "title": "Glass opacity",
    "section": "appearance",
    "terms": "transparent transparency solid menus dialogs composer"
  },
  {
    "id": "diff-color-scheme",
    "title": "Diff colors",
    "section": "diffs",
    "terms": "red green blue orange additions deletions changes counts palette colorblind"
  },
  {
    "id": "chat-width",
    "title": "Chat width",
    "section": "appearance",
    "terms": "wide full width column layout messages composer monitor"
  },
  {
    "id": "thread-details-items",
    "title": "Thread details",
    "section": "appearance",
    "terms": "customize show hide panel card environment editor scripts branch pull request git changes servers automations lineage usage limits 5 hour weekly quota tokens context window ,"
  },
  {
    "id": "effort-display",
    "title": "Effort display",
    "section": "appearance",
    "terms": "reasoning effort thinking bars graph word label level composer"
  },
  {
    "id": "math-rendering",
    "title": "Render math",
    "section": "appearance",
    "terms": "latex tex katex equations formulas markdown"
  },
  {
    "id": "panel-animations",
    "title": "Panel animations",
    "section": "appearance",
    "terms": ""
  },
  {
    "id": "environment-identification",
    "title": "Environment identification",
    "section": "appearance",
    "terms": "dev nightly latest channel artwork pill label hide none"
  },
  {
    "id": "interface-font",
    "title": "Interface font",
    "section": "appearance",
    "terms": "typography family size system sans"
  },
  {
    "id": "prompt-font",
    "title": "Prompt font",
    "section": "appearance",
    "terms": "typography family size composer input"
  },
  {
    "id": "code-font",
    "title": "Code font",
    "section": "appearance",
    "terms": "typography family size monospace code blocks diffs file previews"
  },
  {
    "id": "terminal-font",
    "title": "Terminal font",
    "section": "appearance",
    "terms": "typography family size monospace output"
  },
  {
    "id": "separate-fonts",
    "title": "Separate fonts",
    "section": "appearance",
    "terms": "typography advanced prompt code terminal font family size individually"
  },
  {
    "id": "font-smoothing",
    "title": "Font smoothing",
    "section": "appearance",
    "terms": "typography text grayscale anti aliasing macos thin"
  },
  {
    "id": "word-wrap",
    "title": "Word wrap",
    "section": "appearance",
    "terms": "long lines code blocks diffs file previews"
  },
  {
    "id": "composer-context",
    "title": "Composer context",
    "section": "appearance",
    "terms": ""
  },
  {
    "id": "project-grouping",
    "title": "Project grouping",
    "section": "general",
    "terms": "combine matching repositories environments sidebar"
  },
  {
    "id": "project-order",
    "title": "Project order",
    "section": "general",
    "terms": "sort projects sidebar manual created recent"
  },
  {
    "id": "snooze-options",
    "title": "Snooze options",
    "section": "threads",
    "terms": "snooze presets times later tonight tomorrow next week remind"
  },
  {
    "id": "snooze-limited-threads",
    "title": "Snooze until limits reset",
    "section": "threads",
    "terms": "usage quota rate limit reset wake recover continue"
  },
  {
    "id": "auto-resume-limited-threads",
    "title": "Resume after usage limits",
    "section": "threads",
    "terms": "usage quota rate limit reset recover continue"
  },
  {
    "id": "working-shelf",
    "title": "Working section",
    "section": "general",
    "terms": "hide fold running monitoring threads inbox sidebar shelf"
  },
  {
    "id": "boring-sidebar",
    "title": "Boring sidebar (group by project)",
    "section": "labs",
    "terms": "beta folders project tree legacy old classic sidebar"
  },
  {
    "id": "boring-sidebar-multiline",
    "title": "Two-line folder rows",
    "section": "labs",
    "terms": "beta boring sidebar folder rows multiline branch pull request details"
  },
  {
    "id": "guest-links",
    "title": "Guest links",
    "section": "labs",
    "terms": "beta share guest invite link teammate watch t3 connect tunnel"
  },
  {
    "id": "linked-environments-beta",
    "title": "Linked environments",
    "section": "labs",
    "terms": "beta link another machine vps peer agents work there delegate"
  },
  {
    "id": "simlock-hosts",
    "title": "Simlock device hosts (alpha)",
    "section": "labs",
    "terms": "beta alpha simlock callstack simulator emulator ios android pool lease gateway"
  },
  {
    "id": "auto-settle-inactive-threads",
    "title": "Auto-settle inactive threads",
    "section": "threads",
    "terms": "sidebar inactivity days no activity automatically"
  },
  {
    "id": "compact-idle-threads",
    "title": "Compact idle threads",
    "section": "providers",
    "terms": "claude context compaction idle cache tokens usage summary resume"
  },
  {
    "id": "auto-settle-merged-threads",
    "title": "Auto-settle merged threads",
    "section": "threads",
    "terms": "pull request merge closed automatically sidebar"
  },
  {
    "id": "keep-threads-with-pull-requests",
    "title": "Keep threads with a PR",
    "section": "threads",
    "terms": "pull request inactivity auto-settle merge close sidebar"
  },
  {
    "id": "days-before-auto-settle",
    "title": "Days of inactivity before auto-settle",
    "section": "threads",
    "terms": "thread timeout activity sidebar"
  },
  {
    "id": "thread-notifications",
    "title": "Thread notifications",
    "section": "general",
    "terms": "notification sound alert completion input approval desktop"
  },
  {
    "id": "in-app-notifications",
    "title": "In-app notifications",
    "section": "general",
    "terms": "notification toast popup completion input approval failure"
  },
  {
    "id": "time-format",
    "title": "Time format",
    "section": "general",
    "terms": "timestamp clock locale system browser os 12 hour 24 hour"
  },
  {
    "id": "response-streaming",
    "title": "Response streaming",
    "section": "threads",
    "terms": "output token paragraph buffered wait turn legacy"
  },
  {
    "id": "hide-whitespace-changes",
    "title": "Hide whitespace changes",
    "section": "diffs",
    "terms": "diff ignore spaces edits default"
  },
  {
    "id": "default-diff-file-state",
    "title": "Default diff file state",
    "section": "diffs",
    "terms": "collapsed expanded collapse expand files pull request pr code tab"
  },
  {
    "id": "diff-layout",
    "title": "Diff layout",
    "section": "diffs",
    "terms": "stacked split side by side unified inline view"
  },
  {
    "id": "proactive-panels",
    "title": "Proactive panels",
    "section": "diffs",
    "terms": "automatically open diff pull request pr right panel agent completion"
  },
  {
    "id": "skills-in-slash-menu",
    "title": "Show skills in slash menu",
    "section": "chat",
    "terms": "command menu dollar $ slash /"
  },
  {
    "id": "composer-rich-text",
    "title": "Rich text composer",
    "section": "chat",
    "terms": "composer rich text tiptap bold italic markdown styled wysiwyg"
  },
  {
    "id": "send-shortcut",
    "title": "Send shortcut",
    "section": "chat",
    "terms": "enter return command ctrl multiline prompt new line composer"
  },
  {
    "id": "follow-up-behavior",
    "title": "Follow-up behavior",
    "section": "chat",
    "terms": "queue steer running turn send default behavior composer"
  },
  {
    "id": "provider-update-checks",
    "title": "Provider update checks",
    "section": "maintenance",
    "terms": "installed cli versions newer available codex claude cursor grok fx opencode"
  },
  {
    "id": "continue-threads-after-server-update",
    "title": "Continue threads after restarts",
    "section": "maintenance",
    "terms": "resume running active interrupted work restart reboot machine crash desktop update automatically ,"
  },
  {
    "id": "background-activity",
    "title": "Background activity",
    "section": "maintenance",
    "terms": "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy ,"
  },
  {
    "id": "new-threads",
    "title": "New threads",
    "section": "threads",
    "terms": "default workspace mode draft local worktree"
  },
  {
    "id": "worktree-submodules",
    "title": "Submodules",
    "section": "worktrees",
    "terms": "git submodule init recursive top-level none worktree t3.json"
  },
  {
    "id": "start-from-origin",
    "title": "Start from remote",
    "section": "worktrees",
    "terms": "new worktrees start remote origin latest fetched branch local"
  },
  {
    "id": "add-project-starts-in",
    "title": "Add project starts in",
    "section": "threads",
    "terms": "base directory folder browser path home"
  },
  {
    "id": "unpin-confirmation",
    "title": "Unpin confirmation",
    "section": "general",
    "terms": "ask before thread pinned section"
  },
  {
    "id": "archive-confirmation",
    "title": "Archive confirmation",
    "section": "general",
    "terms": "ask before thread second click inline action"
  },
  {
    "id": "delete-confirmation",
    "title": "Delete confirmation",
    "section": "general",
    "terms": "ask before thread chat history"
  },
  {
    "id": "quit-confirmation",
    "title": "Quit shortcut",
    "section": "general",
    "terms": "confirmation desktop app exit direct hold double click press twice"
  },
  {
    "id": "text-generation-model",
    "title": "Text generation model",
    "section": "threads",
    "terms": "generated thread titles source control content default provider"
  },
  {
    "id": "thread-title-instructions",
    "title": "Thread title instructions",
    "section": "threads",
    "terms": "generated thread titles prompt custom style naming rename regenerate"
  },
  {
    "id": "app-version",
    "title": "Version",
    "section": "about",
    "terms": "about check for updates download install upgrade release"
  },
  {
    "id": "update-track",
    "title": "Update track",
    "section": "about",
    "terms": "release channel stable latest nightly prerelease"
  },
  {
    "id": "cli-command",
    "title": "t3 command",
    "section": "about",
    "terms": "cli terminal shell path install command line"
  },
  {
    "id": "mobile-app",
    "title": "Mobile app",
    "section": "about",
    "terms": "phone tablet iPhone iPad iOS Android App Store Google Play QR"
  },
  {
    "id": "privacy-policy",
    "title": "Privacy policy",
    "section": "about",
    "terms": "telemetry analytics usage data tracking legal opt out"
  },
  {
    "id": "telemetry-export",
    "title": "OpenTelemetry export",
    "section": "diagnostics",
    "terms": "OTel OTLP telemetry export endpoints logs traces metrics Grafana"
  },
  {
    "id": "diagnostics",
    "title": "Diagnostics",
    "section": "maintenance",
    "terms": "logs traces processes resource history failures spans cpu memory"
  },
  {
    "id": "open-source-licenses",
    "title": "Open source licenses",
    "section": "about",
    "terms": ""
  },
  {
    "id": "legacy-plan-mode",
    "title": "Plan mode (legacy)",
    "section": "labs",
    "terms": "build plan composer old"
  },
  {
    "id": "legacy-context-window-indicator",
    "title": "Context window indicator (legacy)",
    "section": "labs",
    "terms": "composer meter usage tokens circle old"
  },
  {
    "id": "keybindings",
    "title": "Keybindings",
    "section": "keybindings",
    "terms": "keyboard shortcuts hotkeys commands bindings json"
  },
  {
    "id": "snap-shot-enabled",
    "title": "SnapShots",
    "section": "snap-shot",
    "terms": "window capture screenshot"
  },
  {
    "id": "snap-shot-accessibility",
    "title": "Include app text",
    "section": "snap-shot",
    "terms": "capture accessibility data text UI structure elements privacy omit agent context ,"
  },
  {
    "id": "snap-shot-shortcut",
    "title": "Capture shortcut",
    "section": "snap-shot",
    "terms": ""
  },
  {
    "id": "snap-shot-sound",
    "title": "Capture sound",
    "section": "snap-shot",
    "terms": ""
  },
  {
    "id": "snap-shot-flash",
    "title": "Capture flash",
    "section": "snap-shot",
    "terms": ""
  },
  {
    "id": "snap-shot-animations",
    "title": "Capture animations",
    "section": "snap-shot",
    "terms": ""
  },
  {
    "id": "providers",
    "title": "Providers",
    "section": "providers",
    "terms": "agents cli codex claude cursor grok fx opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact ,"
  },
  {
    "id": "usage-providers",
    "title": "Usage providers",
    "section": "providers",
    "terms": "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove ,"
  },
  {
    "id": "cursor-keychain-usage",
    "title": "Cursor account usage",
    "section": "providers",
    "terms": "cursor macOS keychain usage tokens cost limits permission"
  },
  {
    "id": "provider-health-check-interval",
    "title": "Health check interval",
    "section": "providers",
    "terms": "refresh availability versions auth state models background probes seconds off"
  },
  {
    "id": "agent-browser-access",
    "title": "Agent browser access",
    "section": "browser",
    "terms": "allow disable enable open drive preview tools sessions project override"
  },
  {
    "id": "device-sources",
    "title": "Device sources",
    "section": "devices",
    "terms": "device hosts ssh remote mac mini identity key connection eas expo cloud simlock pool gateway local simulators ,"
  },
  {
    "id": "agent-device-access",
    "title": "Agents can use devices",
    "section": "devices",
    "terms": "allow simulator emulator ios android drive tools sessions"
  },
  {
    "id": "device-hub",
    "title": "Use devices",
    "section": "devices",
    "terms": "device hub simulator emulator ios android install start version"
  },
  {
    "id": "device-platform-support",
    "title": "Local simulators",
    "section": "devices",
    "terms": "simulator support xcode android studio sdk avd runtime"
  },
  {
    "id": "browser-profiles",
    "title": "Browser profiles",
    "section": "browser",
    "terms": ""
  },
  {
    "id": "browser-default-profile",
    "title": "Default browser profile",
    "section": "browser",
    "terms": ""
  },
  {
    "id": "browser-default-viewport",
    "title": "Default browser viewport",
    "section": "browser",
    "terms": "preview size width height device desktop mobile rotate"
  },
  {
    "id": "browser-default-zoom",
    "title": "Default browser zoom",
    "section": "browser",
    "terms": "preview page scale tabs percent"
  },
  {
    "id": "browser-default-appearance",
    "title": "Default browser appearance",
    "section": "browser",
    "terms": "preview color scheme light dark system os"
  },
  {
    "id": "browser-recording-frame-rate",
    "title": "Browser recording frame rate",
    "section": "browser",
    "terms": ""
  },
  {
    "id": "browser-recording-key-presses",
    "title": "Show key presses in recordings",
    "section": "browser",
    "terms": "browser preview keyboard shortcuts keystrokes overlay capture"
  },
  {
    "id": "browser-recording-mouse-presses",
    "title": "Show mouse presses in recordings",
    "section": "browser",
    "terms": "browser preview clicks buttons drag overlay capture"
  },
  {
    "id": "browser-link-target",
    "title": "Open links in",
    "section": "browser",
    "terms": "links default browser in-app browser external open"
  },
  {
    "id": "browser-search-engine",
    "title": "Search engine",
    "section": "browser",
    "terms": "address bar duckduckgo google bing brave kagi ecosia custom"
  },
  {
    "id": "pull-request-links-open-in-app",
    "title": "Open pull requests in T3 Code",
    "section": "diffs",
    "terms": "pr links source control browser external click default pull request view panel ,"
  },
  {
    "id": "browser-auto-show-floating-preview",
    "title": "Auto-show floating preview",
    "section": "browser",
    "terms": "agent opens browser device simulator pop into view hide"
  },
  {
    "id": "automatic-pull",
    "title": "Automatically pull",
    "section": "source-control",
    "terms": "auto pull default branch current checkout fast forward upstream"
  },
  {
    "id": "remove-agent-credits-on-merge",
    "title": "Remove agent credits when merging",
    "section": "source-control",
    "terms": "pull request source control squash co-authored-by attribution claude codex generated ,"
  },
  {
    "id": "pull-request-merge-method",
    "title": "Default merge method",
    "section": "source-control",
    "terms": "pull request merge squash rebase last selected"
  },
  {
    "id": "source-control",
    "title": "Source control",
    "section": "source-control",
    "terms": "version control git source control hosting integrations credentials scan server environment ,"
  },
  {
    "id": "git-fetch-interval",
    "title": "Git fetch interval",
    "section": "maintenance",
    "terms": "automatic remote branch refresh background credentials security keys seconds off ,"
  },
  {
    "id": "worktree-branch-naming",
    "title": "Worktree branch naming",
    "section": "worktrees",
    "terms": "static semantic prefix custom prompt instructions feat fix refactor chore"
  },
  {
    "id": "source-control-writing-style",
    "title": "Source control writing style",
    "section": "source-control",
    "terms": "repository conventions conventional commits custom instructions change descriptions request titles ,"
  },
  {
    "id": "follow-change-request-templates",
    "title": "Follow change request templates",
    "section": "source-control",
    "terms": "repository pr pull request description structure"
  },
  {
    "id": "source-control-writer-model",
    "title": "Source control writer model",
    "section": "source-control",
    "terms": "override generated commit change request pr titles descriptions branch bookmark ,"
  },
  {
    "id": "review-guides",
    "title": "Review guides (beta)",
    "section": "source-control",
    "terms": "pull request pr guided review guide tour beta experimental"
  },
  {
    "id": "review-guide-model",
    "title": "Review guide model",
    "section": "source-control",
    "terms": "pull request pr guided review guide brief maintainer"
  },
  {
    "id": "review-guide-instructions",
    "title": "Review guide instructions",
    "section": "source-control",
    "terms": "pull request pr guided review guide preferences taste prompt custom"
  },
  {
    "id": "project-actions",
    "title": "Actions",
    "section": "projects",
    "terms": "commands scripts setup run dev server checkout worktree t3.json import"
  },
  {
    "id": "environment-icon",
    "title": "Environment icon",
    "section": "access",
    "terms": "machine glyph sidebar mac mini studio laptop desktop server cloud vm"
  },
  {
    "id": "local-environment",
    "title": "Local environment",
    "section": "connections",
    "terms": "turn off on disable enable local server agents remote only restart"
  },
  {
    "id": "network-access",
    "title": "Network access",
    "section": "access",
    "terms": "expose backend remote pairing local machine interfaces host restart"
  },
  {
    "id": "tailscale-https",
    "title": "Tailscale HTTPS",
    "section": "access",
    "terms": "serve magicdns endpoint remote secure network"
  },
  {
    "id": "wsl-backend",
    "title": "WSL backend",
    "section": "access",
    "terms": "windows subsystem linux distro second server projects stop windows backend restart ,"
  },
  {
    "id": "t3-connect",
    "title": "T3 Connect",
    "section": "access",
    "terms": "managed tunnel cloud other devices remote tunnels limit t3 chat"
  },
  {
    "id": "hold-webhooks-while-offline",
    "title": "Hold webhooks while offline",
    "section": "access",
    "terms": "webhook automations offline queue mailbox t3 connect"
  },
  {
    "id": "publish-agent-activity",
    "title": "Publish agent activity",
    "section": "access",
    "terms": "mobile push notifications live activities cloud tunnel"
  },
  {
    "id": "connections-environment",
    "title": "This machine",
    "section": "access",
    "terms": "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint ,"
  },
  {
    "id": "linked-environments",
    "title": "Linked environments",
    "section": "connections",
    "terms": "link peer another machine vps agents work there handoff pairing code"
  },
  {
    "id": "remote-environments",
    "title": "Environments",
    "section": "connections",
    "terms": "add pair backend host code ssh config agent tunnel saved t3 connect"
  },
  {
    "id": "load-balancing",
    "title": "Load balancing",
    "section": "connections",
    "terms": "automatic machine environment resources cpu memory capacity preference weight shared projects ,"
  },
  {
    "id": "pull-request-routing",
    "title": "Pull request sharing",
    "section": "connections",
    "terms": "pull request routing trusted environments shared credentials permissions read actions source control source control ,"
  },
  {
    "id": "secret-providers",
    "title": "Secret providers",
    "section": "secrets",
    "terms": "1password vault credentials api key"
  },
  {
    "id": "secret-providers-add",
    "title": "Add secret provider",
    "section": "secrets",
    "terms": "new 1password vault op cli account"
  },
  {
    "id": "archive",
    "title": "Archived threads",
    "section": "archived",
    "terms": "restore reopen deleted history projects"
  }
];
