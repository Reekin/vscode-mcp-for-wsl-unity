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
    name: 'notify_file_change',
    description: '通知VSCode有文件发生了变化，触发刷新和诊断检查。**在每次改完一个文件之后都要记得调用！！**',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '已修改的文件路径列表（绝对路径）',
        },
        action: {
          type: 'string',
          enum: ['refresh', 'diagnostics', 'both'],
          default: 'both',
          description: '执行的操作类型',
        },
        vscode_port: {
          type: 'number',
          default: 8790,
          description: 'VSCode File Refresher插件的服务器端口',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'refresh_all_files',
    description: '刷新VSCode中的整个项目（包括所有文件和文件夹）并触发诊断检查',
    inputSchema: {
      type: 'object',
      properties: {
        vscode_port: {
          type: 'number',
          default: 8790,
          description: 'VSCode File Refresher插件的服务器端口',
        },
      },
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
          case 'notify_file_change':
            return await this.handleNotifyFileChange(args);
          case 'refresh_all_files':
            return await this.handleRefreshAllFiles(args);
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

  private async handleNotifyFileChange(args: any) {
    const { files, action = 'both', vscode_port = 8790 } = args;

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('files参数必须是非空数组');
    }

    const result = await this.sendNotificationToVSCode({
      files,
      action,
    }, vscode_port);

    return {
      content: [
        {
          type: 'text',
          text: `已通知VSCode刷新 ${files.length} 个文件:\n${files.join('\n')}\n\n响应: ${result.message}`,
        },
      ],
    };
  }

  private async handleRefreshAllFiles(args: any) {
    const { vscode_port = 8790 } = args;

    const result = await this.sendNotificationToVSCode({
      action: 'refresh_project',
    }, vscode_port);

    return {
      content: [
        {
          type: 'text',
          text: `已通知VSCode刷新整个项目\n\n响应: ${result.message}`,
        },
      ],
    };
  }

  private async sendNotificationToVSCode(payload: any, port: number): Promise<any> {
    const url = `http://localhost:${port}/refresh`;
    
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
          `无法连接到VSCode File Refresher插件 (端口 ${port})。请确保:\n` +
          '1. VSCode已安装并启用File Refresher插件\n' +
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
    console.error('VSCode Notifier MCP server 已启动');
  }
}

const server = new VSCodeNotifierServer();
server.run().catch(console.error);