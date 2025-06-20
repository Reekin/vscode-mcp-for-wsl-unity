import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';

let server: http.Server | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('File Refresher');
    
    // 注册命令
    const startCommand = vscode.commands.registerCommand('fileRefresher.start', startServer);
    const stopCommand = vscode.commands.registerCommand('fileRefresher.stop', stopServer);
    const refreshCommand = vscode.commands.registerCommand('fileRefresher.refreshAll', refreshAllFiles);
    
    context.subscriptions.push(startCommand, stopCommand, refreshCommand, outputChannel);
    
    // 自动启动
    const config = vscode.workspace.getConfiguration('fileRefresher');
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
    
    const config = vscode.workspace.getConfiguration('fileRefresher');
    const port = config.get('port', 8790);
    
    server = http.createServer(handleRequest);
    
    server.listen(port, 'localhost', () => {
        log(`文件刷新服务器启动在端口 ${port}`);
        vscode.window.showInformationMessage(`File Refresher 服务器启动在端口 ${port}`);
    });
    
    server.on('error', (error) => {
        log(`服务器错误: ${error.message}`);
        vscode.window.showErrorMessage(`File Refresher 服务器错误: ${error.message}`);
        server = null;
    });
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
        log('服务器已停止');
        vscode.window.showInformationMessage('File Refresher 服务器已停止');
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
    
    if (req.method === 'POST' && req.url === '/refresh') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                await handleRefreshRequest(data);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '文件刷新完成' }));
                
            } catch (error) {
                log(`处理刷新请求错误: ${error}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}

async function handleRefreshRequest(data: any) {
    const { files, action = 'refresh' } = data;
    
    log(`收到刷新请求: ${action}, 文件: ${files?.join(', ') || '全部'}`);
    
    if (action === 'refresh') {
        if (files && Array.isArray(files)) {
            // 刷新指定文件
            for (const filePath of files) {
                await refreshFile(filePath);
            }
        } else {
            // 刷新所有打开的文件
            await refreshAllFiles();
        }
    } else if (action === 'refresh_project') {
        // 刷新整个项目
        await refreshProject();
    }
    
    // 触发诊断检查
    await triggerDiagnostics();
}

async function refreshFile(filePath: string) {
    try {
        const uri = vscode.Uri.file(path.resolve(filePath));
        await vscode.workspace.openTextDocument(uri);
        
        // 强制刷新文档内容
        await vscode.commands.executeCommand('workbench.action.files.revert', uri);
        
        log(`已刷新文件: ${filePath}`);
        
    } catch (error) {
        log(`刷新文件失败 ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function refreshAllFiles() {
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
}

async function refreshProject() {
    try {
        log('开始刷新整个项目...');
        
        // 1. 刷新文件资源管理器
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        // 2. 刷新所有已打开的文档
        await refreshAllFiles();
        
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

function log(message: string) {
    const config = vscode.workspace.getConfiguration('fileRefresher');
    if (config.get('enableLogging', false)) {
        outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}