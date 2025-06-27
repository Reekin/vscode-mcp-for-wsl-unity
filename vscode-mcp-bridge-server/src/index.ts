#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// VSCode notification tools definition
const TOOLS: Tool[] = [
  {
    name: 'refresh_project',
    description: 'Refresh the project in VSCode and trigger diagnostic checks. Since modifications made via command line in WSL are often not immediately detected by the editor, manual refresh is needed through this tool. **ALWAYS** call this tool before any mcp ide diagnostic!',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'List of file paths to refresh. If empty or not provided, refresh all open files',
        },
      },
    },
  },
  {
    name: 'goto_symbol_definition',
    description: 'View the definition location of a specified symbol, returning all definition file paths and line number information. Supports both project code and library files.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'File path containing the symbol',
        },
        line: {
          type: 'number',
          description: 'Line number where the symbol is located (1-based)',
        },
        character: {
          type: 'number',
          description: 'Character position where the symbol is located (0-based)',
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
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private async handleRefreshProject(args: any) {
    const { files } = args;
    const vscode_port = 8790;

    const result = await this.sendNotificationToVSCode({
      action: 'refresh_project',
      files,
    }, vscode_port);

    const fileInfo = files && files.length > 0 
      ? `specified files (${files.length}): ${files.join(', ')}` 
      : 'all files';

    return {
      content: [
        {
          type: 'text',
          text: `VSCode project refresh notified\nRefresh scope: ${fileInfo}\n\nResponse: ${result.message}`,
        },
      ],
    };
  }

  private async handleGotoSymbolDefinition(args: any) {
    const { file_path, line, character } = args;
    const vscode_port = 8790;

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
            `Found ${result.definitions.length} definition(s):\n\n${result.definitions.map((def: any, index: number) => 
              `${index + 1}. ${def.uri}\n   Line: ${def.range.start.line + 1}, Column: ${def.range.start.character + 1}`
            ).join('\n\n')}` : 
            `Symbol definition not found\n\nResponse: ${result.message}`,
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
        throw new Error(`VSCode server response error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(
          `Unable to connect to VSCode MCP Bridge plugin (port ${port}). Please ensure:\n` +
          '1. VSCode has MCP Bridge plugin installed and enabled\n' +
          '2. Plugin server is running\n' +
          '3. Port number is configured correctly'
        );
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('VSCode MCP Bridge server started');
  }
}

const server = new VSCodeNotifierServer();
server.run().catch(console.error);