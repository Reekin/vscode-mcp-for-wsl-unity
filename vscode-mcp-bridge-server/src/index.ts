#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// VSCode通知工具定义
const TOOLS: Tool[] = [
  {
    name: 'refresh_project',
    description: '刷新VSCode中的整个项目（包括所有文件和文件夹）并触发诊断检查。**ALWAYS**在任何一次mcp ide diagnostic之前都必须调用本服务！！',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '要刷新的文件路径列表。如果为空或未提供，则刷新所有打开的文件',
        },
        vscode_port: {
          type: 'number',
          default: 8790,
          description: 'VSCode File Refresher插件的服务器端口',
        },
      },
    },
  },
  {
    name: 'goto_symbol_definition',
    description: '查看指定symbol的定义位置，返回所有定义所处的文件路径和行号信息。支持项目内代码和库文件。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '包含symbol的文件路径',
        },
        line: {
          type: 'number',
          description: 'symbol所在的行号（从1开始）',
        },
        character: {
          type: 'number',
          description: 'symbol所在的字符位置（从0开始）',
        },
        vscode_port: {
          type: 'number',
          default: 8790,
          description: 'VSCode File Refresher插件的服务器端口',
        },
      },
      required: ['file_path', 'line', 'character'],
    },
  },
];

class VSCodeNotifierServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'vscode-notifier',
        version: '1.0.0',
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'refresh_project':
            return await this.handleRefreshProject(args);
          case 'goto_symbol_definition':
            return await this.handleGotoSymbolDefinition(args);
          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `错误: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private async handleRefreshProject(args: any) {
    const { files, vscode_port = 8790 } = args;

    const result = await this.sendNotificationToVSCode({
      action: 'refresh_project',
      files,
    }, vscode_port);

    const fileInfo = files && files.length > 0 
      ? `指定文件 (${files.length}个): ${files.join(', ')}` 
      : '全部文件';

    return {
      content: [
        {
          type: 'text',
          text: `已通知VSCode刷新项目\n刷新范围: ${fileInfo}\n\n响应: ${result.message}`,
        },
      ],
    };
  }

  private async handleGotoSymbolDefinition(args: any) {
    const { file_path, line, character, vscode_port = 8790 } = args;

    const result = await this.sendNotificationToVSCode({
      action: 'goto_symbol_definition',
      file_path,
      line,
      character,
    }, vscode_port);

    return {
      content: [
        {
          type: 'text',
          text: result.definitions ? 
            `找到 ${result.definitions.length} 个定义:\n\n${result.definitions.map((def: any, index: number) => 
              `${index + 1}. ${def.uri}\n   行: ${def.range.start.line + 1}, 列: ${def.range.start.character + 1}`
            ).join('\n\n')}` : 
            `未找到symbol定义\n\n响应: ${result.message}`,
        },
      ],
    };
  }

  private async sendNotificationToVSCode(payload: any, port: number): Promise<any> {
    const url = `http://localhost:${port}/bridge`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`VSCode服务器响应错误: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(
          `无法连接到VSCode MCP Bridge插件 (端口 ${port})。请确保:\n` +
          '1. VSCode已安装并启用MCP Bridge插件\n' +
          '2. 插件服务器已启动\n' +
          '3. 端口号配置正确'
        );
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('VSCode MCP Bridge server 已启动');
  }
}

const server = new VSCodeNotifierServer();
server.run().catch(console.error);