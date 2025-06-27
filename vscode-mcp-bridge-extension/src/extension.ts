import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as net from 'net';

let server: http.Server | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('VSCode MCP Bridge');
    
    // 注册命令
    const startCommand = vscode.commands.registerCommand('vscodeMcpBridge.start', startServer);
    const stopCommand = vscode.commands.registerCommand('vscodeMcpBridge.stop', stopServer);
    const refreshCommand = vscode.commands.registerCommand('vscodeMcpBridge.refreshAll', () => refreshFiles());
    
    context.subscriptions.push(startCommand, stopCommand, refreshCommand, outputChannel);
    
    // 自动启动
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    if (config.get('autoStart', true)) {
        startServer();
    }
}

export function deactivate() {
    stopServer();
}

async function startServer() {
    if (server) {
        log('服务器已在运行');
        return;
    }
    
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const port = config.get('port', 8790);
    
    server = http.createServer(handleRequest);
    
    server.listen(port, 'localhost', () => {
        log(`文件刷新服务器启动在端口 ${port}`);
        vscode.window.showInformationMessage(`VSCode MCP Bridge 服务器启动在端口 ${port}`);
    });
    
    server.on('error', (error) => {
        log(`服务器错误: ${error.message}`);
        vscode.window.showErrorMessage(`VSCode MCP Bridge 服务器错误: ${error.message}`);
        server = null;
    });
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
        log('服务器已停止');
        vscode.window.showInformationMessage('VSCode MCP Bridge 服务器已停止');
    }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === 'POST' && req.url === '/bridge') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const result = await handleBridgeRequest(data);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                
                if (data.action === 'goto_symbol_definition') {
                    // 返回symbol definition结果
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: result ? 'Symbol定义查找完成' : '未找到Symbol定义',
                        definitions: result || []
                    }));
                } else {
                    // 返回普通操作结果
                    res.end(JSON.stringify({ success: true, message: '操作完成' }));
                }
                
            } catch (error) {
                log(`处理请求错误: ${error}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}

async function handleBridgeRequest(data: any) {
    const { files, action, file_path, line, character } = data;
    
    log(`收到请求: ${action}, 文件: ${files?.join(', ') || file_path || '全部'}`);
    
    if (action === 'refresh_project') {
        // 刷新项目，支持指定文件列表
        await refreshProject(files);
        // 触发诊断检查
        await triggerDiagnostics();
    } else if (action === 'goto_symbol_definition') {
        // 查看symbol定义
        return await gotoSymbolDefinition(file_path, line, character);
    }
}

async function refreshFiles(filePaths: string[] = []) {
    try {
        if (filePaths.length === 0) {
            // 如果没有指定文件路径，刷新所有已打开的文件
            const openDocuments = vscode.workspace.textDocuments;
            
            for (const document of openDocuments) {
                if (!document.isUntitled && document.uri.scheme === 'file') {
                    try {
                        await vscode.commands.executeCommand('workbench.action.files.revert', document.uri);
                    } catch (error) {
                        log(`刷新文件失败 ${document.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            
            log(`已刷新 ${openDocuments.length} 个打开的文件`);
        } else {
            // 刷新指定的文件列表
            const openDocuments = vscode.workspace.textDocuments;
            const openFiles = new Set(openDocuments.map(doc => doc.uri.fsPath));
            
            for (const filePath of filePaths) {
                try {
                    const resolvedPath = path.resolve(filePath);
                    const uri = vscode.Uri.file(resolvedPath);
                    
                    // 如果文件未打开，先打开它
                    if (!openFiles.has(resolvedPath)) {
                        await vscode.workspace.openTextDocument(uri);
                    }
                    
                    // 刷新文件内容
                    await vscode.commands.executeCommand('workbench.action.files.revert', uri);
                    
                    log(`已刷新文件: ${filePath}`);
                    
                } catch (error) {
                    log(`刷新文件失败 ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            
            log(`已刷新 ${filePaths.length} 个指定的文件`);
        }
        
    } catch (error) {
        log(`刷新文件操作失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function waitForDotnetAnalysisComplete(timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let isResolved = false;
        
        // 设置超时
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                log('等待dotnet分析完成超时，继续执行...');
                resolve();
            }
        }, timeoutMs);
        
        // 监听诊断变化
        const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
            if (isResolved) return;
            
            // 检查是否有正在分析的诊断信息
            let hasAnalyzing = false;
            
            for (const uri of event.uris) {
                const diagnostics = vscode.languages.getDiagnostics(uri);
                for (const diagnostic of diagnostics) {
                    const message = diagnostic.message.toLowerCase();
                    // 检查是否包含分析中的关键词
                    if (message.includes('analyzing') || 
                        message.includes('loading') ||
                        message.includes('initializing') ||
                        message.includes('正在分析') ||
                        message.includes('正在加载') ||
                        message.includes('初始化中')) {
                        hasAnalyzing = true;
                        break;
                    }
                }
                if (hasAnalyzing) break;
            }
            
            // 如果没有分析中的诊断，且已经过了最小等待时间(2秒)，认为完成
            if (!hasAnalyzing && (Date.now() - startTime) > 2000) {
                isResolved = true;
                clearTimeout(timeout);
                disposable.dispose();
                log('检测到dotnet分析完成');
                resolve();
            }
        });
        
        // 最小等待时间后开始检查
        setTimeout(() => {
            if (isResolved) return;
            
            // 如果没有任何分析中的诊断，直接完成
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                let hasAnalyzing = false;
                
                // 检查工作区中的所有诊断
                vscode.workspace.textDocuments.forEach(doc => {
                    if (doc.languageId === 'csharp') {
                        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
                        for (const diagnostic of diagnostics) {
                            const message = diagnostic.message.toLowerCase();
                            if (message.includes('analyzing') || 
                                message.includes('loading') ||
                                message.includes('initializing') ||
                                message.includes('正在分析') ||
                                message.includes('正在加载') ||
                                message.includes('初始化中')) {
                                hasAnalyzing = true;
                                break;
                            }
                        }
                        if (hasAnalyzing) return;
                    }
                });
                
                if (!hasAnalyzing) {
                    isResolved = true;
                    clearTimeout(timeout);
                    disposable.dispose();
                    log('初始检查未发现分析中状态，认为已完成');
                    resolve();
                }
            }
        }, 2000);
    });
}

