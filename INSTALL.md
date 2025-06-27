# WSL文件监听解决方案安装指南

## 1. 安装VSCode插件

### 方法1：本地安装开发版本

1. 进入插件目录并安装依赖：
```bash
cd vscode-mcp-bridge-extension
npm install
```

2. 编译插件：
```bash
npm run compile
vsce package
```

3. 在VSCode中安装：
   - 按 `Ctrl+Shift+P` 打开命令面板
   - 输入 `Extensions: Install from VSIX...`
   - 选择当前目录（或打包后的.vsix文件）

### 方法2：开发模式运行

1. 在VSCode中打开 `vscode-mcp-bridge` 文件夹
2. 按 `F5` 启动调试模式
3. 在新窗口中测试插件功能

## 2. 配置MCP服务器

### 安装MCP服务器

1. 进入MCP服务器目录：
```bash
cd mcp-vscode-notifier
npm install
```

2. 构建服务器：
```bash
npm run build
```

### 配置Claude Code

在Claude Code配置文件中添加MCP服务器：

**Windows用户：** `%APPDATA%\Claude\claude_desktop_config.json`
**Mac用户：** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Linux用户：** `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vscode-notifier": {
      "command": "node",
      "args": ["/mnt/i/gpt-projects/vscode-wsl-filewatcher/mcp-vscode-notifier/dist/index.js"]
    }
  }
}
```

**注意：** 将路径替换为你的实际项目路径！

## 3. 启动和测试

### 启动VSCode插件

1. 在VSCode中按 `Ctrl+Shift+P`
2. 输入 `File Refresher: Start Server`
3. 确认服务器启动（端口8790）

### 测试MCP工具

重启Claude Code后，你可以使用以下工具：

```bash
# 测试刷新所有文件
refresh_project()
```

## 4. 验证安装

1. **检查VSCode插件状态：**
   - 查看VSCode状态栏是否显示"File Refresher"
   - 检查输出面板的"File Refresher"频道

2. **测试项目刷新：**
   - 修改项目中的文件
   - 使用refresh_project工具刷新项目
   - 观察语法检查是否立即更新

## 5. 故障排除

### 常见问题

**问题1：** MCP服务器连接失败
- 检查路径是否正确
- 确认npm依赖已安装
- 重启Claude Code

**问题2：** VSCode插件未启动
- 检查插件是否正确安装
- 手动运行启动命令
- 查看VSCode开发者工具的错误信息

**问题3：** 端口冲突
- 修改VSCode插件配置中的端口号
- 同时修改MCP工具调用时的端口参数

### 调试模式

启用详细日志：
1. VSCode设置中搜索"File Refresher"
2. 启用"Enable Logging"选项
3. 查看输出面板的详细日志