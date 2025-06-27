# MCP VSCode Notifier

为AI工具提供通知VSCode文件变化的MCP服务器。

## 功能
- `refresh_all_files`: 刷新VSCode中所有打开的文件

## 安装使用

1. 安装依赖：
```bash
npm install
```

2. 构建：
```bash
npm run build
```

3. 配置Claude Code的MCP设置：
```json
{
  "mcpServers": {
    "@mcp-vscode-notifier": {
      "command": "node",
      "args": ["/path/to/@mcp-vscode-notifier/dist/index.js"]
    }
  }
}
```

## 工具使用示例

```typescript

// 刷新所有打开的文件
await refresh_all_files({
  "vscode_port": 8790
});
```

## 配置

- `vscode_port`: VSCode File Refresher插件的HTTP服务器端口（默认8790）
- `action`: 执行操作类型
  - `refresh`: 仅刷新文件
  - `diagnostics`: 仅触发诊断检查
  - `both`: 刷新文件并触发诊断检查（默认）