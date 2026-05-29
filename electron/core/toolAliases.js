const TOOL_ALIASES = {
  "cli-mcp-server_run_command": "run_command",
  "vgo-music": "run_command",
  "vgo_music": "run_command",
  "vgomusic": "run_command",
  "shell_command": "run_command",
  "bash": "run_command",
  "powershell": "run_command",
  "exec": "run_command",
  "execute": "run_command",
  copy: "copy_file",
  move: "move_file",
  rename: "rename_file",
  mkdir: "make_dir",
  create_directory: "make_dir",
  create_dir: "make_dir",
  rm: "delete_file",
  remove_file: "delete_file",
  rmdir: "delete_dir",
  remove_dir: "delete_dir",
  ls: "list_dir",
  dir: "list_dir",
  cat: "read_file",
  open: "open_path",
  browse: "fetch_web",
  get_url: "fetch_web",
  http_get: "fetch_web",
  transcribe: "transcribe_media",
  speech_to_text: "transcribe_media"
};

function normalizeToolName(name = "") {
  const raw = String(name || "").trim();
  const lowered = raw.toLowerCase();
  return TOOL_ALIASES[raw] || TOOL_ALIASES[lowered] || raw;
}

module.exports = { TOOL_ALIASES, normalizeToolName };
