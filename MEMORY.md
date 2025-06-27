# WSL文件监听解决方案设计

## 问题
- VSCode Remote WSL环境下文件修改后无法及时感知变化
- 跨系统文件监听延迟导致语法检查不及时触发

## 解决方案
双组件架构：
1. **@vscode-mcp-bridge**: VSCode插件，提供HTTP服务器接收文件变化通知
2. **@mcp-vscode-notifier**: MCP server，为AI提供通知VSCode的工具

## 工作流程
1. AI修改文件后调用MCP工具
2. MCP server发送HTTP请求到VSCode插件
3. VSCode插件主动触发文件刷新和诊断检查

## 技术优势
- 绕过WSL文件监听限制
- AI工具无缝集成
- 主动触发比被动监听更可靠