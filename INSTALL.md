# WSL File Watcher Solution Installation Guide

## 1. Install VSCode Extension

### Method 1: Local Development Version Installation

1. Navigate to the extension directory and install dependencies:
```bash
cd vscode-mcp-bridge-extension
npm install
```

2. Compile the extension:
```bash
npm run compile
vsce package
```

3. Install in VSCode:
   - Press `Ctrl+Shift+P` to open the command palette
   - Type `Extensions: Install from VSIX...`
   - Select the generated .vsix file in the current directory

### Method 2: Development Mode

1. Open the `vscode-mcp-bridge-extension` folder in VSCode
2. Press `F5` to start debug mode
3. Test the extension functionality in the new window

## 2. Configure MCP Server

### Install MCP Server

1. Navigate to the MCP server directory:
```bash
cd mcp-vscode-notifier
npm install
```

2. Build the server:
```bash
npm run build
```

### Configure Claude Code

Add the MCP server to your Claude Code configuration file:

**Mac users:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Linux users:** `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vscode-notifier": {
      "command": "node",
      "args": ["/path/to/project/mcp-vscode-notifier/dist/index.js"]
    }
  }
}
```

**Note:** Replace the path with your actual project path!

## 3. Start and Test

### Start VSCode Extension

1. In VSCode, press `Ctrl+Shift+P`
2. Type `File Refresher: Start Server`
3. Confirm the server starts (port 8790)

## 4. Verify Installation

1. **Check VSCode extension status:**
   - Check if "File Refresher" appears in the VSCode status bar
   - Check the "File Refresher" channel in the output panel

2. **Test project refresh:**
   - Modify files in your project
   - Use the refresh_project tool to refresh the project
   - Observe if syntax checking updates immediately

## 5. Troubleshooting

### Common Issues

**Issue 1:** MCP server connection failed
- Check if the path is correct
- Ensure npm dependencies are installed
- Restart Claude Code

**Issue 2:** VSCode extension not starting
- Check if the extension is properly installed
- Manually run the start command
- Check error messages in VSCode Developer Tools

**Issue 3:** Port conflict
- Modify the port number in VSCode extension configuration
- Also update the port parameter when calling MCP tools

### Debug Mode

Enable verbose logging:
1. Search for "File Refresher" in VSCode settings
2. Enable the "Enable Logging" option
3. Check detailed logs in the output panel