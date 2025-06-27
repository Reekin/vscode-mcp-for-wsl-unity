#!/bin/bash

# WSL文件监听解决方案一键安装脚本

set -e

echo "🚀 开始安装WSL文件监听解决方案..."

# 获取当前目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 项目目录: $SCRIPT_DIR"

# 安装VSCode插件依赖
echo "📦 安装VSCode插件依赖..."
cd "$SCRIPT_DIR/@vscode-mcp-bridge"
npm install
npm run compile
echo "✅ VSCode插件编译完成"

# 安装MCP服务器依赖
echo "📦 安装MCP服务器依赖..."
cd "$SCRIPT_DIR/@mcp-vscode-notifier"
npm install
npm run build
echo "✅ MCP服务器构建完成"

# 生成MCP配置
echo "⚙️  生成MCP配置..."
MCP_CONFIG_PATH=""

# 检测操作系统并设置配置路径
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    MCP_CONFIG_PATH="$HOME/.config/claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    MCP_CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    MCP_CONFIG_PATH="$APPDATA/Claude/claude_desktop_config.json"
fi

if [[ -n "$MCP_CONFIG_PATH" ]]; then
    mkdir -p "$(dirname "$MCP_CONFIG_PATH")"
    
    # 生成MCP配置内容
    cat > "$SCRIPT_DIR/mcp_config_example.json" << EOF
{
  "mcpServers": {
    "vscode-notifier": {
      "command": "node",
      "args": ["$SCRIPT_DIR/@mcp-vscode-notifier/dist/index.js"]
    }
  }
}
EOF
    
    echo "📋 MCP配置示例已生成: $SCRIPT_DIR/mcp_config_example.json"
    echo "🔧 请将配置内容合并到: $MCP_CONFIG_PATH"
else
    echo "⚠️  无法自动检测MCP配置路径，请手动配置"
fi

# 创建VSCode任务配置
echo "📝 创建VSCode任务配置..."
mkdir -p "$SCRIPT_DIR/@vscode-mcp-bridge/.vscode"
cat > "$SCRIPT_DIR/@vscode-mcp-bridge/.vscode/tasks.json" << 'EOF'
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "npm",
            "script": "compile",
            "group": "build",
            "presentation": {
                "panel": "dedicated",
                "reveal": "never"
            },
            "problemMatcher": [
                "$tsc"
            ]
        }
    ]
}
EOF

# 创建启动配置
cat > "$SCRIPT_DIR/@vscode-mcp-bridge/.vscode/launch.json" << 'EOF'
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Run Extension",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}"
            ],
            "outFiles": [
                "${workspaceFolder}/out/**/*.js"
            ],
            "preLaunchTask": "${workspaceFolder}:npm: compile"
        }
    ]
}
EOF

echo "✅ VSCode开发环境配置完成"

# 显示安装总结
echo ""
echo "🎉 安装完成！"
echo ""
echo "📋 下一步操作："
echo "1. 在VSCode中安装插件："
echo "   - 打开 $SCRIPT_DIR/@vscode-mcp-bridge"
echo "   - 按F5启动调试模式，或手动安装插件"
echo ""
echo "2. 配置Claude Code MCP服务器："
echo "   - 复制 $SCRIPT_DIR/mcp_config_example.json 的内容"
echo "   - 合并到你的Claude配置文件中"
echo "   - 重启Claude Code"
echo ""
echo "3. 测试功能："
echo "   - 在VSCode中启动File Refresher服务器"
echo "   - 在Claude Code中使用 refresh_project 工具"
echo ""
echo "📖 详细说明请查看: $SCRIPT_DIR/INSTALL.md"