async function refreshProject(filePaths?: string[]) {
    try {
        log(`开始刷新项目... ${filePaths ? `指定文件: ${filePaths.join(', ')}` : '全部文件'}`);
        
        // 1. 刷新文件资源管理器
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        // 2. 刷新文档（如果指定了文件路径，只刷新这些文件；否则刷新所有打开的文档）
        await refreshFiles(filePaths);
        
        // 3. 触发各语言服务器重新加载项目
        try {
            await vscode.commands.executeCommand('typescript.reloadProjects');
        } catch (e) {
            // TypeScript服务器可能不存在，忽略错误
        }
        
        try {
            await vscode.commands.executeCommand('python.reloadProjects');
        } catch (e) {
            // Python服务器可能不存在，忽略错误
        }
        
        // Unity/C# 相关服务器重新加载
        try {
            await vscode.commands.executeCommand('omnisharp.restartServer');
        } catch (e) {
            // OmniSharp可能不存在，忽略错误
        }
        
        try {
            await vscode.commands.executeCommand('csharp.reloadProjects');
        } catch (e) {
            // C#服务器可能不存在，忽略错误
        }
        
        try {
            await vscode.commands.executeCommand('dotnet.restore');
        } catch (e) {
            // dotnet可能不存在，忽略错误
        }
        
        // 4. 通知Unity执行project_files_refresher
        try {
            await notifyUnityProjectFilesRefresher();
        } catch (e) {
            log(`Unity project_files_refresher通知失败: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 5. 重启dotnet服务器并等待分析完成
        try {
            await vscode.commands.executeCommand('dotnet.restartServer');
            log('已重启dotnet服务器，等待分析完成...');
            await waitForDotnetAnalysisComplete();
            log('dotnet服务器分析完成');
        } catch (e) {
            log(`重启dotnet服务器失败: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        log('项目刷新完成');
        
    } catch (error) {
        log(`刷新项目失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}


async function triggerDiagnostics() {
    try {
        // 触发语言服务器诊断
        await vscode.commands.executeCommand('typescript.reloadProjects');
        await vscode.commands.executeCommand('python.refreshDiagnostics');
        
        // 通用的诊断刷新
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            await vscode.commands.executeCommand('editor.action.marker.next');
            await vscode.commands.executeCommand('editor.action.marker.prev');
        }
        
        log('已触发诊断检查');
        
    } catch (error) {
        log(`触发诊断检查失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function gotoSymbolDefinition(filePath: string, line: number, character: number): Promise<any[]> {
    try {
        log(`开始查找symbol定义: ${filePath}:${line}:${character}`);
        
        // 将文件路径转换为VSCode URI
        const uri = vscode.Uri.file(path.resolve(filePath));
        
        // 确保文档已打开
        await vscode.workspace.openTextDocument(uri);
        
        // 创建位置对象 (VSCode API使用0-based行号)
        const position = new vscode.Position(line - 1, character);
        
        // 调用VSCode的Go to Definition API
        const definitions = await vscode.commands.executeCommand<vscode.LocationLink[] | vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        );
        
        if (!definitions || definitions.length === 0) {
            log('未找到symbol定义');
            return [];
        }
        
        // 转换定义结果为标准格式
        const results = definitions.map((def, index) => {
            let location: vscode.Location;
            let targetRange: vscode.Range;
            
            // 处理LocationLink和Location两种类型
            if ('targetUri' in def) {
                // LocationLink类型
                location = new vscode.Location(def.targetUri, def.targetRange);
                targetRange = def.targetRange;
            } else {
                // Location类型
                location = def as vscode.Location;
                targetRange = location.range;
            }
            
            const result = {
                uri: location.uri.fsPath,
                range: {
                    start: {
                        line: targetRange.start.line,
                        character: targetRange.start.character
                    },
                    end: {
                        line: targetRange.end.line,
                        character: targetRange.end.character
                    }
                }
            };
            
            log(`定义 ${index + 1}: ${result.uri}:${result.range.start.line + 1}:${result.range.start.character + 1}`);
            return result;
        });
        
        log(`找到 ${results.length} 个定义`);
        return results;
        
    } catch (error) {
        log(`查找symbol定义失败: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function notifyUnityProjectFilesRefresher() {
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const unityMcpPort = config.get('unityMcpPort', 6400);
    const unityMcpHost = config.get('unityMcpHost', '192.168.80.1'); // WSL访问Windows的默认网关
    
    return new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(5000); // 5秒超时
        
        const command = {
            type: 'project_files_refresher',
            params: {}
        };
        
        const commandJson = JSON.stringify(command);
        
        socket.connect(unityMcpPort, unityMcpHost, () => {
            log(`已连接到Unity MCP Bridge (${unityMcpHost}:${unityMcpPort})`);
            socket.write(commandJson);
        });
        
        socket.on('data', (data) => {
            try {
                const response = JSON.parse(data.toString());
                log(`Unity MCP响应: ${JSON.stringify(response)}`);
                
                if (response.status === 'success') {
                    log('Unity project_files_refresher执行成功');
                    resolve();
                } else {
                    reject(new Error(`Unity MCP错误: ${response.error || '未知错误'}`));
                }
            } catch (error) {
                log(`解析Unity MCP响应失败: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
            socket.destroy();
        });
        
        socket.on('error', (error) => {
            log(`Unity MCP连接错误: ${error.message}`);
            reject(error);
        });
        
        socket.on('timeout', () => {
            log('Unity MCP连接超时');
            socket.destroy();
            reject(new Error('Unity MCP连接超时'));
        });
        
        socket.on('close', () => {
            log('Unity MCP连接已关闭');
        });
    });
}

function log(message: string) {
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    if (config.get('enableLogging', false)) {
        outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}